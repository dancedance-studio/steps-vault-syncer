import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildComputerSongReports,
  buildEmptyInstalledSongsRecord,
  buildInstalledAddon,
  fetchAddonManifest,
  findSameLibrarySong,
  getAddonBaseUrl,
  getGeneratedSongs,
  getPlayerGroupNames,
  LOCAL_BRIDGE_HOST,
  LOCAL_BRIDGE_PORTS,
  LocalBridgePairing,
  loadLinkSongSources,
  loadSavedGeneratorJobs,
  pollDeviceSignIn,
  runSync,
  scanMusicLibrary,
  SignedOutError,
  startDeviceSignIn,
  DancedanceClient,
  withAddonOption,
  writeGeneratedSong,
  type ActivityLogEvent,
  type AddonManifest,
  type FolderLayout,
  type GeneratedSongRequest,
  type GeneratedSongWriteResult,
  type InstalledSongsRecord,
  type LinkSongSource,
  type MusicIndex,
  type PairedBrowserStore,
  type SavedGeneratorJob,
  type SyncOutcome,
  type SyncPorts,
  type SyncLibrary,
  type NameFindSongFacts,
  type VerifyLinkJob,
  type LibrarySongChoice,
  type LibrarySongIdentity,
} from '@dancedance/sync-core';
import {
  buildActivityEntries,
  buildAddonInstallPreview,
  buildAddonView,
  buildGeneratedSongViews,
  buildGeneratorJobView,
  buildGeneratorView,
  buildLayoutViews,
  buildPartyFolderPreview,
  buildPartyFolderViews,
  buildSongDetailsById,
  buildSongRows,
  buildLinksTab,
  buildSongSourceTabs,
  getAddonOptionValuesFromViews,
  getTrayStatus,
  type AddonInstallPreview,
  type AddonLookupResult,
  type GeneratorInstallPreview,
  type GeneratorLookupResult,
  type MakeSongRequest,
  type MakeSongResult,
  type MusicChoiceView,
  type ServiceLookupRequest,
  type SongAction,
  type SongSourceSearchRequest,
  type SongSourceSearchResult,
  type LibraryChoiceAnswer,
} from '@dancedance/sync-ui';
import { APP_DISPLAY_NAME } from '../shared/app-name';
import type { DesktopSignIn, DesktopSyncBridge, DesktopSyncState } from '../shared/bridge-types';
import { AppUpdates, buildAppVersionsView, type AppUpdater } from './app-updates';
import type { AudioBridge } from './audio-bridge';
import { buildDefaultSettings, parseSettings, withActivity, type DesktopSettings } from './desktop-settings';
import type { DeviceTokenStore } from './device-token-store';
import { findInstalledGames, getInstallParentFolders, type FoundGame } from './game-detection';
import { GeneratorJobFiles } from './generator-job-files';
import { GeneratorJobRunner } from './generator-job-runner';
import { GeneratorSettings, type StartCommandConfirmation } from './generator-settings';
import { withInstallerChoicesOrNull, type InstallerChoices } from './installer-choices';
import { JsonFileStore } from './json-file-store';
import { LocalBridgeServer } from './local-bridge-server';
import { isServiceAnswering, startProgramWithShell, StartingHttpClient } from './local-program-process';
import { LocalProgramStarter } from './local-program-starter';
import { MakeSongMusic } from './make-song-music';
import { MusicSourceRegistry } from './music-source-registry';
import { NodeFileUploadHttpClient } from './node-file-upload-http-client';
import { NodeHttpClient } from './node-http-client';
import { NodeMultipartHttpClient } from './node-multipart-http-client';
import { NodeMusicLibrary } from './node-music-library';
import { NodeSongsFolder } from './node-songs-folder';
import { SiteLinkJobs } from './site-link-jobs';
import { findMusicByName, type NameFindOutcome } from './site-name-finds';
import { installSongForSite, type SiteSongInstallResult } from './site-song-installs';
import { checkVideoForSite, type AddonWait, type SiteVideoCheckAnswer } from './site-video-checks';
import { getStartWithWindowsChangeOrNull, type StartWithWindows } from './start-with-windows';
import type { MakeSongLink } from './sync-link';

const MAX_ADDON_FILE_BYTES = 200 * 1024 * 1024;
const ADDON_DOWNLOAD_TIMEOUT_MILLISECONDS = 120_000;
const MAX_ACTIVITY_IN_COPY = 50;
const IDLE_PROGRAM_CHECK_MILLISECONDS = 60_000;

/** What the controller needs from Electron, passed in so the controller itself stays plain Node. */
export interface DesktopServices {
  chooseFolder(title: string): Promise<string | null>;
  chooseAudioFile(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  writeClipboard(text: string): Promise<void>;
  isGameRunning(): Promise<boolean>;
  /** Asks the player, in the app's own dialog, whether Sync may run this command; the window can't answer for them. */
  confirmStartCommand(confirmation: StartCommandConfirmation): Promise<boolean>;
  /** Quits and runs the downloaded installer. */
  installUpdate(): void;
}

export interface SyncControllerOptions {
  dataFolder: string;
  appDataFolder: string;
  siteUrl: string;
  appVersion: string;
  computerName: string;
  systemName: string;
  tokenStore: DeviceTokenStore;
  /** The tokens of browsers paired with the local bridge, kept like the device token. */
  pairedBrowserStore: PairedBrowserStore;
  /** The website origins the local bridge answers (only the real site in a release build). */
  bridgeOrigins: readonly string[];
  audioBridge: AudioBridge;
  /** Null for a copy run from source: its updates come from git. */
  appUpdater: AppUpdater | null;
  startWithWindows: StartWithWindows;
  /** The answers on the installer's "What Sync sends" page; null for a copy run from source. */
  readInstallerChoices: () => Promise<InstallerChoices | null>;
  services: DesktopServices;
  onStateChange: (state: DesktopSyncState) => void;
  /** A line for support (link jobs from the website: their ids and statuses, never a link). */
  logSupportLine: (line: string) => void;
}

/** The app's brain: it owns the settings, the record and the token, runs syncs, and builds what the window shows. */
export class SyncController implements Omit<DesktopSyncBridge, 'onState'> {
  private readonly options: SyncControllerOptions;
  private readonly httpClient: NodeHttpClient;
  /** Addons and generators go through this one: it starts a program on this computer when it has a start command. */
  private readonly serviceClient: StartingHttpClient;
  private readonly starter: LocalProgramStarter;
  private readonly musicSources = new MusicSourceRegistry();
  private readonly settingsStore: JsonFileStore<DesktopSettings>;
  private readonly recordStore: JsonFileStore<InstalledSongsRecord>;
  private readonly jobFiles: GeneratorJobFiles;
  private readonly makeSongMusic: MakeSongMusic;
  private readonly generatorSettings: GeneratorSettings;
  private readonly jobRunner: GeneratorJobRunner;
  private readonly reportsFolder: string;
  private readonly reportSongKeys = new Set<string>();
  private readonly browserPairing: LocalBridgePairing;
  private readonly bridgeServer: LocalBridgeServer;
  /** Uploads a website link song's audio, the only file Sync sends the site. */
  private readonly fileUploadClient: NodeFileUploadHttpClient;
  private readonly siteLinkJobs: SiteLinkJobs;
  private readonly appUpdates: AppUpdates | null;
  private pairingExpiryTimer: ReturnType<typeof setTimeout> | null = null;
  private settings: DesktopSettings = buildDefaultSettings();
  private record: InstalledSongsRecord = buildEmptyInstalledSongsRecord();
  private recordTurn: Promise<unknown> = Promise.resolve();
  private deviceToken: string | null = null;
  /** The player's dancedance.studio tokens; null until read, or when dancedance.studio can't be reached. */
  private tokenBalance: number | null = null;
  private signIn: DesktopSignIn = { kind: 'signed-out' };
  private foundGames: FoundGame[] = [];
  private musicIndex: MusicIndex | null = null;
  private scannedFileCount: number | null = null;
  private lastOutcome: SyncOutcome | null = null;
  private playerGroupNames: string[] = [];
  private syncRun: DesktopSyncState['syncRun'] = null;
  private finishedSync: DesktopSyncState['finishedSync'] = null;
  private lastLayoutMove: DesktopSyncState['lastLayoutMove'] = null;
  private problem: string | null = null;
  private dismissedUpdateVersion: string | null = null;
  /** The song a website link asked to make, until the player makes it or closes Make a song. */
  private songLink: (MakeSongLink & { preselectionKey: string }) | null = null;
  private readonly addonNamesBySourceId = new Map<string, string>();
  private readonly lookedUpAddonsByAddress = new Map<string, { baseUrl: string; manifest: AddonManifest; startCommand: string | null }>();

