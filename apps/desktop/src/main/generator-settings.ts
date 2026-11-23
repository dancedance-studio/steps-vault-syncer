import {
  buildInstalledGenerator,
  fetchGeneratorManifest,
  getAddonOptionValues,
  getMusicUploadWarningOrNull,
  getServiceBaseUrl,
  GENERATOR_DIFFICULTIES,
  isGeneratorOnThisComputer,
  isOnThisComputer,
  MAX_GENERATOR_MUSIC_BYTES,
  withAddonOptionValue,
  withMusicUploadConsent,
  type GeneratorManifest,
  type GeneratorSignIn,
  type HttpClient,
  type InstalledGenerator,
} from '@dancedance/sync-core';
import { buildGeneratorInstallPreview, getAddonOptionValuesFromViews, DANCEDANCE_GENERATOR_ID, type GeneratorInstallPreview, type GeneratorLookupResult, type ServiceLookupRequest, type DancedanceGeneratorView } from '@dancedance/sync-ui';
import type { DesktopSettings } from './desktop-settings';
import type { JobGenerator } from './generator-job-runner';
import { getStartCommandFolder, type LocalProgramStarter } from './local-program-starter';

const DANCEDANCE_GENERATOR_PATH = '/api/generator';
const DANCEDANCE_GENERATOR_NAME = 'dancedance.studio generator';

/** What the player sees in the app's own dialog before Sync may run a command. */
export interface StartCommandConfirmation {
  address: string;
  command: string;
  folder: string;
}

export interface GeneratorSettingsOptions {
  httpClient: HttpClient;
  starter: LocalProgramStarter;
  siteUrl: string;
  getDeviceToken(): string | null;
  /** The player's dancedance.studio tokens; null when not known. */
  getTokenBalance(): number | null;
  getSettings(): DesktopSettings;
  saveSettings(settings: DesktopSettings): Promise<void>;
  confirmStartCommand(confirmation: StartCommandConfirmation): Promise<boolean>;
  getNow(): string;
}

/**
 * The player's generators: dancedance.studio's own (built in, signed in with the device token, always first) and the community
 * generators they added, with the music upload consent kept per generator, and the start commands of programs on this
 * computer.
 */
export class GeneratorSettings {
  private readonly options: GeneratorSettingsOptions;
  private readonly dancedanceBaseUrl: string;
  private dancedanceManifest: GeneratorManifest | null = null;
  private readonly lookedUpGeneratorsByAddress = new Map<string, { baseUrl: string; manifest: GeneratorManifest; startCommand: string | null }>();

  constructor(options: GeneratorSettingsOptions) {
    this.options = options;
    this.dancedanceBaseUrl = getServiceBaseUrl({ address: `${options.siteUrl.replace(/\/+$/, '')}${DANCEDANCE_GENERATOR_PATH}`, serviceName: 'generator' });
  }

  /** Reads what dancedance.studio's generator makes; while it can't be reached, the screens say so. */
  async loadDancedanceGenerator(): Promise<void> {
    const signIn = this.getDancedanceSignIn();
    if (!signIn) return;
    const answer = await fetchGeneratorManifest({ httpClient: this.options.httpClient, address: this.dancedanceBaseUrl, signIn }).catch(() => null);
    if (answer) this.dancedanceManifest = answer.manifest;
  }

  buildDancedanceGeneratorView(): DancedanceGeneratorView {
    const hasConsent = this.options.getSettings().dancedanceMusicUploadConsentedAt !== null;
    return { tokenCount: this.options.getTokenBalance(), tokensHref: `${this.options.siteUrl}/tokens`, difficulties: this.dancedanceManifest?.difficulties ?? null, musicUploadWarning: hasConsent ? null : `Your music file will be sent to dancedance.studio (${this.dancedanceBaseUrl}).` };
  }

  /** The generator a job was started with. The sign-in goes to dancedance.studio's own generator only. */
  findJobGenerator(baseUrl: string): JobGenerator | null {
    if (baseUrl === this.dancedanceBaseUrl) return { generator: this.buildDancedanceGenerator(this.dancedanceManifest ?? buildDancedanceFallbackManifest()), signIn: this.getDancedanceSignIn(), isDancedance: true };
    const generator = this.options.getSettings().generators.find((candidate) => candidate.baseUrl === baseUrl);
    return generator ? { generator, signIn: null, isDancedance: false } : null;
  }

