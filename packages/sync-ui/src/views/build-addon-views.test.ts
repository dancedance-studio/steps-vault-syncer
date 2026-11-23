import { buildInstalledAddon, type AddonManifest, type InstalledAddon } from '@dancedance/sync-core';
import { describe, expect, it } from 'vitest';
import { buildAddonInstallPreview, buildAddonView, buildLinksTab, buildSongSourceTabs, findLinkFieldForLink, getAddonOptionValuesFromViews } from './build-addon-views';

const MEDIA_CHOICES = [{ value: 'audio', label: 'Music only' }, { value: 'audio-and-video', label: 'Music and video' }];
const MANIFEST: AddonManifest = {
  protocol: 1, kind: 'addon', id: 'indie.tapes', name: 'Indie Tapes', version: '0.6.1', author: 'hyperpad', description: '', provides: ['audio-links', 'video-links'], inputs: [],
  options: [{ id: 'media', label: 'What to get', kind: 'choice', choices: MEDIA_CHOICES, default: 'audio-and-video' }],
};

describe('addon views', () => {
  it('shows each option with the player’s pick', () => {
    const addon = buildInstalledAddon({ baseUrl: 'https://tapes.example.org', manifest: MANIFEST, consentedAt: '', optionValues: { media: 'audio' } });
    expect(buildAddonView(addon)).toMatchObject({ addonId: 'indie.tapes', providesText: 'Audio and video links', options: [{ optionId: 'media', label: 'What to get', choices: MEDIA_CHOICES, value: 'audio' }] });
  });

  it('starts the consent step at the defaults, and turns the picks back into values', () => {
    const preview = buildAddonInstallPreview({ address: 'https://tapes.example.org', manifest: MANIFEST });
    expect(preview.options).toEqual([{ optionId: 'media', label: 'What to get', choices: MEDIA_CHOICES, value: 'audio-and-video' }]);
    expect(getAddonOptionValuesFromViews(preview.options.map((option) => ({ ...option, value: 'audio' })))).toEqual({ media: 'audio' });
  });

  it('shows no options for an addon without them', () => {
    const addon = buildInstalledAddon({ baseUrl: 'https://tapes.example.org', manifest: { ...MANIFEST, provides: ['audio-links'], options: [] }, consentedAt: '' });
    expect(buildAddonView(addon)).toMatchObject({ providesText: 'Audio links', options: [] });
  });
});

