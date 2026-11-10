import { useId, type ReactElement } from 'react';

const ARROW_PATH = 'M32 6L57 31H43V57H21V31H7Z';

interface LogoArrow {
  name: 'up' | 'down' | 'left' | 'right';
  centerX: number;
  centerY: number;
  rotationDegrees: number;
  /** Top, middle and bottom of the arrow's gradient. */
  colors: readonly [string, string, string];
}

const LOGO_ARROWS: readonly LogoArrow[] = [
  { name: 'up', centerX: 31, centerY: 20.5, rotationDegrees: 0, colors: ['#a4f576', '#59ec05', '#3ea504'] },
  { name: 'down', centerX: 31, centerY: 45.5, rotationDegrees: 180, colors: ['#76b0f5', '#0570ec', '#044ea5'] },
  { name: 'left', centerX: 18.5, centerY: 33, rotationDegrees: 270, colors: ['#f58a76', '#ec2b05', '#a51e04'] },
  { name: 'right', centerX: 43.5, centerY: 33, rotationDegrees: 90, colors: ['#f5e276', '#eccb05', '#a58e04'] },
];

export interface SiteLogoProps {
  size?: number;
  className?: string;
}

/**
 * The dancedance.studio mark: four step arrows and two sparkles. Drawn inline so the components never load images;
 * the gradient ids are unique per copy, since a page can show the logo more than once.
 */
export function SiteLogo({ size = 36, className }: SiteLogoProps): ReactElement {
  const idPrefix = useId().replace(/:/g, '');
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 64 64" className={className}>
      <defs>
        {LOGO_ARROWS.map((arrow) => (
          <linearGradient key={arrow.name} id={`${idPrefix}-${arrow.name}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={arrow.colors[0]} />
            <stop offset=".55" stopColor={arrow.colors[1]} />
            <stop offset="1" stopColor={arrow.colors[2]} />
          </linearGradient>
        ))}
      </defs>
      <circle cx="31" cy="33" r="28" fill="#10131c" stroke="#3a4666" strokeWidth="2.4" />
      {LOGO_ARROWS.map((arrow) => (
        <g key={arrow.name} transform={`translate(${String(arrow.centerX)} ${String(arrow.centerY)}) rotate(${String(arrow.rotationDegrees)}) scale(0.2578125) translate(-32 -32)`}>
          <path d={ARROW_PATH} fill={`url(#${idPrefix}-${arrow.name})`} stroke="#0b0b12" strokeWidth="5" strokeLinejoin="round" />
        </g>
      ))}
      <rect x="27.37" y="29.37" width="7.26" height="7.26" rx="1.65" fill="#232a40" />
      <path d="M52.5 3.0 Q54.88 9.12 61.0 11.5 Q54.88 13.88 52.5 20.0 Q50.12 13.88 44.0 11.5 Q50.12 9.12 52.5 3.0 Z" fill="#fff568" />
      <path d="M60 20.1 Q60.952 22.548 63.4 23.5 Q60.952 24.452 60 26.9 Q59.048 24.452 56.6 23.5 Q59.048 22.548 60 20.1 Z" fill="#ff32f8" />
    </svg>
  );
}
