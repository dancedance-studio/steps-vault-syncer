import { describe, expect, it } from 'vitest';
import { HttpRequestError, type HttpClient, type HttpRequest, type HttpResponse } from '../network/http-client';
import { buildInstalledAddon, loadSavedAddon } from './addon-client';
import type { AddonChoiceOption } from './addon-options';
import { getIgnoredAbilityReasonOrNull, isAddonProviding, parseAddonManifest, type AddonManifest } from './addon-protocol';
import { fetchSongSearch } from './song-search-client';
import type { SongSearchFacts } from './song-search-protocol';

const MEDIA_OPTION: AddonChoiceOption = { id: 'media', label: 'What to get', kind: 'choice', choices: [{ value: 'audio', label: 'Music only' }, { value: 'audio-and-video', label: 'Music and video' }], default: 'audio-and-video' };
const SONG_FINDER: AddonManifest = { protocol: 1, kind: 'addon', id: 'song.finder', name: 'Song Finder', version: '0.6.0', author: '@kai', description: 'Finds versions of a song.', provides: ['audio-links', 'video-links', 'song-search'], inputs: [], options: [MEDIA_OPTION] };
const SONG_FINDER_ADDON = buildInstalledAddon({ baseUrl: 'http://127.0.0.1:7810', manifest: SONG_FINDER, consentedAt: '2026-11-26T10:00:00.000Z' });
const PULSE_GARDEN: SongSearchFacts = { title: 'Pulse Garden', artist: 'Kairo Lights', album: 'Afterimage', lengthSeconds: 201 };
const OFFICIAL_VIDEO = {
  title: 'Kairo Lights - Pulse Garden (Official Video)', channel: 'Kairo Lights', lengthSeconds: 203, videoId: 'abc123DEF45',
  pageUrl: 'https://clips.example/watch?v=abc123DEF45', thumbnailUrl: 'https://img.clips.example/abc123DEF45.jpg', isOfficial: true,
};

/** Answers each request with the next canned answer, and remembers what was sent. */
class RecordedHttpClient implements HttpClient {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly answers: (HttpResponse<unknown> | HttpRequestError)[]) {}

  requestJson(request: HttpRequest): Promise<HttpResponse<unknown>> {
    this.requests.push(request);
    const answer = this.answers.shift();
    if (!answer) return Promise.reject(new Error('No recorded answer left.'));
    return answer instanceof HttpRequestError ? Promise.reject(answer) : Promise.resolve(answer);
  }

  requestText(): Promise<HttpResponse<string>> {
    return Promise.reject(new Error('Not used by addons.'));
  }

  requestBytes(): Promise<HttpResponse<Uint8Array>> {
    return Promise.reject(new Error('Not used by addons.'));
  }
}

async function searchWithAnswer(answer: HttpResponse<unknown> | HttpRequestError): ReturnType<typeof fetchSongSearch> {
  return fetchSongSearch({ httpClient: new RecordedHttpClient([answer]), addon: SONG_FINDER_ADDON, song: PULSE_GARDEN });
}

