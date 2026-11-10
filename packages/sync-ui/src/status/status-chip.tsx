import type { SongSyncStatus } from '@stepsvault/sync-core';
import type { ReactElement } from 'react';
import { Icon } from '../icons/icon';
import { joinClassNames } from '../shared/class-names';
import { FourArrowLoader } from '../shared/four-arrow-loader';
import { getStatusToneClassName, SONG_STATUS_DISPLAYS } from './song-status';

export interface StatusChipProps {
  status: SongSyncStatus;
  isSmall?: boolean;
}

/** One clear status: always an icon and a word, never colour alone. */
export function StatusChip({ status, isSmall = false }: StatusChipProps): ReactElement {
  const display = SONG_STATUS_DISPLAYS[status];
  return (
    <span className={joinClassNames('sv-sync-chip', getStatusToneClassName(status), isSmall && 'sv-sync-chip--small')}>
      {status === 'syncing' ? <FourArrowLoader size={isSmall ? 8 : 10} /> : <Icon name={display.iconName} size={isSmall ? 12 : 14} strokeWidth={2.4} />}
      {display.label}
    </span>
  );
}