  /** The generator for a new song, after the player agreed to send their music to it when it is on another computer. */
  async getGeneratorForNewSong({ generatorId, hasAgreedToMusicUpload }: { generatorId: string; hasAgreedToMusicUpload: boolean }): Promise<JobGenerator> {
    if (generatorId === DANCEDANCE_GENERATOR_ID) return this.getDancedanceGeneratorForNewSong(hasAgreedToMusicUpload);
    const settings = this.options.getSettings();
    const generator = settings.generators.find((candidate) => candidate.manifest.id === generatorId);
    if (!generator) throw new Error('That generator isn’t set up any more. Add it again under Generators.');
    if (getMusicUploadWarningOrNull(generator) !== null) {
      if (!hasAgreedToMusicUpload) throw new Error(`Agree to send your music to ${generator.baseUrl} first, or use a generator on this computer.`);
      await this.saveGenerator(withMusicUploadConsent({ generator, consentedAt: this.options.getNow() }));
    }
    return { generator: this.options.getSettings().generators.find((candidate) => candidate.manifest.id === generatorId) ?? generator, signIn: null, isDancedance: false };
  }

  async lookUpGenerator({ address, startCommand }: ServiceLookupRequest): Promise<GeneratorLookupResult> {
    try {
      const confirmedCommand = startCommand === null ? null : await this.confirmStartCommand({ baseUrl: getServiceBaseUrl({ address, serviceName: 'generator' }), command: startCommand });
      const { baseUrl, manifest } = await fetchGeneratorManifest({ httpClient: this.options.httpClient, address });
      if (baseUrl === this.dancedanceBaseUrl) throw new Error('This is dancedance.studio’s own generator. It is always there, at the top of Generators.');
      this.lookedUpGeneratorsByAddress.set(address, { baseUrl, manifest, startCommand: confirmedCommand });
      return { kind: 'found', generator: buildGeneratorInstallPreview({ address, baseUrl, manifest, startCommand: confirmedCommand }) };
    } catch (error) {
      this.applyStartCommands();
      return { kind: 'failed', message: error instanceof Error ? error.message : 'No generator answered at this address. Check the address and that the generator is running.' };
    }
  }

  /** Adding an internet generator after its confirm step is the player's agreement to send it their music. */
  async installGenerator(preview: GeneratorInstallPreview): Promise<void> {
    const lookedUp = this.lookedUpGeneratorsByAddress.get(preview.address);
    if (!lookedUp) return;
    const generator = buildInstalledGenerator({ baseUrl: lookedUp.baseUrl, manifest: lookedUp.manifest, optionValues: getAddonOptionValuesFromViews(preview.options) });
    const generatorWithConsent = isGeneratorOnThisComputer(generator) ? generator : withMusicUploadConsent({ generator, consentedAt: this.options.getNow() });
    const settings = this.options.getSettings();
    const generators = [...settings.generators.filter((existing) => existing.manifest.id !== generator.manifest.id), generatorWithConsent];
    await this.options.saveSettings(this.withStartCommand({ settings: { ...settings, generators }, baseUrl: lookedUp.baseUrl, startCommand: lookedUp.startCommand }));
  }

  async removeGenerator(generatorId: string): Promise<void> {
    const settings = this.options.getSettings();
    await this.saveWithoutUnusedStartCommands({ ...settings, generators: settings.generators.filter((generator) => generator.manifest.id !== generatorId) });
  }

  async removeAddon(addonId: string): Promise<void> {
    const settings = this.options.getSettings();
    await this.saveWithoutUnusedStartCommands({ ...settings, addons: settings.addons.filter((addon) => addon.manifest.id !== addonId) });
  }

  async setGeneratorOption({ generatorId, optionId, value }: { generatorId: string; optionId: string; value: string }): Promise<void> {
    const generator = this.options.getSettings().generators.find((candidate) => candidate.manifest.id === generatorId);
    if (!generator) return;
    const values = getAddonOptionValues({ options: generator.manifest.options, savedValues: generator.optionValues });
    await this.saveGenerator({ ...generator, optionValues: withAddonOptionValue({ options: generator.manifest.options, values, optionId, value }) });
  }