describe('song search manifests', () => {
  it('reads song-search next to audio-links, and loads it again from saved settings', () => {
    const manifest = parseAddonManifest({ ...SONG_FINDER, provides: ['song-search', 'audio-links'] });
    expect(manifest.provides).toEqual(['audio-links', 'song-search']);
    expect(isAddonProviding({ manifest, ability: 'song-search' })).toBe(true);
    expect(getIgnoredAbilityReasonOrNull(manifest)).toBeNull();
    const savedAddon = loadSavedAddon(JSON.parse(JSON.stringify(buildInstalledAddon({ baseUrl: 'http://127.0.0.1:7810', manifest, consentedAt: '2026-11-26T10:00:00.000Z' }))));
    expect(savedAddon && isAddonProviding({ manifest: savedAddon.manifest, ability: 'song-search' })).toBe(true);
  });

  it('ignores song-search without audio-links, keeps the other abilities, and says why on the card, after a restart too', () => {
    const songSourceInputs = [{ id: 'link', kind: 'link', label: 'Clip link', placeholder: null, sites: ['clips.example'] }];
    const manifest = parseAddonManifest({ ...SONG_FINDER, provides: ['song-search', 'song-source'], inputs: songSourceInputs });
    expect(isAddonProviding({ manifest, ability: 'song-source' })).toBe(true);
    expect(isAddonProviding({ manifest, ability: 'song-search' })).toBe(false);
    expect(getIgnoredAbilityReasonOrNull(manifest)).toBe('Sync ignores its song search, because it doesn’t give audio links too. Ask the addon’s maker.');
    const savedAddon = loadSavedAddon(JSON.parse(JSON.stringify(buildInstalledAddon({ baseUrl: 'http://127.0.0.1:7810', manifest, consentedAt: '2026-11-26T10:00:00.000Z' }))));
    expect(savedAddon && getIgnoredAbilityReasonOrNull(savedAddon.manifest)).toBe('Sync ignores its song search, because it doesn’t give audio links too. Ask the addon’s maker.');
  });

  it('refuses an addon whose only ability is song-search, since it can’t give the music', () => {
    expect(() => parseAddonManifest({ ...SONG_FINDER, provides: ['song-search'] })).toThrow('doesn’t provide anything this version of Sync can use');
  });
});

