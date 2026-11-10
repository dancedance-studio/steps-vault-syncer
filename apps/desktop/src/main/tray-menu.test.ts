import { describe, expect, it, vi } from 'vitest';
import { buildTrayMenuTemplate, getTimeAgoText, getTrayStatusLine, type TrayActions } from './tray-menu';

const NOW = new Date('2026-10-23T18:44:00Z');

function createActions(): TrayActions {
  return { onOpen: vi.fn(), onSyncNow: vi.fn(), onTogglePause: vi.fn(), onQuit: vi.fn() };
}

describe('the tray menu', () => {
  it('shows the name with its status under it, a line, then Open, Sync now, Pause and Quit', () => {
    const template = buildTrayMenuTemplate({ view: { status: 'synced', lastSyncAt: '2026-10-23T18:42:00Z' }, now: NOW, actions: createActions(), statusIcon: 'status-icon.png' });
    expect(template.map((item) => item.type === 'separator' ? '—' : item.label)).toEqual(['dancedance.studio Sync', '✓ Synced · 2 min ago', '—', 'Open', 'Sync now', 'Pause', 'Quit']);
    expect(template.slice(0, 2).map((item) => item.enabled)).toEqual([false, false]);
    expect(template[0]?.icon).toBe('status-icon.png');
  });

  it('calls the right action for each item, and offers Resume while paused', () => {
    const actions = createActions();
    const template = buildTrayMenuTemplate({ view: { status: 'paused', lastSyncAt: null }, now: NOW, actions });
    const itemsByLabel = new Map(template.map((item) => [item.label, item]));
    expect(itemsByLabel.get('Pause')).toBeUndefined();
    expect(itemsByLabel.get('Resume')?.click).toBe(actions.onTogglePause);
    expect(itemsByLabel.get('Open')?.click).toBe(actions.onOpen);
    expect(itemsByLabel.get('Sync now')?.click).toBe(actions.onSyncNow);
    expect(itemsByLabel.get('Quit')?.click).toBe(actions.onQuit);
  });

  it('says each status in words, with the real time of the last sync', () => {
    expect(getTrayStatusLine({ view: { status: 'syncing', lastSyncAt: '2026-10-23T18:42:00Z' }, now: NOW })).toBe('Syncing…');
    expect(getTrayStatusLine({ view: { status: 'needs-attention', lastSyncAt: null }, now: NOW })).toBe('! Needs attention');
    expect(getTrayStatusLine({ view: { status: 'paused', lastSyncAt: null }, now: NOW })).toBe('Paused');
    expect(getTrayStatusLine({ view: { status: 'synced', lastSyncAt: null }, now: NOW })).toBe('✓ Synced');
    expect(getTrayStatusLine({ view: { status: 'synced', lastSyncAt: '2026-10-23T15:30:00Z' }, now: NOW })).toBe('✓ Synced · 3 h ago');
  });

  it('keeps “ago” short', () => {
    expect(getTimeAgoText({ pastTime: new Date('2026-10-23T18:43:30Z'), now: NOW })).toBe('just now');
    expect(getTimeAgoText({ pastTime: new Date('2026-10-23T18:42:00Z'), now: NOW })).toBe('2 min ago');
    expect(getTimeAgoText({ pastTime: new Date('2026-10-22T18:00:00Z'), now: NOW })).toBe('1 day ago');
    expect(getTimeAgoText({ pastTime: new Date('2026-10-20T18:00:00Z'), now: NOW })).toBe('3 days ago');
  });
});