  constructor(options: SyncControllerOptions) {
    this.options = options;
    this.httpClient = new NodeHttpClient({ appVersion: options.appVersion });
    this.starter = new LocalProgramStarter({ ports: { startProgram: startProgramWithShell, isAnswering: (baseUrl) => isServiceAnswering({ httpClient: this.httpClient, baseUrl }), getNowMilliseconds: () => Date.now(), waitMilliseconds: delay } });
    const multipartHttpClient = new NodeMultipartHttpClient({ appVersion: options.appVersion, getSourceFilePath: (sourceId) => this.musicSources.getSource(sourceId)?.filePath ?? null });
    this.serviceClient = new StartingHttpClient({ httpClient: this.httpClient, multipartHttpClient, starter: this.starter });
    this.settingsStore = new JsonFileStore({ filePath: path.join(options.dataFolder, 'settings.json'), buildDefault: buildDefaultSettings, parse: parseSettings });
    this.recordStore = new JsonFileStore({ filePath: path.join(options.dataFolder, 'installed-songs.json'), buildDefault: buildEmptyInstalledSongsRecord, parse: (value) => value as InstalledSongsRecord });
    this.jobFiles = new GeneratorJobFiles({ jobsFolder: path.join(options.dataFolder, 'generator-jobs'), musicSources: this.musicSources, appVersion: options.appVersion });
    this.reportsFolder = path.join(options.dataFolder, 'generated-song-reports');
    this.makeSongMusic = new MakeSongMusic({
      httpClient: this.serviceClient, musicSources: this.musicSources, waitMilliseconds: delay,
      measureLength: (bytes) => options.audioBridge.measureLength(bytes), convertToWav: (bytes) => options.audioBridge.convertToWav(bytes), convertToMonoWav: (bytes) => options.audioBridge.convertToMonoWav(bytes),
      downloadFile: (download) => this.jobFiles.downloadFile(download),
    });
    this.generatorSettings = new GeneratorSettings({
      httpClient: this.serviceClient, starter: this.starter, siteUrl: options.siteUrl, getDeviceToken: () => this.deviceToken, getTokenBalance: () => this.tokenBalance, getSettings: () => this.settings, saveSettings: (settings) => this.saveSettings(settings),
      confirmStartCommand: (confirmation) => options.services.confirmStartCommand(confirmation), getNow: () => new Date().toISOString(),
    });
    this.jobRunner = this.createJobRunner();
    this.browserPairing = new LocalBridgePairing({ store: options.pairedBrowserStore, getRandomBytes: (byteCount) => new Uint8Array(randomBytes(byteCount)), getNowMilliseconds: () => Date.now(), onChange: () => { this.publish(); } });
    this.bridgeServer = new LocalBridgeServer({
      dependencies: { pairing: this.browserPairing, getRecord: () => this.record, getSongsFolder: () => (this.settings.game ? this.buildSongsFolder() : null), allowedOrigins: options.bridgeOrigins },
      openSongFile: (songsPath) => this.buildSongsFolder().openFileForReading(songsPath),
      ports: LOCAL_BRIDGE_PORTS,
    });
    this.fileUploadClient = new NodeFileUploadHttpClient({ appVersion: options.appVersion, getSourceFilePath: (sourceId) => this.musicSources.getSource(sourceId)?.filePath ?? null });
    this.siteLinkJobs = this.createSiteLinkJobs();
    this.appUpdates = options.appUpdater === null ? null : new AppUpdates({ updater: options.appUpdater, getSettings: () => this.settings, onChange: () => { this.publish(); }, log: options.logSupportLine });
  }

  async initialize(): Promise<void> {
    [this.settings, this.record, this.deviceToken] = await Promise.all([this.settingsStore.load(), this.recordStore.load(), this.options.tokenStore.load()]);
    if (this.deviceToken) this.signIn = { kind: 'signed-in', computerName: this.options.computerName };
    await this.applyInstallerChoices();
    await this.applyStartWithWindowsIfChanged();
    for (const filePath of Object.values(this.settings.pickedFilePathsBySongId)) this.musicSources.register(filePath);
    this.generatorSettings.applyStartCommands();
    for (const fileName of await readdir(this.reportsFolder).catch((): string[] => [])) this.reportSongKeys.add(fileName);
    this.foundGames = await findInstalledGames({ parentFolders: getInstallParentFolders({ appDataFolder: this.options.appDataFolder }) });
    setInterval(() => void this.starter.stopIdlePrograms(), IDLE_PROGRAM_CHECK_MILLISECONDS);
    await this.jobRunner.initialize();
    await this.browserPairing.initialize();
    await this.bridgeServer.start();
    if (this.deviceToken) this.siteLinkJobs.start();
    void this.generatorSettings.loadDancedanceGenerator().then(() => { this.publish(); });
    void this.refreshTokenBalance();
    this.publish();
    await this.scanMusic();
  }

