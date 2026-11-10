import type { ReactElement } from 'react';
import { ArrowReceptor, type ArrowDirection } from '../icons/arrow-receptor';
import { joinClassNames } from './class-names';

const LOADER_ARROW_DIRECTIONS: readonly ArrowDirection[] = ['left', 'down', 'up', 'right'];

export interface FourArrowLoaderProps {
  /** Shown and said next to the arrows, for example "Waiting for the code…". Leave it out next to text that says it. */
  label?: string;
  /** Each arrow's size in pixels. */
  size?: number;
  className?: string;
}

/**
 * The small waiting sign: ← ↓ ↑ → with a cyan glow passing from arrow to arrow. With less motion the arrows stay still
 * at 70% (sync-ui.css), so the sign still reads as "waiting".
 */
export function FourArrowLoader({ label, size = 16, className }: FourArrowLoaderProps): ReactElement {
  const arrows = (
    <span className="sv-sync-four-arrows" aria-hidden="true">
      {LOADER_ARROW_DIRECTIONS.map((direction) => <ArrowReceptor key={direction} direction={direction} size={size} className="sv-sync-four-arrows-arrow" />)}
    </span>
  );
  if (label === undefined) return <span className={joinClassNames('sv-sync-four-arrow-loader', className)}>{arrows}</span>;
  return (
    <span className={joinClassNames('sv-sync-four-arrow-loader', className)} role="status">
      {arrows}
      <span>{label}</span>
    </span>
  );
}
