import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SONG_STATUS_DISPLAYS, SONG_STATUSES, getSongStatusActions } from './song-status';
import { StatusChip } from './status-chip';

describe('StatusChip', () => {
  it.each(SONG_STATUSES)('shows an icon and a word for %s, never colour alone', (status) => {
    const { container } = render(<StatusChip status={status} />);
    const chip = container.querySelector('.sv-sync-chip');
    expect(chip?.textContent).toBe(SONG_STATUS_DISPLAYS[status].label);
    expect(chip?.querySelector('svg')).not.toBeNull();
    expect(chip?.className).toContain(`sv-sync-tone--${status}`);
  });

  it('has exactly the seven statuses of the plan, each with its own word', () => {
    const labels = SONG_STATUSES.map((status) => SONG_STATUS_DISPLAYS[status].label);
    expect(labels).toEqual(['Synced', 'Syncing…', 'Needs audio', 'Different edit', 'Update available', 'You edited this', 'Removed from library']);
  });

  it('shows the four-arrow loader only for Syncing…, and nothing spins', () => {
    const { container } = render(<><StatusChip status="syncing" /><StatusChip status="synced" /></>);
    const chips = container.querySelectorAll('.sv-sync-chip');
    expect(chips[0]?.querySelectorAll('.sv-sync-four-arrows-arrow')).toHaveLength(4);
    expect(chips[1]?.querySelector('.sv-sync-four-arrows')).toBeNull();
    expect(container.querySelector('.sv-sync-spin')).toBeNull();
  });
});

describe('getSongStatusActions', () => {
  it('offers the choices the spec gives each status', () => {
    expect(getSongStatusActions('needs-audio')).toEqual(['choose-audio']);
    expect(getSongStatusActions('different-edit')).toEqual(['use-different-file']);
    expect(getSongStatusActions('you-edited-this')).toEqual(['keep-mine', 'replace-with-stepsvault']);
    expect(getSongStatusActions('removed-from-vault')).toEqual(['remove-from-game', 'keep-in-game']);
    expect(getSongStatusActions('synced')).toEqual([]);
  });
});
