import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AddonView } from '../sync-ui-types';
import { AddonCard } from './addon-card';

const SONG_FINDER: AddonView = { addonId: 'song-finder', name: 'Song Finder', version: '0.6.0', author: '@kai', providesText: 'Audio and video links · Song search', isEnabled: true, health: { kind: 'working', note: 'http://127.0.0.1:7810' }, options: [] };

function renderCard(addon: AddonView): HTMLElement {
  render(<AddonCard addon={addon} onToggle={vi.fn()} onRemove={vi.fn()} onSetOption={vi.fn()} />);
  return screen.getByRole('article', { name: addon.name });
}

describe('addon card', () => {
  it('shows Song search among what the addon gives', () => {
    expect(renderCard(SONG_FINDER).textContent).toContain('Audio and video links · Song search');
  });

  it('says why Sync ignores an ability, and nothing when it uses them all', () => {
    const note = 'Sync ignores its song search, because it doesn’t give audio links too. Ask the addon’s maker.';
    expect(renderCard({ ...SONG_FINDER, addonId: 'clip-finder', name: 'Clip Finder', providesText: 'New songs to make', isAudioSource: false, ignoredAbilityNote: note }).textContent).toContain(note);
    expect(renderCard(SONG_FINDER).textContent).not.toContain('Sync ignores');
  });
});
