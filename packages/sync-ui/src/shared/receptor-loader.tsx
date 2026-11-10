import type { ReactElement } from 'react';
import { ArrowReceptor, type ArrowDirection } from '../icons/arrow-receptor';
import { FourArrowLoader } from './four-arrow-loader';

const LOADER_DIRECTIONS: readonly ArrowDirection[] = ['left', 'down', 'up', 'right'];

export interface ReceptorLoaderProps {
  /** Said and shown next to the arrows, for example "Loading your songs…". */
  label: string;
  /** Small: one line next to a button, as in "Asking Song Scout…"; it is the FourArrowLoader then. */
  isSmall?: boolean;
}

/** The game's four step-zone arrows lighting up in turn at 120 BPM; still when the system asks for less motion. */
export function ReceptorLoader({ label, isSmall = false }: ReceptorLoaderProps): ReactElement {
  if (isSmall) return <FourArrowLoader className="sv-sync-loader--small" label={label} />;
  const arrowSize = 40;
  return (
    <div className="sv-sync-loader" role="status">
      <span className="sv-sync-loader-arrows" aria-hidden="true">
        {LOADER_DIRECTIONS.map((direction) => (
          <span key={direction} className="sv-sync-loader-arrow">
            <ArrowReceptor direction={direction} size={arrowSize} />
            <ArrowReceptor direction={direction} size={arrowSize} className="sv-sync-loader-flash" />
          </span>
        ))}
      </span>
      <span>{label}</span>
    </div>
  );
}
