import { randomUUID } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  getFileNameFacts,
  getLinkAudioContentTypeOrNull,
  getMusicFileFacts,
  getSongSourceInputValues,
  InvalidSongSourceInputError,
  MAX_GENERATOR_MUSIC_BYTES,
  MAX_GENERATOR_VIDEO_BYTES,
  MAX_LINK_AUDIO_BYTES,
  MAX_LINK_AUDIO_SECONDS,
  searchMusicIndex,
  waitForSongSource,
  type GeneratorManifest,
  type GeneratorSongFacts,
  type GeneratorUploadFile,
  type HttpClient,
  type InstalledAddon,
  type LinkJobAudio,
  type MusicIndex,
  type SongMusicSource,
  type SongSourceChoice,
  type SongSourceFileLink,
  type SongSourceSong,
} from '@dancedance/sync-core';
import type { MusicChoiceView, SongSourceSearchResult } from '@dancedance/sync-ui';
import type { MusicSourceRegistry } from './music-source-registry';

const UNKNOWN_ARTIST = 'Unknown artist';
const WAV_CONTENT_TYPE = 'audio/wav';
const STOP_CHECK_EVERY_MILLISECONDS = 250;
/** The music types the player's files have, by extension; anything else is sent as WAV when the generator takes it. */
const MUSIC_CONTENT_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = { mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/opus', webm: 'audio/webm' };
const KNOWN_MUSIC_EXTENSIONS = new Set(Object.keys(MUSIC_CONTENT_TYPES_BY_EXTENSION));
const KNOWN_VIDEO_EXTENSIONS = new Set(['mp4', 'm4v']);

/** Music the player picked: a file on this computer, or a song a song source found (downloaded only when it is made). */
type MusicChoice =
  | { kind: 'file'; filePath: string; title: string; artist: string }
  | { kind: 'song-source'; source: SongMusicSource; song: SongSourceSong; musicLink: SongSourceFileLink; videoLink: SongSourceFileLink | null };

/** What the platform does for the Make a song page: decode, convert, download. */
export interface MakeSongMusicPorts {
  httpClient: HttpClient;
  musicSources: MusicSourceRegistry;
  measureLength(bytes: Uint8Array): Promise<number>;
  convertToWav(bytes: Uint8Array): Promise<Uint8Array>;
  /** Half convertToWav's size, for music that must fit the website's 30 MB. */
  convertToMonoWav(bytes: Uint8Array): Promise<Uint8Array>;
  downloadFile(options: { url: string; filePath: string; maxBytes: number }): Promise<void>;
  waitMilliseconds(milliseconds: number): Promise<void>;
}

/** A song a song source found, kept as a choice to make later by its musicId: nothing is downloaded yet. */
export interface FoundSongChoice extends SongSourceChoice {
  musicId: string;
}

export type FoundSongChoices = { kind: 'found'; source: SongMusicSource; choices: FoundSongChoice[] } | Exclude<SongSourceSearchResult, { kind: 'found' }>;

/** How to ask a song source: the link tab and the website's link jobs each wait and stop in their own way. */
export interface FindSongChoicesOptions {
  addon: InstalledAddon;
  valuesByInputId: Readonly<Record<string, string>>;
  httpClient: HttpClient;
  waitSeconds: (seconds: number) => Promise<void>;
  shouldStop: () => boolean;
}

/** Music that can't fit what the website takes for a link song. The message is a short sentence for the player. */
export class SiteMusicLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteMusicLimitError';
  }
}

/** A music file Sync kept is no longer on this computer (removed, or written over by another download). */
export class MusicFileGoneError extends Error {
  constructor() {
    super('The music file Sync kept for this song is gone.');
    this.name = 'MusicFileGoneError';
  }
}

/** The music of a song to make, ready to send: the right type for the generator, its length measured. */
export interface PreparedMusic {
  song: GeneratorSongFacts;
  music: GeneratorUploadFile;
  video: GeneratorUploadFile | null;
  /** The music and video that go into the game: the player's own file, or the song source's download. */
  playerMusicLocation: string;
  playerVideoLocation: string | null;
  /** The addon that found the music and the link the player typed; null for the player's own files. */
  source: SongMusicSource | null;
}

/**
 * The music side of the Make a song page: the player's files, their music folders, and song sources. The window only
 * ever sees a musicId; files are picked in the app's own dialog or found in folders the player chose.
 */
export class MakeSongMusic {
  private readonly ports: MakeSongMusicPorts;
  private readonly choicesById = new Map<string, MusicChoice>();
  private isSongSearchStopped = false;

  constructor(ports: MakeSongMusicPorts) {
    this.ports = ports;
  }

