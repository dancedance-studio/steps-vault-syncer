import type { ReactElement } from 'react';
import { ArrowReceptor, type ArrowDirection } from '../icons/arrow-receptor';
import { joinClassNames } from './class-names';

const LOADER_ARROW_DIRECTIONS: readonly ArrowDirection[] = ['left', 'down', 'up', 'right'];

/**
 * glow: light arrows with a cyan glow, for dark backgrounds ("Waiting for the code…", status chips).
 * on-green: dark arrows straight on a green button (Sync now while syncing, "Sending…"), without the glow.
 */
export type FourArrowLoaderTone = 'glow' | 'on-green';

const DEFAULT_ARROW_SIZES_BY_TONE: Readonly<Record<FourArrowLoaderTone, number>> = { 'glow': 16, 'on-green': 15 };

export interface FourArrowLoaderProps {
  /** Shown and said next to the arrows, for example "Waiting for the code…". Leave it out next to text that says it. */
  label?: string;
  /** Each arrow's size in pixels; 16 for glow, 15 on a green button. */
  size?: number;
  tone?: FourArrowLoaderTone;
  className?: string;
}

/**
 * The small waiting sign: ← ↓ ↑ → with a pulse passing from arrow to arrow. With less motion the arrows stay still
 * and half visible (sync-ui.css), so the sign still reads as "waiting".
 */
export function FourArrowLoader({ label, size, tone = 'glow', className }: FourArrowLoaderProps): ReactElement {
  const arrowSize = size ?? DEFAULT_ARROW_SIZES_BY_TONE[tone];
  const loaderClassName = joinClassNames('sv-sync-four-arrow-loader', tone === 'on-green' && 'sv-sync-four-arrow-loader--on-green', className);
  const arrows = (
    <span className="sv-sync-four-arrows" aria-hidden="true">
      {LOADER_ARROW_DIRECTIONS.map((direction) => <ArrowReceptor key={direction} direction={direction} size={arrowSize} className="sv-sync-four-arrows-arrow" />)}
    </span>
  );
  if (label === undefined) return <span className={loaderClassName}>{arrows}</span>;
  return (
    <span className={loaderClassName} role="status">
      {arrows}
      <span>{label}</span>
    </span>
  );
}
