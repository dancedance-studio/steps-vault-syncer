import type { ReactElement } from 'react';

const ICON_PATHS = {
  check: <path d="M5 12l5 5L20 7" />,
  spin: <><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" /></>,
  note: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  wave: <><path d="M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0" /><path d="M4 4l16 16" /></>,
  up: <path d="M12 19V5M5 12l7-7 7 7" />,
  pencil: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13 7l4 4" /></>,
  archive: <><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10h14V9M10 13h4" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>,
  plug: <><path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0z" /><path d="M12 17v5" /></>,
  none: <><circle cx="12" cy="12" r="8" /><path d="M8 12h8" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  bars: <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />,
  layout: <><path d="M4 4v14a2 2 0 0 0 2 2h4M4 9h6M4 14h6" /><rect x="12" y="6" width="8" height="6" rx="1" /><rect x="12" y="15" width="8" height="6" rx="1" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  person: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  chevron: <path d="M9 6l6 6-6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>,
  download: <path d="M12 4v12M6 11l6 6 6-6M5 20h14" />,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
  warning: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.01" /></>,
  computer: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  pause: <path d="M9 5v14M15 5v14" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  gamepad: <><rect x="2" y="7" width="20" height="11" rx="4" /><path d="M7 11v4M5 13h4M15 12h.01M18 14h.01" /></>,
  disk: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 14h18M7 17h.01" /></>,
  sparkle: <><path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z" /><path d="M19 15l.8 1.7 1.7.8-1.7.8L19 20l-.8-1.7-1.7-.8 1.7-.8z" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  refresh: <><path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" /><path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" /><path d="M3 21v-5h5M21 3v5h-5" /></>,
  lightning: <path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="currentColor" stroke="none" />,
  'folder-download': <><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2.5h7.5A2.5 2.5 0 0 1 21 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" /><path d="M12 10v6M9 13.5l3 3 3-3" /></>,
  generator: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /><circle cx="12" cy="12" r="3" /></>,
  groups: <><rect x="3" y="4" width="7" height="7" rx="1.5" /><rect x="14" y="4" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><path d="M14 17.5h7M17.5 14v7" /></>,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof ICON_PATHS;

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

/** Icons are decoration: the word next to them always says the same thing. */
export function Icon({ name, size = 16, strokeWidth = 2.2, className }: IconProps): ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {ICON_PATHS[name]}
    </svg>
  );
}