  /** When Sync quits, programs it started for addons and generators stop too, and the website hears it is leaving. */
  async shutdown(): Promise<void> {
    this.appUpdates?.stop();
    await Promise.all([this.siteLinkJobs.stop({ isLeaving: true }), this.starter.stopAll(), this.bridgeServer.stop()]);
  }

  get isReadyToSync(): boolean {
    return this.deviceToken !== null && this.settings.game !== null;
  }

  get isBackgroundSyncOn(): boolean {
    return this.settings.isBackgroundSyncOn;
  }

  getState(): Promise<DesktopSyncState> {
    return Promise.resolve(this.buildState());
  }

  async startSignIn(): Promise<void> {
    const device = { deviceName: this.options.computerName, operatingSystem: this.options.systemName, appVersion: this.options.appVersion };
    const deviceCode = await startDeviceSignIn({ httpClient: this.httpClient, siteUrl: this.options.siteUrl, device }).catch(() => null);
    if (!deviceCode) {
      this.problem = 'dancedance.studio can’t be reached right now. Check your internet connection, then choose "Get a new code".';
      this.publish();
      return;
    }
    this.problem = null;
    this.signIn = { kind: 'waiting-for-code', code: deviceCode.code, expiresAt: deviceCode.expiresAt, computerName: this.options.computerName, systemName: this.options.systemName };
    this.publish();
    void this.waitForSignIn({ pollingId: deviceCode.pollingId, intervalSeconds: deviceCode.pollIntervalSeconds });
  }

  async openLinkPage(): Promise<void> {
    await this.options.services.openExternal(`${this.options.siteUrl}/link`);
  }

  async useFoundGame(gameId: string): Promise<void> {
    const game = this.foundGames.find((candidate) => candidate.gameId === gameId);
    if (game) await this.connectGame({ gameName: game.gameName, songsFolderPath: game.songsFolderPath });
  }

  async chooseSongsFolder(): Promise<void> {
    const folder = await this.options.services.chooseFolder('Choose your StepMania Songs folder');
    if (folder) await this.connectGame({ gameName: 'StepMania', songsFolderPath: folder });
  }

  async addMusicFolder(): Promise<void> {
    const folder = await this.options.services.chooseFolder('Choose a folder with your music');
    if (!folder || this.settings.musicFolders.includes(folder)) return;
    await this.saveSettings({ ...this.settings, musicFolders: [...this.settings.musicFolders, folder] });
    await this.scanMusic();
    await this.syncNow();
  }

  async removeMusicFolder(folderPath: string): Promise<void> {
    await this.saveSettings({ ...this.settings, musicFolders: this.settings.musicFolders.filter((folder) => folder !== folderPath) });
    await this.scanMusic();
  }

  async scanMusicAgain(): Promise<void> {
    await this.scanMusic();
    await this.syncNow();
  }

  /** One sync at a time; a request while one runs is simply ignored (the running one is enough). */
  async syncNow(): Promise<void> {
    if (this.syncRun || !this.isReadyToSync) return;
    if (await this.options.services.isGameRunning()) {
      this.problem = 'StepMania is running. Close it so Sync can write your songs, then sync again.';
      this.publish();
      return;
    }
    this.syncRun = { currentSongNumber: 0, totalSongCount: 0, currentStepText: 'Reading your library…' };
    this.problem = null;
    this.publish();
    try {
      await this.takeRecordTurn(() => this.runOneSync());
    } catch (error) {
      await this.handleSyncError(error);
    } finally {
      this.syncRun = null;
      this.publish();
    }
  }

  dismissFinishedSync(): Promise<void> {
    this.finishedSync = null;
    this.publish();
    return Promise.resolve();
  }

  async setBackgroundSync(isOn: boolean): Promise<void> {
    await this.saveSettings({ ...this.settings, isBackgroundSyncOn: isOn });
  }

  async runSongAction({ librarySongId, action }: { librarySongId: string; action: SongAction }): Promise<void> {
    if (action === 'choose-audio' || action === 'use-different-file') {
      const filePath = await this.options.services.chooseAudioFile();
      if (!filePath) return;
      this.musicSources.register(filePath);
      await this.saveSettings({ ...this.settings, pickedFilePathsBySongId: { ...this.settings.pickedFilePathsBySongId, [librarySongId]: filePath } });
    } else {
      await this.saveSettings(withSongChoice({ settings: this.settings, librarySongId, action }));
    }
    await this.syncNow();
  }

  async lookUpAddon({ address, startCommand }: ServiceLookupRequest): Promise<AddonLookupResult> {
    try {
      const confirmedCommand = startCommand === null ? null : await this.generatorSettings.confirmStartCommand({ baseUrl: getAddonBaseUrl(address), command: startCommand });
      const { baseUrl, manifest } = await fetchAddonManifest({ httpClient: this.serviceClient, address });
      this.lookedUpAddonsByAddress.set(address, { baseUrl, manifest, startCommand: confirmedCommand });
      return { kind: 'found', addon: buildAddonInstallPreview({ address, manifest, startCommand: confirmedCommand }) };
    } catch (error) {
      this.generatorSettings.applyStartCommands();
      return { kind: 'failed', message: error instanceof Error ? error.message : 'No addon answered at this address.' };
    }
  }

  async installAddon(preview: AddonInstallPreview): Promise<void> {
    const lookedUp = this.lookedUpAddonsByAddress.get(preview.address);
    if (!lookedUp) return;
    const addon = buildInstalledAddon({ ...lookedUp, consentedAt: new Date().toISOString(), optionValues: getAddonOptionValuesFromViews(preview.options) });
    const settings = { ...this.settings, addons: [...this.settings.addons.filter((existing) => existing.manifest.id !== addon.manifest.id), addon] };
    await this.saveSettings(this.generatorSettings.withStartCommand({ settings, baseUrl: lookedUp.baseUrl, startCommand: lookedUp.startCommand }));
    await this.syncNow();
  }

  async setAddonEnabled({ addonId, isEnabled }: { addonId: string; isEnabled: boolean }): Promise<void> {
    await this.saveSettings({ ...this.settings, addons: this.settings.addons.map((addon) => (addon.manifest.id === addonId ? { ...addon, isEnabled } : addon)) });
  }

  /** Songs still waiting for audio are asked again with the new choice; songs that already have theirs keep it. */
  async setAddonOption({ addonId, optionId, value }: { addonId: string; optionId: string; value: string }): Promise<void> {
    await this.saveSettings({ ...this.settings, addons: this.settings.addons.map((addon) => (addon.manifest.id === addonId ? withAddonOption({ addon, optionId, value }) : addon)) });
    await this.syncNow();
  }

  async removeAddon(addonId: string): Promise<void> {
    await this.generatorSettings.removeAddon(addonId);
  }

