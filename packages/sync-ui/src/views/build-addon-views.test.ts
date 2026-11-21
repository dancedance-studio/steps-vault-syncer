import { buildInstalledAddon, type AddonManifest, type InstalledAddon } from '@stepsvault/sync-core';
import { describe, expect, it } from 'vitest';
import { buildAddonInstallPreview, buildAddonView, buildSongSourceTabs, getAddonOptionValuesFromViews } from './build-addon-views';

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

describe('song source tabs', () => {
  const LINK_INPUT = { id: 'link', kind: 'link', label: 'Clip link', placeholder: null, sites: ['clips.example', 'media.example.org'] } as const;
  const SEARCH_INPUT = { id: 'search', kind: 'search', label: 'Title', placeholder: null } as const;
  const SONG_SCOUT: AddonManifest = { ...MANIFEST, id: 'song.scout', name: 'Song Scout', provides: ['song-source'], options: [], inputs: [SEARCH_INPUT] };
  const OPEN_AUDIO_LINKS: AddonManifest = { ...MANIFEST, id: 'open.audio-links', name: 'Open Audio Links', provides: ['audio-links', 'video-links', 'song-source'], options: [], inputs: [LINK_INPUT] };
  const buildAddon = ({ manifest, isEnabled = true }: { manifest: AddonManifest; isEnabled?: boolean }): InstalledAddon => ({ ...buildInstalledAddon({ baseUrl: 'http://127.0.0.1:7801', manifest, consentedAt: '' }), isEnabled });

  it('has a link addon’s tab, named after it, only while the addon is on', () => {
    expect(buildSongSourceTabs([buildAddon({ manifest: OPEN_AUDIO_LINKS })])).toEqual([{ addonId: 'open.audio-links', name: 'Open Audio Links', inputs: [LINK_INPUT] }]);
    expect(buildSongSourceTabs([buildAddon({ manifest: OPEN_AUDIO_LINKS, isEnabled: false })])).toEqual([]);
    expect(buildSongSourceTabs([buildAddon({ manifest: MANIFEST })])).toEqual([]);
    expect(buildSongSourceTabs([])).toEqual([]);
  });

  it('puts link addons before search addons, whatever order they were added in', () => {
    const tabs = buildSongSourceTabs([buildAddon({ manifest: SONG_SCOUT }), buildAddon({ manifest: OPEN_AUDIO_LINKS })]);
    expect(tabs.map((tab) => tab.name)).toEqual(['Open Audio Links', 'Song Scout']);
  });
});
