import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildInstalledAddon, MAX_LINK_AUDIO_BYTES, scanMusicLibrary, type AddonManifest, type GeneratorManifest, type HttpClient, type HttpResponse } from '@dancedance/sync-core';
import { MakeSongMusic, SiteMusicLimitError, type MakeSongMusicPorts } from './make-song-music';
import { MusicSourceRegistry } from './music-source-registry';
import { NodeMusicLibrary } from './node-music-library';

const MANIFEST: GeneratorManifest = { protocol: 1, kind: 'generator', id: 'stepcat.tap-forge', name: 'Tap Forge', version: '1.2.0', author: '@stepcat', description: '', difficulties: ['Easy'], musicTypes: ['audio/ogg', 'audio/mpeg'], usesVideo: true, maxMusicBytes: 1_000_000, options: [] };
const SONG_SOURCE: AddonManifest = { protocol: 1, kind: 'addon', id: 'clip.songs', name: 'Clip Songs', version: '0.2.0', author: '@noa', description: '', provides: ['song-source'], options: [], inputs: [{ id: 'link', kind: 'link', label: 'Clip link', placeholder: null, sites: ['clips.example', 'media.example.org'] }] };

const OPEN_AUDIO_LINKS: AddonManifest = { protocol: 1, kind: 'addon', id: 'open.audio-links', name: 'Open Audio Links', version: '1.0.0', author: '@noa', description: '', provides: ['audio-links', 'video-links', 'song-source'], options: [], inputs: [{ id: 'link', kind: 'link', label: 'Clip link', placeholder: null, sites: ['clips.example', 'media.example.org'] }] };
const NIGHT_DRIVE_ANSWER = { status: 200, body: { song: { title: 'Night Drive', artist: 'Lumen Park', lengthSeconds: 221, videoId: 'Vid3o1d-x_Z' }, links: [{ kind: 'file-url', url: 'https://files.example.org/night-drive.ogg', label: 'Music', fileName: 'night-drive.ogg' }, { kind: 'file-url', media: 'video', url: 'https://files.example.org/night-drive.mp4', label: 'Video', fileName: null }] } };

function answerWith(answer: HttpResponse<unknown>): HttpClient {
  return { requestJson: () => Promise.resolve(answer), requestText: () => Promise.reject(new Error('Not used.')), requestBytes: () => Promise.reject(new Error('Not used.')) };
}

/** Finds the one song the addon answers with, through the link tab's own call, and gives its musicId. */
async function findOneSong(makeSongMusic: MakeSongMusic): Promise<string> {
  const addon = buildInstalledAddon({ baseUrl: 'http://127.0.0.1:7802', manifest: OPEN_AUDIO_LINKS, consentedAt: '' });
  const result = await makeSongMusic.findSong({ addon, valuesByInputId: { link: 'https://clips.example/v/night-drive' } });
  if (result.kind !== 'found') throw new Error(`Expected a song, got ${result.kind}.`);
  return result.musics[0]?.musicId ?? '';
}

let workFolder: string;
let jobFolder: string;

beforeEach(async () => {
  workFolder = await mkdtemp(path.join(os.tmpdir(), 'dancedance-make-song-test-'));
  jobFolder = path.join(workFolder, 'jobs', 'job-1');
  await mkdir(jobFolder, { recursive: true });
});

afterEach(async () => {
  await rm(workFolder, { recursive: true, force: true });
});

function buildMakeSongMusic(overrides: Partial<MakeSongMusicPorts> = {}): { makeSongMusic: MakeSongMusic; musicSources: MusicSourceRegistry; downloads: string[] } {
  const musicSources = new MusicSourceRegistry();
  const downloads: string[] = [];
  const makeSongMusic = new MakeSongMusic({
    httpClient: { requestJson: () => Promise.reject(new Error('offline')), requestText: () => Promise.reject(new Error('Not used.')), requestBytes: () => Promise.reject(new Error('Not used.')) },
    musicSources,
    measureLength: () => Promise.resolve(200.6),
    convertToWav: () => Promise.resolve(new Uint8Array([82, 73, 70, 70])),
    convertToMonoWav: () => Promise.resolve(new Uint8Array([82, 73, 70, 70, 49])),
    downloadFile: async ({ url, filePath }) => { downloads.push(url); await writeFile(filePath, url.endsWith('.mp4') ? 'video' : 'OggS'); },
    waitMilliseconds: () => Promise.resolve(),
    ...overrides,
  });
  return { makeSongMusic, musicSources, downloads };
}

