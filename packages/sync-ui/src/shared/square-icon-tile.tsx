import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { joinClassNames } from './class-names';

/** One colour per thing Sync does, as on the intro page's tiles. `neutral` is the logo's plain tile. */
export type FeatureTone = 'sync' | 'addons' | 'generators' | 'groups' | 'neutral';

export const FEATURE_TONE_COLORS: Readonly<Record<Exclude<FeatureTone, 'neutral'>, string>> = {
  sync: '#1cd8ff',
  addons: '#ffd36b',
  generators: '#a4ff00',
  groups: '#ff8cf9',
};

export interface SquareIconTileProps {
  tone: FeatureTone;
  /** Width and height in pixels. */
  size?: number;
  /** An icon, the logo, or an addon's initials. */
  children: ReactNode;
  className?: string;
}

/** A rounded square with a soft tint of the feature's colour behind its icon. It is decoration: text says the same. */
export function SquareIconTile({ tone, size = 42, children, className }: SquareIconTileProps): ReactElement {
  const style = { '--sv-sync-tile-size': `${String(size)}px` } as CSSProperties;
  return <span className={joinClassNames('sv-sync-square-tile', `sv-sync-square-tile--${tone}`, className)} style={style} aria-hidden="true">{children}</span>;
}