  lookUpGenerator(request: ServiceLookupRequest): Promise<GeneratorLookupResult> {
    return this.generatorSettings.lookUpGenerator(request);
  }

  installGenerator(preview: GeneratorInstallPreview): Promise<void> {
    return this.generatorSettings.installGenerator(preview);
  }

  removeGenerator(generatorId: string): Promise<void> {
    return this.generatorSettings.removeGenerator(generatorId);
  }

  setGeneratorOption(change: { generatorId: string; optionId: string; value: string }): Promise<void> {
    return this.generatorSettings.setGeneratorOption(change);
  }

  async chooseMusicFileForSong(): Promise<MusicChoiceView | null> {
    const filePath = await this.options.services.chooseAudioFile();
    return filePath ? this.makeSongMusic.addPickedFile(filePath) : null;
  }

  searchMusicFolders(query: string): Promise<MusicChoiceView[]> {
    return Promise.resolve(this.makeSongMusic.searchMusicFolders({ index: this.musicIndex, query }));
  }

  async findSongWithSource({ addonId, valuesByInputId }: SongSourceSearchRequest): Promise<SongSourceSearchResult> {
    const addon = this.settings.addons.find((candidate) => candidate.isEnabled && candidate.manifest.id === addonId);
    if (!addon) return { kind: 'not-answering', message: 'That addon is turned off or removed. Turn it on under Audio sources, then try again.' };
    return this.makeSongMusic.findSong({ addon, valuesByInputId });
  }

  stopFindingSong(): Promise<void> {
    this.makeSongMusic.stopFindingSong();
    return Promise.resolve();
  }

  /**
   * A "make this song" link from the website. The window then opens Make a song with it; a newer link replaces an older
   * one. Only the song's name reaches the window: the Wanted request and party list stay here and go with the job.
   */
  openMakeSongLink(link: MakeSongLink): void {
    this.songLink = { ...link, preselectionKey: randomUUID() };
    this.publish();
  }

  dismissPreselectedSong(preselectionKey: string): Promise<void> {
    if (this.songLink?.preselectionKey === preselectionKey) {
      this.songLink = null;
      this.publish();
    }
    return Promise.resolve();
  }

  /** Gets the music ready and starts the job; from then on the job's progress is in the state. */
  async makeSong({ musicId, generatorId, difficulties, hasAgreedToMusicUpload, preselectionKey }: MakeSongRequest): Promise<MakeSongResult> {
    const jobKey = randomUUID();
    const songLink = preselectionKey !== undefined && this.songLink?.preselectionKey === preselectionKey ? this.songLink : null;
    try {
      const jobGenerator = await this.generatorSettings.getGeneratorForNewSong({ generatorId, hasAgreedToMusicUpload });
      const jobFolder = this.jobFiles.getJobFolder(jobKey);
      await mkdir(jobFolder, { recursive: true });
      const prepared = await this.makeSongMusic.prepareMusic({ musicId, manifest: jobGenerator.generator.manifest, jobFolder });
      await this.jobRunner.startJob({ jobKey, generatorBaseUrl: jobGenerator.generator.baseUrl, difficulties, siteRequest: songLink?.siteRequest ?? null, ...prepared });
      if (songLink) await this.dismissPreselectedSong(songLink.preselectionKey);
      return { kind: 'started', jobKey };
    } catch (error) {
      await this.jobFiles.removeJobFiles(jobKey).catch(() => undefined);
      return { kind: 'failed', message: error instanceof Error ? error.message : 'Sync couldn’t start this song. Try again.' };
    }
  }

  cancelGeneratorJob(jobKey: string): Promise<void> {
    return this.jobRunner.cancelJob(jobKey);
  }

  answerLibraryChoice(answer: LibraryChoiceAnswer): Promise<void> {
    return this.jobRunner.answerLibraryChoice(answer);
  }

  dismissGeneratorJob(jobKey: string): Promise<void> {
    return this.jobRunner.dismissJob(jobKey);
  }

  async fetchGeneratedSongReport(songKey: string): Promise<string | null> {
    return readFile(path.join(this.reportsFolder, getReportFileName(songKey)), 'utf8').catch(() => null);
  }

  /** The code shows until it is used or expires; the window is told when it expires so it never shows a dead code. */
  startBrowserPairing(): Promise<void> {
    const { expiresAtMilliseconds } = this.browserPairing.startPairing();
    if (this.pairingExpiryTimer) clearTimeout(this.pairingExpiryTimer);
    this.pairingExpiryTimer = setTimeout(() => { this.publish(); }, expiresAtMilliseconds - Date.now() + 100);
    return Promise.resolve();
  }

  forgetPairedBrowsers(): Promise<void> {
    return this.browserPairing.forgetPairedBrowsers();
  }

  async setLayout(layout: FolderLayout): Promise<void> {
    await this.saveSettings({ ...this.settings, layout });
    const movedBefore = this.settings.activity.length;
    await this.syncNow();
    const movedSongCount = this.settings.activity.slice(movedBefore).filter((event) => event.kind === 'moved').length;
    this.lastLayoutMove = { layout, movedSongCount };
    this.publish();
  }

  async copyActivityDetails(): Promise<void> {
    const lines = this.settings.activity.slice(-MAX_ACTIVITY_IN_COPY).map((event) => `${event.at} ${describeActivityKind(event)} ${event.folderPath.join('/')}${event.message ? ` — ${event.message}` : ''}`);
    await this.options.services.writeClipboard([`${APP_DISPLAY_NAME} ${this.options.appVersion}`, ...lines].join('\n'));
  }

  /** Starts the automatic checks for new versions, when that switch is on; called once the app is set up. */
  startUpdateChecks(): void {
    this.appUpdates?.applyAutomaticCheckSetting();
  }

  async checkForUpdates(): Promise<void> {
    await this.appUpdates?.checkNow({ isStartedByPlayer: true });
  }

  async setAutomaticUpdateCheck(isOn: boolean): Promise<void> {
    await this.saveSettings({ ...this.settings, isAutomaticUpdateCheckOn: isOn });
    this.appUpdates?.applyAutomaticCheckSetting();
  }

  async setTestVersionsFirst(isOn: boolean): Promise<void> {
    await this.saveSettings({ ...this.settings, shouldGetTestVersionsFirst: isOn });
    this.appUpdates?.handleTestVersionsChange();
  }

  /** The player's own choice is always written, even over one made in Windows' own Startup apps list. */
  async setStartWithWindows(isOn: boolean): Promise<void> {
    const { startWithWindows } = this.options;
    startWithWindows.apply(isOn);
    await this.saveSettings({ ...this.settings, shouldStartWithWindows: isOn, startWithWindowsCommand: isOn ? startWithWindows.command : null });
  }