describe('Make a song tabs', () => {
  const LINK_INPUT = { id: 'link', kind: 'link', label: 'Clip link', placeholder: null, sites: ['clips.example', 'media.example.org'] } as const;
  const REEL_INPUT = { id: 'reel', kind: 'link', label: 'Reel link', placeholder: null, sites: ['media.example.org', 'reels.example'] } as const;
  const SEARCH_INPUT = { id: 'search', kind: 'search', label: 'Title', placeholder: null } as const;
  const SONG_SCOUT: AddonManifest = { ...MANIFEST, id: 'song.scout', name: 'Song Scout', provides: ['song-source'], options: [], inputs: [SEARCH_INPUT] };
  const OPEN_AUDIO_LINKS: AddonManifest = { ...MANIFEST, id: 'open.audio-links', name: 'Open Audio Links', provides: ['audio-links', 'video-links', 'song-source'], options: [], inputs: [LINK_INPUT] };
  const REEL_LINKS: AddonManifest = { ...OPEN_AUDIO_LINKS, id: 'reel.links', name: 'Reel Links', inputs: [REEL_INPUT] };
  const CLIP_SONGS: AddonManifest = { ...OPEN_AUDIO_LINKS, id: 'clip.songs', name: 'Clip Songs', inputs: [LINK_INPUT, SEARCH_INPUT] };
  const buildAddon = ({ manifest, isEnabled = true }: { manifest: AddonManifest; isEnabled?: boolean }): InstalledAddon => ({ ...buildInstalledAddon({ baseUrl: 'http://127.0.0.1:7801', manifest, consentedAt: '' }), isEnabled });

  it('has one Links tab for every link addon that is on, with all their sites together, each once', () => {
    expect(buildLinksTab([buildAddon({ manifest: OPEN_AUDIO_LINKS }), buildAddon({ manifest: SONG_SCOUT }), buildAddon({ manifest: REEL_LINKS })])).toEqual({
      linkFields: [{ addonId: 'open.audio-links', inputId: 'link', sites: ['clips.example', 'media.example.org'] }, { addonId: 'reel.links', inputId: 'reel', sites: ['media.example.org', 'reels.example'] }],
      sites: ['clips.example', 'media.example.org', 'reels.example'],
    });
  });

  it('has no Links tab once the last link addon is turned off or removed, or for an addon that brings no new songs', () => {
    expect(buildLinksTab([buildAddon({ manifest: OPEN_AUDIO_LINKS, isEnabled: false }), buildAddon({ manifest: REEL_LINKS })])?.linkFields.map((linkField) => linkField.addonId)).toEqual(['reel.links']);
    expect(buildLinksTab([buildAddon({ manifest: OPEN_AUDIO_LINKS, isEnabled: false }), buildAddon({ manifest: REEL_LINKS, isEnabled: false })])).toBeNull();
    expect(buildLinksTab([buildAddon({ manifest: SONG_SCOUT })])).toBeNull();
    expect(buildLinksTab([buildAddon({ manifest: MANIFEST })])).toBeNull();
    expect(buildLinksTab([])).toBeNull();
  });

  it('gives each search addon that is on its own tab, named after it, with its search fields only, in the player’s order', () => {
    expect(buildSongSourceTabs([buildAddon({ manifest: SONG_SCOUT }), buildAddon({ manifest: OPEN_AUDIO_LINKS })])).toEqual([{ addonId: 'song.scout', name: 'Song Scout', inputs: [SEARCH_INPUT] }]);
    expect(buildSongSourceTabs([buildAddon({ manifest: SONG_SCOUT, isEnabled: false })])).toEqual([]);
  });

  it('shows an addon with a link field and a search field in both places: the link in Links, the search in its own tab', () => {
    const addons = [buildAddon({ manifest: CLIP_SONGS }), buildAddon({ manifest: SONG_SCOUT })];
    expect(buildSongSourceTabs(addons)).toEqual([{ addonId: 'clip.songs', name: 'Clip Songs', inputs: [SEARCH_INPUT] }, { addonId: 'song.scout', name: 'Song Scout', inputs: [SEARCH_INPUT] }]);
    expect(buildLinksTab(addons)).toEqual({ linkFields: [{ addonId: 'clip.songs', inputId: 'link', sites: ['clips.example', 'media.example.org'] }], sites: ['clips.example', 'media.example.org'] });
  });

  it('hands a link to the first link addon, in the player’s order, whose sites take its host or a subdomain of it', () => {
    const linksTab = buildLinksTab([buildAddon({ manifest: OPEN_AUDIO_LINKS }), buildAddon({ manifest: REEL_LINKS })]);
    if (!linksTab) throw new Error('Expected a Links tab.');
    const findAddonId = (link: string): string | undefined => findLinkFieldForLink({ linksTab, link })?.addonId;
    expect(findAddonId('https://reels.example/v/night-drive')).toBe('reel.links');
    expect(findAddonId('https://clips.example/v/night-drive')).toBe('open.audio-links');
    expect(findAddonId('https://www.clips.example/v/night-drive')).toBe('open.audio-links');
    expect(findAddonId('https://media.example.org/v/night-drive')).toBe('open.audio-links');
    expect(findAddonId('https://evil-clips.example/v/night-drive')).toBeUndefined();
    expect(findAddonId('night drive')).toBeUndefined();
    const reelsFirst = buildLinksTab([buildAddon({ manifest: REEL_LINKS }), buildAddon({ manifest: OPEN_AUDIO_LINKS })]);
    expect(reelsFirst && findLinkFieldForLink({ linksTab: reelsFirst, link: 'https://media.example.org/v/night-drive' })).toEqual({ addonId: 'reel.links', inputId: 'reel', sites: ['media.example.org', 'reels.example'] });
  });
});
