import type { MenuItemConstructorOptions } from 'electron';
import type { TrayStatus } from '@stepsvault/sync-ui';
import { APP_DISPLAY_NAME } from '../shared/app-name';

export interface TrayActions {
  onOpen: () => void;
  onSyncNow: () => void;
  onTogglePause: () => void;
  onQuit: () => void;
}

/** What the tray shows: the status, and when the last sync finished (an ISO time, null before the first one). */
export interface TrayView {
  status: TrayStatus;
  lastSyncAt: string | null;
}

const MILLISECONDS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/** "just now", "2 min ago", "3 h ago", "1 day ago": short enough for one menu line. */
export function getTimeAgoText({ pastTime, now }: { pastTime: Date; now: Date }): string {
  const minutes = Math.floor((now.getTime() - pastTime.getTime()) / MILLISECONDS_PER_MINUTE);
  if (minutes < 1) return 'just now';
  if (minutes < MINUTES_PER_HOUR) return `${String(minutes)} min ago`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return `${String(hours)} h ago`;
  const days = Math.floor(hours / HOURS_PER_DAY);
  return days === 1 ? '1 day ago' : `${String(days)} days ago`;
}

/** The line under the app's name, for example "✓ Synced · 2 min ago". */
export function getTrayStatusLine({ view, now }: { view: TrayView; now: Date }): string {
  if (view.status === 'syncing') return 'Syncing…';
  if (view.status === 'needs-attention') return '! Needs attention';
  if (view.status === 'paused') return 'Paused';
  if (view.lastSyncAt === null) return '✓ Synced';
  return `✓ Synced · ${getTimeAgoText({ pastTime: new Date(view.lastSyncAt), now })}`;
}

/**
 * The tray menu: the app's name with its status under it, a line, then Open, Sync now, Pause and Quit. Native menus
 * can't show bold or coloured text, so the name carries the status-coloured icon and the two lines stay together as
 * plain, not clickable, items.
 */
export function buildTrayMenuTemplate({ view, now, actions, statusIcon }: { view: TrayView; now: Date; actions: TrayActions; statusIcon?: MenuItemConstructorOptions['icon'] }): MenuItemConstructorOptions[] {
  return [
    { label: APP_DISPLAY_NAME, enabled: false, icon: statusIcon },
    { label: getTrayStatusLine({ view, now }), enabled: false },
    { type: 'separator' },
    { label: 'Open', click: actions.onOpen },
    { label: 'Sync now', click: actions.onSyncNow },
    { label: view.status === 'paused' ? 'Resume' : 'Pause', click: actions.onTogglePause },
    { label: 'Quit', click: actions.onQuit },
  ];
}