  /** Never in the middle of a sync: a half-done sync could leave a song half written. */
  async restartToUpdate(): Promise<void> {
    while (this.syncRun) await delay(1000);
    this.options.services.installUpdate();
  }

  dismissUpdate(): Promise<void> {
    this.dismissedUpdateVersion = this.appUpdates?.readyVersion ?? null;
    this.publish();
    return Promise.resolve();
  }

  /** Before any update check: a player who unticked it in the installer never has GitHub asked. */
  private async applyInstallerChoices(): Promise<void> {
    const settings = withInstallerChoicesOrNull({ settings: this.settings, choices: await this.options.readInstallerChoices() });
    if (!settings) return;
    // Written like the player's own choice: the uninstaller of an earlier install may have removed the value.
    const { startWithWindows } = this.options;
    startWithWindows.apply(settings.shouldStartWithWindows);
    await this.saveSettings({ ...settings, startWithWindowsCommand: settings.shouldStartWithWindows ? startWithWindows.command : null });
  }

  private async applyStartWithWindowsIfChanged(): Promise<void> {
    const change = getStartWithWindowsChangeOrNull({ shouldStart: this.settings.shouldStartWithWindows, command: this.options.startWithWindows.command, writtenCommand: this.settings.startWithWindowsCommand });
    if (!change) return;
    this.options.startWithWindows.apply(change.shouldStart);
    await this.saveSettings({ ...this.settings, startWithWindowsCommand: change.writtenCommand });
  }

  private createJobRunner(): GeneratorJobRunner {
    const jobStore = new JsonFileStore<SavedGeneratorJob[]>({ filePath: path.join(this.options.dataFolder, 'generator-jobs.json'), buildDefault: () => [], parse: loadSavedGeneratorJobs });
    return new GeneratorJobRunner({
      httpClient: this.serviceClient,
      multipartHttpClient: this.serviceClient,
      jobStore,
      jobFiles: this.jobFiles,
      findGenerator: (baseUrl) => this.generatorSettings.findJobGenerator(baseUrl),
      registerPlayerFile: (location) => this.musicSources.register(location),
      writeSong: (options) => this.takeRecordTurn(() => this.writeGeneratedSongIntoGame(options)),
      saveReport: (report) => this.saveReport(report),
      addSongToLibrary: (librarySongId) => this.buildClient().addToLibrary(librarySongId),
      addLibrarySongToGame: (options) => this.addLibrarySongToGame(options),
      logActivity: (event) => this.saveSettings(withActivity({ settings: this.settings, events: [event] })),
      waitMilliseconds: delay,
      getNow: () => new Date().toISOString(),
      onChange: () => { this.publish(); },
    });
  }

  /** Link jobs from the website, while the app runs and this computer is linked; they share the link tab's finder. */
  private createSiteLinkJobs(): SiteLinkJobs {
    return new SiteLinkJobs({
      buildApi: () => (this.deviceToken === null ? null : this.buildClient()),
      getAddons: () => this.settings.addons,
      songs: this.makeSongMusic,
      addonHttpClient: this.serviceClient,
      jobFiles: new GeneratorJobFiles({ jobsFolder: path.join(this.options.dataFolder, 'link-jobs'), musicSources: this.musicSources, appVersion: this.options.appVersion }),
      sourceStore: new JsonFileStore<LinkSongSource[]>({ filePath: path.join(this.options.dataFolder, 'link-song-sources.json'), buildDefault: () => [], parse: loadLinkSongSources }),
      computerName: this.options.computerName,
      appVersion: this.options.appVersion,
      getNowMilliseconds: () => Date.now(),
      waitMilliseconds: delay,
      log: (line) => { this.options.logSupportLine(line); },
      onSignedOut: () => { void this.handleSignedOutFromLinkJobs(); },
      installSong: ({ librarySongId }) => this.installSongForSite(librarySongId),
      checkVideo: ({ job, wait }) => this.checkVideoForSite({ job, wait }),
      findMusicByName: (options) => this.findMusicByNameForSite(options),
    });
  }

  /** A song picked on the website, by its facts: the music goes where Sync keeps addons' files, measured as the Make page does. */
  private findMusicByNameForSite({ song, wait, addonId }: { song: NameFindSongFacts; wait: AddonWait; addonId: string | null }): Promise<NameFindOutcome> {
    return findMusicByName({
      song,
      wait,
      addonId,
      ports: {
        getAddons: () => this.settings.addons,
        addonHttpClient: this.serviceClient,
        downloadAddonFile: (download) => this.downloadAddonFile(download),
        measureLength: async (sourceId) => {
          const source = this.musicSources.getSource(sourceId);
          if (!source) throw new Error('The music your addon got is gone. Try again.');
          return this.options.audioBridge.measureLength(new Uint8Array(await readFile(source.filePath)));
        },
      },
    });
  }

  /** "Into my game" from the website: the song is already in the library list, so this is a sync now, then a check. */
  private installSongForSite(librarySongId: string): Promise<SiteSongInstallResult> {
    return installSongForSite({
      librarySongId,
      ports: {
        hasGame: () => this.settings.game !== null,
        isGameRunning: () => this.options.services.isGameRunning(),
        waitForRunningSync: async () => {
          const wasSyncRunning = this.syncRun !== null;
          while (this.syncRun) await delay(1000);
          return wasSyncRunning ? this.lastOutcome : null;
        },
        syncNow: () => this.syncNowForOutcome(),
        getProblem: () => this.problem,
        getSongsFolder: () => this.buildSongsFolder(),
        isAddonFile: (sourceId) => this.addonNamesBySourceId.has(sourceId),
        getNowMilliseconds: () => Date.now(),
        waitMilliseconds: delay,
      },
    });
  }

  /** A verify job from the website: the job's link addon gets the video's music, which is compared with the song. */
  private checkVideoForSite({ job, wait }: { job: VerifyLinkJob; wait: AddonWait }): Promise<SiteVideoCheckAnswer> {
    return checkVideoForSite({
      job,
      wait,
      ports: {
        getAddons: () => this.settings.addons,
        addonHttpClient: this.serviceClient,
        downloadAddonFile: (download) => this.downloadAddonFile(download),
        fetchFingerprint: (librarySongId) => this.buildClient().fetchFingerprint(librarySongId),
        compareVideoAudio: async ({ sourceId, fingerprint }) => {
          const source = this.musicSources.getSource(sourceId);
          if (!source) throw new Error('The music from that video is gone. Try again.');
          return this.options.audioBridge.compareVideoAudio({ bytes: new Uint8Array(await readFile(source.filePath)), fingerprint });
        },
      },
    });
  }

