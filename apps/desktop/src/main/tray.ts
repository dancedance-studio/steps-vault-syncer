import { Menu, nativeImage, Tray, type NativeImage } from 'electron';
import type { TrayStatus } from '@stepsvault/sync-ui';
import { APP_DISPLAY_NAME } from '../shared/app-name';
import { buildTrayMenuTemplate, getTrayStatusLine, type TrayActions, type TrayView } from './tray-menu';

const ICON_SIZE = 16;
/** "2 min ago" moves on by itself, so the menu is checked once a minute. */
const MENU_REFRESH_MILLISECONDS = 60_000;
/** Lime when synced, blue while syncing, gold when songs need the player, grey when paused (as the status chips). */
const COLORS_BY_STATUS: Readonly<Record<TrayStatus, readonly [number, number, number]>> = {
  synced: [164, 255, 0],
  syncing: [52, 191, 255],
  'needs-attention': [255, 198, 0],
  paused: [200, 200, 200],
};
const TOOLTIPS_BY_STATUS: Readonly<Record<TrayStatus, string>> = {
  synced: `${APP_DISPLAY_NAME} · everything is in your game`,
  syncing: `${APP_DISPLAY_NAME} · syncing…`,
  'needs-attention': `${APP_DISPLAY_NAME} · some songs need you`,
  paused: `${APP_DISPLAY_NAME} · paused`,
};

/** A small, still up-arrow in the status colour, drawn in code so the app ships no icon files that could go missing. */
function buildArrowIcon(status: TrayStatus): NativeImage {
  const [red, green, blue] = COLORS_BY_STATUS[status];
  const pixels = Buffer.alloc(ICON_SIZE * ICON_SIZE * 4);
  for (let y = 0; y < ICON_SIZE; y += 1) {
    for (let x = 0; x < ICON_SIZE; x += 1) {
      const isHead = y < 8 && Math.abs(x - 7.5) <= y;
      const isShaft = y >= 8 && x >= 5 && x <= 10;
      if (!isHead && !isShaft) continue;
      const offset = (y * ICON_SIZE + x) * 4;
      pixels.set([blue, green, red, 255], offset);
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: ICON_SIZE, height: ICON_SIZE });
}

export class SyncTray {
  private readonly tray: Tray;
  private readonly actions: TrayActions;
  private view: TrayView = { status: 'synced', lastSyncAt: null };
  private shownStatus: TrayStatus | null = null;
  private shownStatusLine: string | null = null;

  constructor(actions: TrayActions) {
    this.actions = actions;
    this.tray = new Tray(buildArrowIcon('synced'));
    this.tray.on('click', actions.onOpen);
    this.show(this.view);
    setInterval(() => { this.show(this.view); }, MENU_REFRESH_MILLISECONDS).unref();
  }

  show(view: TrayView): void {
    this.view = view;
    const now = new Date();
    const statusLine = getTrayStatusLine({ view, now });
    if (view.status === this.shownStatus && statusLine === this.shownStatusLine) return;
    if (view.status !== this.shownStatus) {
      this.tray.setImage(buildArrowIcon(view.status));
      this.tray.setToolTip(TOOLTIPS_BY_STATUS[view.status]);
    }
    this.shownStatus = view.status;
    this.shownStatusLine = statusLine;
    this.tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate({ view, now, actions: this.actions, statusIcon: buildArrowIcon(view.status) })));
  }
}