describe('fetchSongSearch', () => {
  it('sends only the song’s title, artist, album and length, with the options, in small answers with a timeout', async () => {
    const httpClient = new RecordedHttpClient([{ status: 200, body: { choices: [OFFICIAL_VIDEO] } }]);
    expect(await fetchSongSearch({ httpClient, addon: SONG_FINDER_ADDON, song: PULSE_GARDEN })).toEqual({ kind: 'found', choices: [OFFICIAL_VIDEO] });
    expect(httpClient.requests).toEqual([{
      url: 'http://127.0.0.1:7810/song-search', method: 'POST', timeoutMilliseconds: 20_000, maxResponseBytes: 65_536,
      jsonBody: { protocol: 1, song: { title: 'Pulse Garden', artist: 'Kairo Lights', album: 'Afterimage', lengthSeconds: 201 }, options: { media: 'audio-and-video' } },
    }]);
    const withoutOptions = buildInstalledAddon({ baseUrl: 'http://127.0.0.1:7810', manifest: { ...SONG_FINDER, options: [] }, consentedAt: '2026-11-26T10:00:00.000Z' });
    const noOptionsClient = new RecordedHttpClient([{ status: 200, body: { choices: [], error: 'Nothing.' } }]);
    await fetchSongSearch({ httpClient: noOptionsClient, addon: withoutOptions, song: { ...PULSE_GARDEN, album: null, lengthSeconds: null } });
    expect(noOptionsClient.requests[0]?.jsonBody).toStrictEqual({ protocol: 1, song: { title: 'Pulse Garden', artist: 'Kairo Lights', album: null, lengthSeconds: null } });
  });

  it('drops every version that breaks a rule, keeps the rest in order, and rounds the length', async () => {
    const choices = [
      { ...OFFICIAL_VIDEO, title: ' ' },
      { ...OFFICIAL_VIDEO, title: 'T'.repeat(201) },
      { ...OFFICIAL_VIDEO, channel: 'C'.repeat(101) },
      { ...OFFICIAL_VIDEO, channel: 42 },
      { ...OFFICIAL_VIDEO, lengthSeconds: 0 },
      { ...OFFICIAL_VIDEO, lengthSeconds: 3601 },
      { ...OFFICIAL_VIDEO, lengthSeconds: '203' },
      { ...OFFICIAL_VIDEO, videoId: 'short' },
      { ...OFFICIAL_VIDEO, videoId: 'abc123DEF4!' },
      { ...OFFICIAL_VIDEO, pageUrl: 'http://clips.example/watch?v=abc123DEF45' },
    ];
    expect(await searchWithAnswer({ status: 200, body: { choices } })).toEqual({ kind: 'not-found', addonError: null });
    const moreBroken = [
      { ...OFFICIAL_VIDEO, pageUrl: `https://clips.example/${'p'.repeat(2000)}` },
      { ...OFFICIAL_VIDEO, thumbnailUrl: 'http://img.clips.example/a.jpg' },
      'not a version',
      { ...OFFICIAL_VIDEO, videoId: 'Second_Vid1', title: 'Pulse\n Garden‮ (Live)', channel: null, thumbnailUrl: null, lengthSeconds: 240.6, isOfficial: 'yes' },
      { ...OFFICIAL_VIDEO, videoId: 'Third-Vid-2', channel: undefined, thumbnailUrl: undefined, isOfficial: undefined },
    ];
    expect(await searchWithAnswer({ status: 200, body: { choices: moreBroken } })).toEqual({
      kind: 'found',
      choices: [
        { ...OFFICIAL_VIDEO, videoId: 'Second_Vid1', title: 'Pulse Garden (Live)', channel: null, thumbnailUrl: null, lengthSeconds: 241, isOfficial: false },
        { ...OFFICIAL_VIDEO, videoId: 'Third-Vid-2', channel: null, thumbnailUrl: null, isOfficial: false },
      ],
    });
  });

  it('keeps the first 5 usable versions among the first 10, each video once', async () => {
    const versions = Array.from({ length: 12 }, (_, index) => ({ ...OFFICIAL_VIDEO, videoId: `video${String(index).padStart(6, '0')}` }));
    const answer = await searchWithAnswer({ status: 200, body: { choices: [versions[0], versions[0], ...versions.slice(1)] } });
    expect(answer.kind === 'found' ? answer.choices.map((choice) => choice.videoId) : []).toEqual(['video000000', 'video000001', 'video000002', 'video000003', 'video000004']);
    const lateGood = [...Array.from({ length: 10 }, () => ({ ...OFFICIAL_VIDEO, videoId: 'bad' })), OFFICIAL_VIDEO];
    expect(await searchWithAnswer({ status: 200, body: { choices: lateGood } })).toEqual({ kind: 'not-found', addonError: null });
  });

  it('reads nothing found with the addon’s sentence, and still working within sane limits', async () => {
    expect(await searchWithAnswer({ status: 200, body: { choices: [], error: 'Found nothing with the same length as the song.' } })).toEqual({ kind: 'not-found', addonError: 'Found nothing with the same length as the song.' });
    expect(await searchWithAnswer({ status: 200, body: { error: 'Nothing found.' } })).toEqual({ kind: 'not-found', addonError: 'Nothing found.' });
    expect(await searchWithAnswer({ status: 202, body: { retryAfterSeconds: 5 } })).toEqual({ kind: 'working', retryAfterSeconds: 5 });
    expect(await searchWithAnswer({ status: 202, body: { retryAfterSeconds: 9000 } })).toEqual({ kind: 'working', retryAfterSeconds: 600 });
  });

  it('says not answering for another status, an answer with neither versions nor a reason, or no answer at all', async () => {
    expect(await searchWithAnswer({ status: 500, body: { choices: [OFFICIAL_VIDEO] } })).toEqual({ kind: 'not-answering' });
    expect(await searchWithAnswer({ status: 200, body: {} })).toEqual({ kind: 'not-answering' });
    expect(await searchWithAnswer({ status: 200, body: [OFFICIAL_VIDEO] })).toEqual({ kind: 'not-answering' });
    expect(await searchWithAnswer(new HttpRequestError({ failure: 'timeout', message: 'Too slow.' }))).toEqual({ kind: 'not-answering' });
  });

  it('refuses to ask an addon whose song search is ignored', async () => {
    const ignored = buildInstalledAddon({ baseUrl: 'http://127.0.0.1:7810', manifest: { ...SONG_FINDER, provides: ['song-source', 'song-search'] }, consentedAt: '2026-11-26T10:00:00.000Z' });
    await expect(fetchSongSearch({ httpClient: new RecordedHttpClient([]), addon: ignored, song: PULSE_GARDEN })).rejects.toThrow('Song Finder can’t search for songs.');
  });
});