  /** A sync now, after any sync already running: its outcome, or null when it didn't run or stopped with a problem. */
  private async syncNowForOutcome(): Promise<SyncOutcome | null> {
    while (this.syncRun) await delay(1000);
    const outcomeBefore = this.lastOutcome;
    await this.syncNow();
    return this.lastOutcome === outcomeBefore ? null : this.lastOutcome;
  }

  /** Syncs and generated songs take turns with the record, so neither writes over the other's changes. */
  private takeRecordTurn<Result>(work: () => Promise<Result>): Promise<Result> {
    const turn = this.recordTurn.then(work, work);
    this.recordTurn = turn.catch(() => undefined);
    return turn;
  }

  private async writeGeneratedSongIntoGame({ request, librarySongChoice }: { request: GeneratedSongRequest; librarySongChoice: LibrarySongChoice | null }): Promise<GeneratedSongWriteResult> {
    const dependencies = { songsFolder: this.buildSongsFolder(), readDownloadedPicture: (sourceId: string) => this.jobFiles.readDownloadedPicture(sourceId), pictureMaker: this.options.audioBridge, createId: randomUUID, getNow: () => new Date().toISOString() };
    const result = await writeGeneratedSong({ dependencies, record: this.record, request, librarySongs: await this.fetchLibrarySongIdentities(), librarySongChoice });
    if (result.kind === 'needs-library-choice') return result;
    this.record = result.record;
    await this.recordStore.save(result.record);
    if (result.kind === 'written') void this.reportComputerSongs();
    const replacedLibrarySongId = result.kind === 'written' ? result.generatedSong.inPlaceOfLibrarySongId : null;
    // The library song the player chose to replace leaves the game on the next sync, like a song removed from the library.
    if (replacedLibrarySongId !== null) await this.saveSettings(withSongChoice({ settings: this.settings, librarySongId: replacedLibrarySongId, action: 'remove-from-game' }));
    return result;
  }

  private async fetchLibrarySongIdentities(): Promise<LibrarySongIdentity[]> {
    const librarySongs = this.lastOutcome?.librarySongs ?? (await this.buildLibrary().fetchLibrary().catch(() => []));
    return librarySongs.map(({ librarySongId, title, artist, videoId }) => ({ librarySongId, title, artist, videoId }));
  }

  private async saveReport({ songKey, reportText }: { songKey: string; reportText: string }): Promise<void> {
    await mkdir(this.reportsFolder, { recursive: true });
    await writeFile(path.join(this.reportsFolder, getReportFileName(songKey)), reportText, 'utf8');
    this.reportSongKeys.add(getReportFileName(songKey));
  }

  /** Spending a token happens on dancedance.studio, so the balance is read again after each dancedance.studio song. */
  private async refreshTokenBalance(): Promise<void> {
    if (this.deviceToken === null) return;
    this.tokenBalance = await this.buildClient().fetchAccount().then((account) => account.tokenBalance, () => this.tokenBalance);
    this.publish();
  }

  /**
   * dancedance.studio's generator put the song in the library, so a sync installs it like any library song, with the music the
   * player gave when the song still needs audio. The song is the one dancedance.studio named; an older dancedance.studio that names
   * none is matched by the song's facts.
   */
  private async addLibrarySongToGame({ job, librarySongId }: { job: SavedGeneratorJob; librarySongId: string | null }): Promise<void> {
    void this.refreshTokenBalance();
    while (this.syncRun) await delay(1000);
    await this.syncNow();
    const librarySongs = this.lastOutcome?.librarySongs ?? [];
    const librarySong = librarySongs.find((song) => song.librarySongId === librarySongId) ?? findSameLibrarySong({ song: job.song, librarySongs });
    const songPlan = this.lastOutcome?.finalPlan.songPlans.find((plan) => plan.librarySongId === librarySong?.librarySongId);
    if (!librarySong || songPlan?.status !== 'needs-audio') return;
    this.musicSources.register(job.playerMusicLocation);
    await this.saveSettings({ ...this.settings, pickedFilePathsBySongId: { ...this.settings.pickedFilePathsBySongId, [librarySong.librarySongId]: job.playerMusicLocation } });
    await this.syncNow();
    if (!job.playerMusicLocation.startsWith(this.jobFiles.getJobFolder(job.jobKey))) return;
    // A song source's download is removed with the job; the song keeps its own copy in the game.
    const pickedFilePathsBySongId = Object.fromEntries(Object.entries(this.settings.pickedFilePathsBySongId).filter(([librarySongId]) => librarySongId !== librarySong.librarySongId));
    await this.saveSettings({ ...this.settings, pickedFilePathsBySongId });
  }

  private async runOneSync(): Promise<void> {
    const outcome = await runSync({ ports: this.buildPorts(), settings: this.buildSyncSettings(), onPhase: (phase) => {
      this.syncRun = phase.kind === 'reading-library'
        ? { currentSongNumber: 0, totalSongCount: 0, currentStepText: 'Reading your library…' }
        : phase.kind === 'finding-audio'
          ? { currentSongNumber: phase.doneSongCount + 1, totalSongCount: phase.totalSongCount, currentStepText: 'Finding audio and checking it’s the same edit' }
          : { currentSongNumber: phase.progress.doneSongCount, totalSongCount: phase.progress.totalSongCount, currentStepText: 'Writing to your game' };
      this.publish();
    } });
    this.lastOutcome = outcome;
    this.record = outcome.record;
    this.playerGroupNames = this.settings.game ? await getPlayerGroupNames({ songsFolder: this.buildSongsFolder(), record: this.record }) : [];
    const songPlans = outcome.finalPlan.songPlans;
    this.finishedSync = { syncedCount: songPlans.filter((songPlan) => songPlan.status === 'synced').length, needsYouCount: songPlans.filter((songPlan) => songPlan.status !== 'synced').length };
    await this.saveSettings(withSettledChoices({ settings: withActivity({ settings: { ...this.settings, lastSyncAt: new Date().toISOString() }, events: outcome.events }), outcome }));
    await this.reportSeen(outcome);
    await this.reportComputerSongs();
  }

  private async handleSyncError(error: unknown): Promise<void> {
    if (error instanceof SignedOutError) await this.signOut();
    this.problem = error instanceof Error ? error.message : 'The sync stopped. Try again in a minute.';
  }

  /** The site refused this computer's token: Sync forgets it, and the player signs in again with a new code. */
  private async signOut(): Promise<void> {
    this.deviceToken = null;
    this.signIn = { kind: 'signed-out' };
    await Promise.all([this.siteLinkJobs.stop({ isLeaving: false }), this.options.tokenStore.clear()]);
  }

  /** Presence or a link job found this computer signed out: the same as when a sync does. */
  private async handleSignedOutFromLinkJobs(): Promise<void> {
    await this.signOut();
    this.problem = new SignedOutError().message;
    this.publish();
  }