  /** A file the player picked in the app's own dialog. */
  addPickedFile(filePath: string): MusicChoiceView {
    const fileName = path.basename(filePath);
    const { title, artist } = getFileNameFacts(fileName);
    return this.addFileChoice({ musicId: this.ports.musicSources.register(filePath), filePath, title, artist: artist ?? UNKNOWN_ARTIST, sourceText: fileName });
  }

  /** Music in the folders Sync already scanned, by the words the player typed. */
  searchMusicFolders({ index, query }: { index: MusicIndex | null; query: string }): MusicChoiceView[] {
    if (!index) return [];
    return searchMusicIndex({ index, query }).flatMap((musicFile) => {
      const filePath = this.ports.musicSources.getSource(musicFile.sourceId)?.filePath;
      if (filePath === undefined) return [];
      const { title, artist } = getMusicFileFacts(musicFile);
      return [this.addFileChoice({ musicId: musicFile.sourceId, filePath, title, artist: artist ?? UNKNOWN_ARTIST, sourceText: [...musicFile.folderNames, musicFile.fileName].join('\\') })];
    });
  }

  /** The link tab: asks a song source for the song the player described, until it answers or the player stops it. */
  async findSong({ addon, valuesByInputId }: { addon: InstalledAddon; valuesByInputId: Readonly<Record<string, string>> }): Promise<SongSourceSearchResult> {
    this.isSongSearchStopped = false;
    const found = await this.findSongChoices({ addon, valuesByInputId, httpClient: this.ports.httpClient, waitSeconds: (seconds) => this.waitUnlessStopped(seconds), shouldStop: () => this.isSongSearchStopped });
    if (found.kind !== 'found') return found;
    return { kind: 'found', musics: found.choices.map((choice) => buildFoundMusicView({ choice, source: found.source })) };
  }

  stopFindingSong(): void {
    this.isSongSearchStopped = true;
  }

  /**
   * Asks a song source for the song the player described, as long as it keeps working on it or until stopped. Each song
   * it found becomes a choice; nothing is downloaded until one is made. The link tab and the website's link jobs share
   * it: every field is checked before the addon is asked, so a link from a site the addon doesn't list never reaches it.
   */
  async findSongChoices({ addon, valuesByInputId, httpClient, waitSeconds, shouldStop }: FindSongChoicesOptions): Promise<FoundSongChoices> {
    try {
      const source = buildSongMusicSource({ addon, valuesByInputId });
      const result = await waitForSongSource({ httpClient, addon, valuesByInputId, waitSeconds, shouldStop });
      if (result.kind === 'found') return { kind: 'found', source, choices: result.choices.map((choice) => this.addSongSourceChoice({ source, choice })) };
      if (result.kind === 'not-found') return { kind: 'not-found', message: result.addonError };
      return result;
    } catch (error) {
      if (error instanceof InvalidSongSourceInputError) return { kind: 'invalid-input', inputId: error.inputId, message: error.message };
      return { kind: 'not-answering', message: error instanceof Error ? error.message : `${addon.manifest.name} isn’t answering. Try again in a few minutes.` };
    }
  }

  /** A found song that will never be made (its find is forgotten). */
  forgetMusic(musicId: string): void {
    this.choicesById.delete(musicId);
  }

  /**
   * A found song's music as the website takes it for a link song: ogg, mp3, m4a or wav as it is; any other file, or one
   * over 30 MB, as WAV, in mono when stereo is still too big (WAV is the one format Sync can write). Only the music is
   * downloaded, never the video. Throws SiteMusicLimitError for music that can't fit.
   */
  async prepareMusicForSite({ musicId, folder }: { musicId: string; folder: string }): Promise<LinkJobAudio> {
    const choice = this.choicesById.get(musicId);
    if (choice?.kind !== 'song-source') throw new Error('Sync no longer has the song you picked. Find it again.');
    const musicPath = await this.downloadSongSourceMusic({ choice, folder });
    const musicBytes = new Uint8Array(await readFile(musicPath));
    const lengthSeconds = choice.song.lengthSeconds ?? (await this.ports.measureLength(musicBytes));
    return this.prepareBytesForSite({ musicPath, musicBytes, lengthSeconds, folder });
  }

  /**
   * A music file Sync already has (a name find's download), as the website takes it, the way prepareMusicForSite does.
   * Throws MusicFileGoneError when the file is no longer there, so it can be got again.
   */
  async prepareFileForSite({ sourceId, lengthSeconds, folder }: { sourceId: string; lengthSeconds: number; folder: string }): Promise<LinkJobAudio> {
    const musicPath = this.ports.musicSources.getSource(sourceId)?.filePath;
    const musicBytes = musicPath === undefined ? null : await readFile(musicPath).then((bytes) => new Uint8Array(bytes), () => null);
    if (musicPath === undefined || musicBytes === null) throw new MusicFileGoneError();
    return this.prepareBytesForSite({ musicPath, musicBytes, lengthSeconds, folder });
  }