  /**
   * Asks the player, in the app's own dialog, before Sync may ever run a command. The window only passes the text; it
   * can't run anything without the player's yes here. A command already saved for this address isn't asked again.
   */
  async confirmStartCommand({ baseUrl, command }: { baseUrl: string; command: string }): Promise<string> {
    if (!isOnThisComputer(baseUrl)) throw new Error('A start command is only for a program on this computer, at http://127.0.0.1 or http://localhost.');
    const isAlreadySaved = this.options.getSettings().startCommandsByBaseUrl[baseUrl] === command;
    if (!isAlreadySaved && !(await this.options.confirmStartCommand({ address: baseUrl, command, folder: getStartCommandFolder(command) }))) {
      throw new Error('You didn’t allow Sync to run that command. Start the program yourself, or add it without a start command.');
    }
    this.options.starter.setStartCommand({ baseUrl, command });
    return command;
  }

  /** The starter knows exactly the saved commands again, dropping one that was only being tried out. */
  applyStartCommands(): void {
    this.options.starter.replaceStartCommands(this.options.getSettings().startCommandsByBaseUrl);
  }

  withStartCommand({ settings, baseUrl, startCommand }: { settings: DesktopSettings; baseUrl: string; startCommand: string | null }): DesktopSettings {
    if (startCommand === null) return settings;
    return { ...settings, startCommandsByBaseUrl: { ...settings.startCommandsByBaseUrl, [baseUrl]: startCommand } };
  }

  private async getDancedanceGeneratorForNewSong(hasAgreedToMusicUpload: boolean): Promise<JobGenerator> {
    const signIn = this.getDancedanceSignIn();
    if (!signIn) throw new Error('Sign in to dancedance.studio first, so the song can go to your library.');
    if (this.options.getTokenBalance() === 0) throw new Error('You have no tokens left. Buy tokens on dancedance.studio, or pick a community generator.');
    if (!this.dancedanceManifest) await this.loadDancedanceGenerator();
    if (!this.dancedanceManifest) throw new Error('dancedance.studio can’t be reached right now. Check your internet connection, then try again.');
    const settings = this.options.getSettings();
    if (settings.dancedanceMusicUploadConsentedAt === null) {
      if (!hasAgreedToMusicUpload) throw new Error('Agree to send your music to dancedance.studio first, or use a generator on this computer.');
      await this.options.saveSettings({ ...settings, dancedanceMusicUploadConsentedAt: this.options.getNow() });
    }
    return { generator: this.buildDancedanceGenerator(this.dancedanceManifest), signIn, isDancedance: true };
  }

  private buildDancedanceGenerator(manifest: GeneratorManifest): InstalledGenerator {
    const generator = buildInstalledGenerator({ baseUrl: this.dancedanceBaseUrl, manifest: { ...manifest, name: DANCEDANCE_GENERATOR_NAME } });
    const consentedAt = this.options.getSettings().dancedanceMusicUploadConsentedAt;
    return consentedAt === null ? generator : withMusicUploadConsent({ generator, consentedAt });
  }

  private getDancedanceSignIn(): GeneratorSignIn | null {
    const deviceToken = this.options.getDeviceToken();
    return deviceToken === null ? null : { siteUrl: this.options.siteUrl, deviceToken };
  }

  private async saveGenerator(generator: InstalledGenerator): Promise<void> {
    const settings = this.options.getSettings();
    await this.options.saveSettings({ ...settings, generators: settings.generators.map((existing) => (existing.manifest.id === generator.manifest.id ? generator : existing)) });
  }

  /** A start command stays only while an addon or generator at its address does. */
  private async saveWithoutUnusedStartCommands(settings: DesktopSettings): Promise<void> {
    const usedBaseUrls = new Set([...settings.addons.map((addon) => addon.baseUrl), ...settings.generators.map((generator) => generator.baseUrl)]);
    const startCommandsByBaseUrl = Object.fromEntries(Object.entries(settings.startCommandsByBaseUrl).filter(([baseUrl]) => usedBaseUrls.has(baseUrl)));
    await this.options.saveSettings({ ...settings, startCommandsByBaseUrl });
    this.applyStartCommands();
  }
}

/** Enough to go on asking about a dancedance.studio job after a restart, before dancedance.studio's manifest is read again. */
function buildDancedanceFallbackManifest(): GeneratorManifest {
  return { protocol: 1, kind: 'generator', id: 'dancedance.generator', name: DANCEDANCE_GENERATOR_NAME, version: '', author: 'dancedance.studio', description: '', options: [], difficulties: GENERATOR_DIFFICULTIES, musicTypes: ['audio/ogg'], usesVideo: false, maxMusicBytes: MAX_GENERATOR_MUSIC_BYTES };
}