  private async reportSeen(outcome: SyncOutcome): Promise<void> {
    const songCountsByStatus: Record<string, number> = {};
    for (const songPlan of outcome.finalPlan.songPlans) songCountsByStatus[songPlan.status] = (songCountsByStatus[songPlan.status] ?? 0) + 1;
    await this.buildClient().reportSeen({ songCountsByStatus, gameName: this.settings.game?.gameName ?? null }).catch(() => undefined);
  }

  /** Keeps My songs on the site ("This PC") in step with the songs generators made here; the site keeps no music. */
  private async reportComputerSongs(): Promise<void> {
    if (this.deviceToken === null) return;
    await this.buildClient().reportComputerSongs(buildComputerSongReports(getGeneratedSongs(this.record))).catch(() => undefined);
  }

  private async waitForSignIn({ pollingId, intervalSeconds }: { pollingId: string; intervalSeconds: number }): Promise<void> {
    while (this.signIn.kind === 'waiting-for-code') {
      await delay(intervalSeconds * 1000);
      const poll = await pollDeviceSignIn({ httpClient: this.httpClient, siteUrl: this.options.siteUrl, pollingId }).catch(() => ({ status: 'waiting' as const }));
      if (poll.status === 'waiting') continue;
      if (poll.status === 'expired') {
        this.signIn = { kind: 'signed-out' };
        this.problem = 'The code expired. Choose "Get a new code" and type it on dancedance.studio/link.';
      } else {
        this.deviceToken = poll.deviceToken;
        await this.options.tokenStore.save(poll.deviceToken);
        this.signIn = { kind: 'signed-in', computerName: poll.deviceName };
        this.siteLinkJobs.start();
        void this.generatorSettings.loadDancedanceGenerator().then(() => { this.publish(); });
        void this.refreshTokenBalance();
      }
      this.publish();
    }
    await this.syncNow();
  }

  private async connectGame(game: { gameName: string; songsFolderPath: string }): Promise<void> {
    await this.saveSettings({ ...this.settings, game });
    await this.syncNow();
  }

  private async scanMusic(): Promise<void> {
    this.scannedFileCount = 0;
    this.publish();
    this.musicIndex = await scanMusicLibrary({
      musicLibrary: new NodeMusicLibrary({ musicFolders: this.settings.musicFolders, musicSources: this.musicSources }),
      onProgress: ({ scannedFileCount }) => {
        this.scannedFileCount = scannedFileCount;
        this.publish();
      },
    });
    this.publish();
  }

  private buildPorts(): SyncPorts {
    return {
      songsFolder: this.buildSongsFolder(),
      library: this.buildLibrary(),
      recordStore: this.recordStore,
      httpClient: this.serviceClient,
      checkAudioSource: async ({ sourceId, fingerprint }) => {
        const source = this.musicSources.getSource(sourceId);
        if (!source) return { kind: 'different-edit', sourceId };
        return this.options.audioBridge.checkAudio({ sourceId, bytes: new Uint8Array(await readFile(source.filePath)), fingerprint });
      },
      downloadAddonFile: (options) => this.downloadAddonFile(options),
      createId: randomUUID,
      getNow: () => new Date().toISOString(),
    };
  }

  /** The library without the songs the player replaced with one they made: those stay out of the game. */
  private buildLibrary(): SyncLibrary {
    const client = this.buildClient();
    const replacedLibrarySongIds = new Set(getGeneratedSongs(this.record).flatMap((generatedSong) => generatedSong.inPlaceOfLibrarySongId ?? []));
    return {
      fetchLibrary: async () => (await client.fetchLibrary()).filter((song) => !replacedLibrarySongIds.has(song.librarySongId)),
      // Party copies stay even for a song the player replaced with their own: the list is shared with other players.
      fetchPartyLists: () => client.fetchPartyLists(),
      fetchFingerprint: (librarySongId) => client.fetchFingerprint(librarySongId),
      fetchSongFiles: (request) => client.fetchSongFiles(request),
    };
  }

  private buildSyncSettings() {
    const pickedSourceIdsBySongId = new Map(Object.entries(this.settings.pickedFilePathsBySongId).map(([librarySongId, filePath]) => [librarySongId, this.musicSources.register(filePath)]));
    return {
      layout: this.settings.layout,
      shouldUpdateAutomatically: this.settings.shouldUpdateAutomatically,
      choices: { replaceEditedSongIds: new Set(this.settings.replaceEditedSongIds), removeFromGameSongIds: new Set(this.settings.removeFromGameSongIds), updateSongIds: new Set(this.settings.updateSongIds) },
      pickedSourceIdsBySongId,
      musicIndex: this.musicIndex,
      addons: this.settings.addons,
    };
  }

  private buildSongsFolder(): NodeSongsFolder {
    if (!this.settings.game) throw new Error('Connect your game first.');
    return new NodeSongsFolder({ rootFolder: this.settings.game.songsFolderPath, musicSources: this.musicSources, convertMusicToWav: async ({ filePath }) => this.options.audioBridge.convertToWav(new Uint8Array(await readFile(filePath))) });
  }

  private buildClient(): DancedanceClient {
    return new DancedanceClient({ httpClient: this.httpClient, fileUploadClient: this.fileUploadClient, siteUrl: this.options.siteUrl, deviceToken: this.deviceToken });
  }

  /** An addon's file goes into the app's own folder (never the music folders), named by a hash of its address. */
  private async downloadAddonFile({ url, fileName, addonName }: { url: string; fileName: string | null; addonName: string }): Promise<string> {
    const response = await this.serviceClient.requestBytes({ url, method: 'GET', timeoutMilliseconds: ADDON_DOWNLOAD_TIMEOUT_MILLISECONDS, maxResponseBytes: MAX_ADDON_FILE_BYTES });
    if (response.status !== 200) throw new Error(`The addon's file answered ${String(response.status)}.`);
    const extension = path.extname(fileName ?? new URL(url).pathname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.audio';
    const filePath = path.join(this.options.dataFolder, 'addon-downloads', `${createHash('sha256').update(url).digest('hex').slice(0, 24)}${extension}`);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, response.body);
    const sourceId = this.musicSources.register(filePath);
    this.addonNamesBySourceId.set(sourceId, addonName);
    return sourceId;
  }

  private async saveSettings(settings: DesktopSettings): Promise<void> {
    this.settings = settings;
    // A link addon turned on or off, added or removed changes the website's link option at once, not 30 s later.
    this.siteLinkJobs.handleAddonsChange();
    await this.settingsStore.save(settings);
    this.publish();
  }

  private publish(): void {
    this.options.onStateChange(this.buildState());
  }