  private async prepareBytesForSite({ musicPath, musicBytes, lengthSeconds, folder }: { musicPath: string; musicBytes: Uint8Array; lengthSeconds: number; folder: string }): Promise<LinkJobAudio> {
    if (lengthSeconds > MAX_LINK_AUDIO_SECONDS) throw new SiteMusicLimitError('It’s longer than 8 minutes.');
    const contentType = getLinkAudioContentTypeOrNull(musicBytes);
    if (contentType !== null && musicBytes.byteLength <= MAX_LINK_AUDIO_BYTES) return { sourceId: this.ports.musicSources.register(musicPath), contentType };
    return this.convertMusicForSite({ musicBytes, folder });
  }

  /** Gets the music ready for this generator, into the job's folder when it must be downloaded or converted. */
  async prepareMusic({ musicId, manifest, jobFolder }: { musicId: string; manifest: GeneratorManifest; jobFolder: string }): Promise<PreparedMusic> {
    const choice = this.choicesById.get(musicId);
    if (!choice) throw new Error('Sync lost the music you picked. Pick it again.');
    const files = choice.kind === 'file' ? { musicPath: choice.filePath, videoPath: null } : await this.downloadSongSourceFiles({ choice, jobFolder });
    const musicBytes = new Uint8Array(await readFile(files.musicPath));
    const lengthSeconds = choice.kind === 'song-source' && choice.song.lengthSeconds !== null ? choice.song.lengthSeconds : Math.round(await this.ports.measureLength(musicBytes));
    return {
      song: buildSongFacts({ choice, lengthSeconds }),
      music: await this.buildMusicUpload({ musicPath: files.musicPath, musicBytes, manifest, jobFolder }),
      video: files.videoPath === null ? null : await this.buildUploadFile({ filePath: files.videoPath, contentType: 'video/mp4' }),
      playerMusicLocation: files.musicPath,
      playerVideoLocation: files.videoPath,
      source: choice.kind === 'song-source' ? choice.source : null,
    };
  }

  private addFileChoice({ musicId, filePath, title, artist, sourceText }: { musicId: string; filePath: string; title: string; artist: string; sourceText: string }): MusicChoiceView {
    this.choicesById.set(musicId, { kind: 'file', filePath, title, artist });
    return { musicId, title, artist, sourceText, lengthText: null, hasVideo: false };
  }

  private addSongSourceChoice({ source, choice }: { source: SongMusicSource; choice: SongSourceChoice }): FoundSongChoice {
    const musicId = `found:${randomUUID()}`;
    this.choicesById.set(musicId, { kind: 'song-source', source, ...choice });
    return { ...choice, musicId };
  }

  /** Song-source files are trusted without a sound check (addons.md): there is nothing to compare a new song with. */
  private async downloadSongSourceFiles({ choice, jobFolder }: { choice: Extract<MusicChoice, { kind: 'song-source' }>; jobFolder: string }): Promise<{ musicPath: string; videoPath: string | null }> {
    const musicPath = await this.downloadSongSourceMusic({ choice, folder: jobFolder });
    if (!choice.videoLink) return { musicPath, videoPath: null };
    const videoPath = path.join(jobFolder, `source-video.${getLinkExtension({ link: choice.videoLink, knownExtensions: KNOWN_VIDEO_EXTENSIONS, fallback: 'mp4' })}`);
    // The video is an extra: the song is still made without it.
    const isVideoDownloaded = await this.ports.downloadFile({ url: choice.videoLink.url, filePath: videoPath, maxBytes: MAX_GENERATOR_VIDEO_BYTES }).then(() => true, () => false);
    return { musicPath, videoPath: isVideoDownloaded ? videoPath : null };
  }

  private async downloadSongSourceMusic({ choice, folder }: { choice: Extract<MusicChoice, { kind: 'song-source' }>; folder: string }): Promise<string> {
    const musicPath = path.join(folder, `source-music.${getLinkExtension({ link: choice.musicLink, knownExtensions: KNOWN_MUSIC_EXTENSIONS, fallback: 'ogg' })}`);
    await this.ports.downloadFile({ url: choice.musicLink.url, filePath: musicPath, maxBytes: MAX_GENERATOR_MUSIC_BYTES });
    return musicPath;
  }