describe('MakeSongMusic', () => {
  it('sends a picked file as it is when the generator takes its type, with facts from its name and its measured length', async () => {
    const filePath = path.join(workFolder, 'Lumen Park - Night Drive.mp3');
    await writeFile(filePath, 'ID3-music');
    const { makeSongMusic } = buildMakeSongMusic();
    const music = makeSongMusic.addPickedFile(filePath);
    expect(music).toMatchObject({ title: 'Night Drive', artist: 'Lumen Park', sourceText: 'Lumen Park - Night Drive.mp3' });
    const prepared = await makeSongMusic.prepareMusic({ musicId: music.musicId, manifest: MANIFEST, jobFolder });
    expect(prepared).toMatchObject({ song: { title: 'Night Drive', artist: 'Lumen Park', lengthSeconds: 201, videoId: null }, music: { fileName: 'Lumen Park - Night Drive.mp3', contentType: 'audio/mpeg', bytes: 9 }, video: null, playerMusicLocation: filePath, source: null });
  });

  it('converts a file to WAV for a generator that takes WAV but not its type, and refuses when it takes neither', async () => {
    const filePath = path.join(workFolder, 'Night Drive.flac');
    await writeFile(filePath, 'fLaC');
    const { makeSongMusic, musicSources } = buildMakeSongMusic();
    const music = makeSongMusic.addPickedFile(filePath);
    await expect(makeSongMusic.prepareMusic({ musicId: music.musicId, manifest: MANIFEST, jobFolder })).rejects.toThrow('Tap Forge doesn’t take this kind of music file. Pick a file of one of these types: audio/ogg, audio/mpeg.');
    const prepared = await makeSongMusic.prepareMusic({ musicId: music.musicId, manifest: { ...MANIFEST, musicTypes: ['audio/ogg', 'audio/wav'] }, jobFolder });
    expect(prepared.music).toMatchObject({ fileName: 'Night Drive.wav', contentType: 'audio/wav', bytes: 4 });
    expect(await readFile(musicSources.getSource(prepared.music.sourceId)?.filePath ?? '', 'utf8')).toBe('RIFF');
    expect(prepared.playerMusicLocation).toBe(filePath);
  });

  it('finds music in the scanned folders by the words typed', async () => {
    const musicFolder = path.join(workFolder, 'Music', 'Lumen Park');
    await mkdir(musicFolder, { recursive: true });
    await writeFile(path.join(musicFolder, 'Night Drive.ogg'), 'OggS');
    const { makeSongMusic, musicSources } = buildMakeSongMusic();
    const index = await scanMusicLibrary({ musicLibrary: new NodeMusicLibrary({ musicFolders: [path.join(workFolder, 'Music')], musicSources }) });
    const [music] = makeSongMusic.searchMusicFolders({ index, query: 'lumen night' });
    expect(music).toMatchObject({ title: 'Night Drive', artist: 'Unknown artist', sourceText: 'Music\\Lumen Park\\Night Drive.ogg' });
    expect(makeSongMusic.searchMusicFolders({ index: null, query: 'night' })).toEqual([]);
  });

  it('finds a song with a song source, then downloads its music and video into the job folder when it is made', async () => {
    const answer: HttpResponse<unknown> = { status: 200, body: { song: { title: 'Low Tide', artist: 'Marla Quinn', lengthSeconds: 242, videoId: 'Vid3o1d-x_Z' }, links: [{ kind: 'file-url', url: 'https://files.example.org/low-tide.ogg', label: 'Music', fileName: 'low-tide.ogg' }, { kind: 'file-url', media: 'video', url: 'https://files.example.org/low-tide.mp4', label: 'Video', fileName: null }] } };
    const httpClient: HttpClient = { requestJson: () => Promise.resolve(answer), requestText: () => Promise.reject(new Error('Not used.')), requestBytes: () => Promise.reject(new Error('Not used.')) };
    const { makeSongMusic, downloads } = buildMakeSongMusic({ httpClient });
    const addon = buildInstalledAddon({ baseUrl: 'http://127.0.0.1:7801', manifest: SONG_SOURCE, consentedAt: '' });
    const result = await makeSongMusic.findSong({ addon, valuesByInputId: { link: 'https://clips.example/watch?v=abc123' } });
    if (result.kind !== 'found') throw new Error(`Expected a song, got ${result.kind}.`);
    expect(result.musics).toMatchObject([{ title: 'Low Tide', artist: 'Marla Quinn', sourceText: 'From Clip Songs', lengthText: '4:02', hasVideo: true }]);
    expect(downloads).toEqual([]);
    const musicId = result.musics[0]?.musicId ?? '';
    const prepared = await makeSongMusic.prepareMusic({ musicId, manifest: MANIFEST, jobFolder });
    expect(downloads).toEqual(['https://files.example.org/low-tide.ogg', 'https://files.example.org/low-tide.mp4']);
    expect(prepared).toMatchObject({ song: { title: 'Low Tide', lengthSeconds: 242, videoId: 'Vid3o1d-x_Z' }, music: { contentType: 'audio/ogg' }, video: { contentType: 'video/mp4' }, playerMusicLocation: path.join(jobFolder, 'source-music.ogg'), playerVideoLocation: path.join(jobFolder, 'source-video.mp4') });
  });

  it('offers every song a song source found, and downloads only the one the player makes', async () => {
    const choice = (title: string, url: string): unknown => ({ song: { title, artist: 'Lumen Park' }, links: [{ kind: 'file-url', url, label: 'Music', fileName: null }] });
    const answer: HttpResponse<unknown> = { status: 200, body: { choices: [choice('Night Drive', 'https://files.example.org/a.ogg'), choice('Night Drive (Live)', 'https://files.example.org/b.ogg')] } };
    const httpClient: HttpClient = { requestJson: () => Promise.resolve(answer), requestText: () => Promise.reject(new Error('Not used.')), requestBytes: () => Promise.reject(new Error('Not used.')) };
    const { makeSongMusic, downloads } = buildMakeSongMusic({ httpClient });
    const addon = buildInstalledAddon({ baseUrl: 'http://127.0.0.1:7801', manifest: SONG_SOURCE, consentedAt: '' });
    const result = await makeSongMusic.findSong({ addon, valuesByInputId: { link: 'https://clips.example/watch?v=abc123' } });
    if (result.kind !== 'found') throw new Error(`Expected songs, got ${result.kind}.`);
    expect(result.musics.map((music) => music.title)).toEqual(['Night Drive', 'Night Drive (Live)']);
    await makeSongMusic.prepareMusic({ musicId: result.musics[1]?.musicId ?? '', manifest: MANIFEST, jobFolder });
    expect(downloads).toEqual(['https://files.example.org/b.ogg']);
  });

  it('shows a refused input under its field, without calling the addon', async () => {
    const { makeSongMusic } = buildMakeSongMusic();
    const addon = buildInstalledAddon({ baseUrl: 'http://127.0.0.1:7801', manifest: SONG_SOURCE, consentedAt: '' });
    expect(await makeSongMusic.findSong({ addon, valuesByInputId: { link: 'https://example.org/song' } })).toEqual({ kind: 'invalid-input', inputId: 'link', message: 'That site isn’t allowed here. Use a clips.example or media.example.org link.' });
    expect(await makeSongMusic.findSong({ addon, valuesByInputId: { link: 'https://clips.example/watch?v=abc123' } })).toMatchObject({ kind: 'not-answering' });
  });

  it('passes on a link addon’s not-found with its sentence, and a silent addon as not answering', async () => {
    const answers: HttpResponse<unknown>[] = [{ status: 200, body: { error: 'That clip is private.' } }, { status: 500, body: {} }];
    const requestedUrls: string[] = [];
    const httpClient: HttpClient = { requestJson: ({ url }) => { requestedUrls.push(url); return Promise.resolve(answers.shift() ?? { status: 500, body: {} }); }, requestText: () => Promise.reject(new Error('Not used.')), requestBytes: () => Promise.reject(new Error('Not used.')) };
    const { makeSongMusic } = buildMakeSongMusic({ httpClient });
    const addon = buildInstalledAddon({ baseUrl: 'http://127.0.0.1:7802', manifest: OPEN_AUDIO_LINKS, consentedAt: '' });
    expect(await makeSongMusic.findSong({ addon, valuesByInputId: { link: 'https://clips.example/watch?v=abc123' } })).toEqual({ kind: 'not-found', message: 'That clip is private.' });
    expect(await makeSongMusic.findSong({ addon, valuesByInputId: { link: 'https://clips.example/watch?v=abc123' } })).toMatchObject({ kind: 'not-answering' });
    expect(requestedUrls).toEqual(['http://127.0.0.1:7802/song-source', 'http://127.0.0.1:7802/song-source']);
  });

  it('keeps the link addon and the checked link with the music, and takes the video id only from the addon’s answer', async () => {
    const answers: HttpResponse<unknown>[] = [
      { status: 200, body: { song: { title: 'Night Drive', artist: 'Lumen Park', videoId: 'Vid3o1d-x_Z' }, links: [{ kind: 'file-url', url: 'https://files.example.org/a.ogg', label: 'Music', fileName: null }] } },
      { status: 200, body: { song: { title: 'Night Drive', artist: 'Lumen Park' }, links: [{ kind: 'file-url', url: 'https://files.example.org/b.ogg', label: 'Music', fileName: null }] } },
    ];
    const httpClient: HttpClient = { requestJson: () => Promise.resolve(answers.shift() ?? { status: 500, body: {} }), requestText: () => Promise.reject(new Error('Not used.')), requestBytes: () => Promise.reject(new Error('Not used.')) };
    const { makeSongMusic } = buildMakeSongMusic({ httpClient });
    const addon = buildInstalledAddon({ baseUrl: 'http://127.0.0.1:7802', manifest: OPEN_AUDIO_LINKS, consentedAt: '' });
    const source = { addonId: 'open.audio-links', addonName: 'Open Audio Links', link: 'https://clips.example/watch?v=abc123' };
    for (const videoId of ['Vid3o1d-x_Z', null]) {
      const result = await makeSongMusic.findSong({ addon, valuesByInputId: { link: ' https://clips.example/watch?v=abc123 ' } });
      if (result.kind !== 'found') throw new Error(`Expected a song, got ${result.kind}.`);
      const prepared = await makeSongMusic.prepareMusic({ musicId: result.musics[0]?.musicId ?? '', manifest: MANIFEST, jobFolder });
      expect(prepared).toMatchObject({ song: { title: 'Night Drive', videoId }, source });
    }
  });

  it('keeps no link for a search addon, only which addon found the music', async () => {
    const answer: HttpResponse<unknown> = { status: 200, body: { song: { title: 'Night Drive', artist: 'Lumen Park' }, links: [{ kind: 'file-url', url: 'https://files.example.org/a.ogg', label: 'Music', fileName: null }] } };
    const httpClient: HttpClient = { requestJson: () => Promise.resolve(answer), requestText: () => Promise.reject(new Error('Not used.')), requestBytes: () => Promise.reject(new Error('Not used.')) };
    const { makeSongMusic } = buildMakeSongMusic({ httpClient });
    const songScout: AddonManifest = { ...OPEN_AUDIO_LINKS, id: 'song.scout', name: 'Song Scout', inputs: [{ id: 'title', kind: 'search', label: 'Title', placeholder: null }] };
    const addon = buildInstalledAddon({ baseUrl: 'http://127.0.0.1:7803', manifest: songScout, consentedAt: '' });
    const result = await makeSongMusic.findSong({ addon, valuesByInputId: { title: 'Night Drive' } });
    if (result.kind !== 'found') throw new Error(`Expected a song, got ${result.kind}.`);
    const prepared = await makeSongMusic.prepareMusic({ musicId: result.musics[0]?.musicId ?? '', manifest: MANIFEST, jobFolder });
    expect(prepared.source).toEqual({ addonId: 'song.scout', addonName: 'Song Scout', link: null });
  });

  it('stops asking a link addon that is still working when the player presses Stop', async () => {
    const httpClient: HttpClient = { requestJson: () => Promise.resolve({ status: 202, body: { retryAfterSeconds: 5 } }), requestText: () => Promise.reject(new Error('Not used.')), requestBytes: () => Promise.reject(new Error('Not used.')) };
    let waitCount = 0;
    const { makeSongMusic } = buildMakeSongMusic({ httpClient, waitMilliseconds: () => { waitCount += 1; if (waitCount === 2) makeSongMusic.stopFindingSong(); return Promise.resolve(); } });
    const addon = buildInstalledAddon({ baseUrl: 'http://127.0.0.1:7802', manifest: OPEN_AUDIO_LINKS, consentedAt: '' });
    expect(await makeSongMusic.findSong({ addon, valuesByInputId: { link: 'https://media.example.org/watch?v=abc123' } })).toEqual({ kind: 'stopped' });
  });

  it('gets only the music of a found song for the website, as it is when the site takes its type', async () => {
    const { makeSongMusic, musicSources, downloads } = buildMakeSongMusic({ httpClient: answerWith(NIGHT_DRIVE_ANSWER) });
    const musicId = await findOneSong(makeSongMusic);
    const audio = await makeSongMusic.prepareMusicForSite({ musicId, folder: jobFolder });
    expect(audio.contentType).toBe('audio/ogg');
    expect(musicSources.getSource(audio.sourceId)?.filePath).toBe(path.join(jobFolder, 'source-music.ogg'));
    expect(downloads).toEqual(['https://files.example.org/night-drive.ogg']);
  });

  it('sends music the site doesn’t take as WAV, in mono when stereo is over 30 MB, and refuses music that still doesn’t fit', async () => {
    const tooBig = new Uint8Array(MAX_LINK_AUDIO_BYTES + 1);
    const writeFlac = async ({ filePath }: { filePath: string }): Promise<void> => { await writeFile(filePath, 'fLaC'); };
    const stereo = buildMakeSongMusic({ httpClient: answerWith(NIGHT_DRIVE_ANSWER), downloadFile: writeFlac });
    const stereoAudio = await stereo.makeSongMusic.prepareMusicForSite({ musicId: await findOneSong(stereo.makeSongMusic), folder: jobFolder });
    expect(stereoAudio.contentType).toBe('audio/wav');
    expect(await readFile(stereo.musicSources.getSource(stereoAudio.sourceId)?.filePath ?? '', 'utf8')).toBe('RIFF');
    const mono = buildMakeSongMusic({ httpClient: answerWith(NIGHT_DRIVE_ANSWER), downloadFile: writeFlac, convertToWav: () => Promise.resolve(tooBig) });
    const monoAudio = await mono.makeSongMusic.prepareMusicForSite({ musicId: await findOneSong(mono.makeSongMusic), folder: jobFolder });
    expect(await readFile(mono.musicSources.getSource(monoAudio.sourceId)?.filePath ?? '', 'utf8')).toBe('RIFF1');
    const neither = buildMakeSongMusic({ httpClient: answerWith(NIGHT_DRIVE_ANSWER), downloadFile: writeFlac, convertToWav: () => Promise.resolve(tooBig), convertToMonoWav: () => Promise.resolve(tooBig) });
    await expect(neither.makeSongMusic.prepareMusicForSite({ musicId: await findOneSong(neither.makeSongMusic), folder: jobFolder })).rejects.toThrow(new SiteMusicLimitError('The music is over 30 MB, even as a WAV file.'));
  });

  it('refuses music over 8 minutes for the website, measuring it when the addon didn’t say how long it is', async () => {
    const longSong = buildMakeSongMusic({ httpClient: answerWith({ ...NIGHT_DRIVE_ANSWER, body: { ...NIGHT_DRIVE_ANSWER.body, song: { title: 'Night Drive', artist: 'Lumen Park', lengthSeconds: 481 } } }) });
    await expect(longSong.makeSongMusic.prepareMusicForSite({ musicId: await findOneSong(longSong.makeSongMusic), folder: jobFolder })).rejects.toThrow(new SiteMusicLimitError('It’s longer than 8 minutes.'));
    const unknownLength = { ...NIGHT_DRIVE_ANSWER, body: { ...NIGHT_DRIVE_ANSWER.body, song: { title: 'Night Drive', artist: 'Lumen Park' } } };
    const measuredLong = buildMakeSongMusic({ httpClient: answerWith(unknownLength), measureLength: () => Promise.resolve(600) });
    await expect(measuredLong.makeSongMusic.prepareMusicForSite({ musicId: await findOneSong(measuredLong.makeSongMusic), folder: jobFolder })).rejects.toThrow(SiteMusicLimitError);
    const measuredShort = buildMakeSongMusic({ httpClient: answerWith(unknownLength), measureLength: () => Promise.resolve(221) });
    expect((await measuredShort.makeSongMusic.prepareMusicForSite({ musicId: await findOneSong(measuredShort.makeSongMusic), folder: jobFolder })).contentType).toBe('audio/ogg');
  });

  it('never asks a link addon about a link from a site it doesn’t list', async () => {
    const requestedUrls: string[] = [];
    const httpClient: HttpClient = { requestJson: ({ url }) => { requestedUrls.push(url); return Promise.resolve({ status: 200, body: {} }); }, requestText: () => Promise.reject(new Error('Not used.')), requestBytes: () => Promise.reject(new Error('Not used.')) };
    const { makeSongMusic } = buildMakeSongMusic({ httpClient });
    const addon = buildInstalledAddon({ baseUrl: 'http://127.0.0.1:7802', manifest: OPEN_AUDIO_LINKS, consentedAt: '' });
    for (const link of ['https://other.example.net/watch?v=abc123', 'https://clips.example.other.example/watch?v=abc123', 'javascript:alert(1)']) {
      expect(await makeSongMusic.findSong({ addon, valuesByInputId: { link } })).toMatchObject({ kind: 'invalid-input', inputId: 'link' });
    }
    expect(requestedUrls).toEqual([]);
  });
});