  private buildState(): DesktopSyncState {
    const outcome = this.lastOutcome;
    const songViewInput = {
      librarySongs: outcome?.librarySongs ?? [],
      songPlans: outcome?.finalPlan.songPlans ?? [],
      audioResultsBySongId: outcome?.audioResultsBySongId ?? new Map(),
      record: this.record,
      pickedSongIds: new Set(Object.keys(this.settings.pickedFilePathsBySongId)),
      addonNamesBySourceId: this.addonNamesBySourceId,
    };
    const songs = buildSongRows(songViewInput);
    const layoutViews = buildLayoutViews({ librarySongs: outcome?.librarySongs ?? [], record: this.record, playerGroupNames: this.playerGroupNames });
    const readyUpdateVersion = this.appUpdates?.readyVersion ?? null;
    const partyFolderInput = { partyFolderPlans: outcome?.finalPlan.partyFolderPlans, partyLists: outcome?.partyLists ?? null, record: this.record, now: new Date() };
    return {
      appVersion: this.options.appVersion,
      siteUrl: this.options.siteUrl,
      signIn: this.signIn,
      game: this.settings.game,
      foundGames: this.foundGames.map((game) => ({ gameId: game.gameId, gameName: game.gameName, versionText: null, songsFolderPath: game.songsFolderPath, songCountText: `${game.songCount.toLocaleString('en-US')} songs` })),
      searchedPlacesText: 'checked every drive’s Games and Program Files folders',
      musicFolders: this.settings.musicFolders.map((folderPath) => ({ folderPath, scanState: this.scannedFileCount === null ? 'waiting' : 'scanned', summaryText: `${(this.musicIndex?.fileCount ?? 0).toLocaleString('en-US')} music files` })),
      scannedFileCount: this.scannedFileCount,
      pickedFiles: Object.entries(this.settings.pickedFilePathsBySongId).map(([librarySongId, filePath]) => ({ librarySongId, title: songs.find((song) => song.librarySongId === librarySongId)?.title ?? 'A song', fileName: path.basename(filePath), status: songs.find((song) => song.librarySongId === librarySongId)?.status ?? 'needs-audio' })),
      addons: this.settings.addons.map((addon) => buildAddonView(addon)),
      dancedanceGenerator: this.generatorSettings.buildDancedanceGeneratorView(),
      generators: this.settings.generators.map((generator) => buildGeneratorView({ generator, startCommand: this.settings.startCommandsByBaseUrl[generator.baseUrl] ?? null })),
      linksTab: buildLinksTab(this.settings.addons),
      songSourceTabs: buildSongSourceTabs(this.settings.addons),
      generatorJobs: [...this.jobRunner.jobs].reverse().map(buildGeneratorJobView),
      preselectedSong: this.songLink ? { preselectionKey: this.songLink.preselectionKey, title: this.songLink.title, artist: this.songLink.artist } : null,
      browserPairing: { bridgeAddress: this.bridgeServer.port === null ? null : `http://${LOCAL_BRIDGE_HOST}:${String(this.bridgeServer.port)}`, code: this.browserPairing.getPendingCode()?.code ?? null, pairedBrowserCount: this.browserPairing.pairedBrowserCount },
      generatedSongs: buildGeneratedSongViews({ generatedSongs: getGeneratedSongs(this.record), reportSongKeys: new Set(getGeneratedSongs(this.record).flatMap((song) => (this.reportSongKeys.has(getReportFileName(song.songKey)) ? [song.songKey] : []))) }),
      layout: this.settings.layout,
      ...layoutViews,
      playerGroupNames: this.playerGroupNames,
      lastLayoutMove: this.lastLayoutMove,
      partyFolders: buildPartyFolderViews(partyFolderInput),
      partyFolderPreview: buildPartyFolderPreview(partyFolderInput),
      isBackgroundSyncOn: this.settings.isBackgroundSyncOn,
      songs,
      songDetailsById: buildSongDetailsById(songViewInput),
      syncRun: this.syncRun,
      finishedSync: this.finishedSync,
      lastSyncAt: this.settings.lastSyncAt,
      activity: buildActivityEntries({ events: this.settings.activity, librarySongs: outcome?.librarySongs ?? [] }),
      trayStatus: getTrayStatus({ isSyncing: this.syncRun !== null, isPaused: !this.settings.isBackgroundSyncOn, songPlans: outcome?.finalPlan.songPlans ?? [] }),
      updateVersion: readyUpdateVersion !== null && readyUpdateVersion !== this.dismissedUpdateVersion ? readyUpdateVersion : null,
      appVersions: buildAppVersionsView({ appUpdates: this.appUpdates, currentVersion: this.options.appVersion, settings: this.settings }),
      isStartWithWindowsOn: this.settings.shouldStartWithWindows,
      problem: this.problem,
    };
  }
}

/** A song's key can hold any title, so its report file is named by a hash of it. */
function getReportFileName(songKey: string): string {
  return `${createHash('sha256').update(songKey).digest('hex').slice(0, 32)}.md`;
}

function describeActivityKind(event: ActivityLogEvent): string {
  return event.kind === 'generated-song' ? `generated-song ${event.step} ${event.songTitle}` : event.kind;
}

/** A choice on a song's row, remembered until a sync has acted on it. */
function withSongChoice({ settings, librarySongId, action }: { settings: DesktopSettings; librarySongId: string; action: SongAction }): DesktopSettings {
  const add = (ids: string[]) => [...ids.filter((id) => id !== librarySongId), librarySongId];
  const drop = (ids: string[]) => ids.filter((id) => id !== librarySongId);
  if (action === 'update') return { ...settings, updateSongIds: add(settings.updateSongIds) };
  if (action === 'replace-with-dancedance') return { ...settings, replaceEditedSongIds: add(settings.replaceEditedSongIds) };
  if (action === 'keep-mine') return { ...settings, replaceEditedSongIds: drop(settings.replaceEditedSongIds) };
  if (action === 'remove-from-game') return { ...settings, removeFromGameSongIds: add(settings.removeFromGameSongIds) };
  if (action === 'keep-in-game') return { ...settings, removeFromGameSongIds: drop(settings.removeFromGameSongIds) };
  return settings;
}

/** Once a song is synced again (or gone), its one-off choices are done, so they never repeat by surprise. */
function withSettledChoices({ settings, outcome }: { settings: DesktopSettings; outcome: SyncOutcome }): DesktopSettings {
  const settledIds = new Set(outcome.finalPlan.songPlans.filter((songPlan) => songPlan.status === 'synced').map((songPlan) => songPlan.librarySongId));
  const remainingIds = new Set(outcome.finalPlan.songPlans.map((songPlan) => songPlan.librarySongId));
  const isOpen = (id: string) => remainingIds.has(id) && !settledIds.has(id);
  return { ...settings, updateSongIds: settings.updateSongIds.filter(isOpen), replaceEditedSongIds: settings.replaceEditedSongIds.filter(isOpen), removeFromGameSongIds: settings.removeFromGameSongIds.filter(isOpen) };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