  private async convertMusicForSite({ musicBytes, folder }: { musicBytes: Uint8Array; folder: string }): Promise<LinkJobAudio> {
    for (const convert of [(bytes: Uint8Array) => this.ports.convertToWav(bytes), (bytes: Uint8Array) => this.ports.convertToMonoWav(bytes)]) {
      const wavBytes = await convert(musicBytes);
      if (wavBytes.byteLength > MAX_LINK_AUDIO_BYTES) continue;
      const wavPath = path.join(folder, 'site-music.wav');
      await writeFile(wavPath, wavBytes);
      return { sourceId: this.ports.musicSources.register(wavPath), contentType: 'audio/wav' };
    }
    throw new SiteMusicLimitError('The music is over 30 MB, even as a WAV file.');
  }

  /**
   * The player's file as it is when the generator takes its type; else WAV when it takes WAV. Every generator takes Ogg
   * Vorbis, but Sync has no Ogg encoder, so a generator that takes neither the file's type nor WAV can't make it.
   */
  private async buildMusicUpload({ musicPath, musicBytes, manifest, jobFolder }: { musicPath: string; musicBytes: Uint8Array; manifest: GeneratorManifest; jobFolder: string }): Promise<GeneratorUploadFile> {
    const contentType = MUSIC_CONTENT_TYPES_BY_EXTENSION[path.extname(musicPath).slice(1).toLowerCase()] ?? 'audio/unknown';
    if (manifest.musicTypes.includes(contentType)) return this.buildUploadFile({ filePath: musicPath, contentType });
    if (!manifest.musicTypes.includes(WAV_CONTENT_TYPE)) throw new Error(`${manifest.name} doesn’t take this kind of music file. Pick a file of one of these types: ${manifest.musicTypes.join(', ')}.`);
    const wavPath = path.join(jobFolder, `${path.parse(musicPath).name}.wav`);
    await writeFile(wavPath, await this.ports.convertToWav(musicBytes));
    return this.buildUploadFile({ filePath: wavPath, contentType: WAV_CONTENT_TYPE });
  }

  private async buildUploadFile({ filePath, contentType }: { filePath: string; contentType: string }): Promise<GeneratorUploadFile> {
    return { sourceId: this.ports.musicSources.register(filePath), fileName: path.basename(filePath), contentType, bytes: (await stat(filePath)).size };
  }

  private async waitUnlessStopped(seconds: number): Promise<void> {
    for (let waitedMilliseconds = 0; waitedMilliseconds < seconds * 1000 && !this.isSongSearchStopped; waitedMilliseconds += STOP_CHECK_EVERY_MILLISECONDS) {
      await this.ports.waitMilliseconds(STOP_CHECK_EVERY_MILLISECONDS);
    }
  }
}

/**
 * The addon and the checked link the player typed (the first link field filled), kept with the song. Throws
 * InvalidSongSourceInputError like the call itself. Sync reads nothing out of the link: the song's facts, a video id
 * among them, come only from the addon's answer.
 */
function buildSongMusicSource({ addon, valuesByInputId }: { addon: InstalledAddon; valuesByInputId: Readonly<Record<string, string>> }): SongMusicSource {
  const inputValues = getSongSourceInputValues({ inputs: addon.manifest.inputs, valuesByInputId });
  const linkInput = addon.manifest.inputs.find((input) => input.kind === 'link' && inputValues[input.id] !== undefined);
  return { addonId: addon.manifest.id, addonName: addon.manifest.name, link: linkInput ? (inputValues[linkInput.id] ?? null) : null };
}

function buildFoundMusicView({ choice, source }: { choice: FoundSongChoice; source: SongMusicSource }): MusicChoiceView {
  const { song } = choice;
  return { musicId: choice.musicId, title: song.title, artist: song.artist, sourceText: `From ${source.addonName}`, lengthText: song.lengthSeconds === null ? null : formatLength(song.lengthSeconds), hasVideo: choice.videoLink !== null };
}

function buildSongFacts({ choice, lengthSeconds }: { choice: MusicChoice; lengthSeconds: number }): GeneratorSongFacts {
  if (choice.kind === 'file') return { title: choice.title, artist: choice.artist, album: null, genre: null, lengthSeconds, videoId: null };
  const { title, artist, album, genre, videoId } = choice.song;
  return { title, artist, album, genre, lengthSeconds, videoId };
}

/** The extension from the link's file name or address, when it is one Sync knows; otherwise the fallback. */
function getLinkExtension({ link, knownExtensions, fallback }: { link: SongSourceFileLink; knownExtensions: ReadonlySet<string>; fallback: string }): string {
  const extension = path.extname(link.fileName ?? new URL(link.url).pathname).slice(1).toLowerCase();
  return knownExtensions.has(extension) ? extension : fallback;
}

function formatLength(seconds: number): string {
  const wholeSeconds = Math.round(seconds);
  return `${String(Math.floor(wholeSeconds / 60))}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}
