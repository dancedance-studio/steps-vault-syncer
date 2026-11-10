import type { MouseEvent, ReactElement, ReactNode } from 'react';
import { joinClassNames } from './class-names';
import { FourArrowLoader } from './four-arrow-loader';

interface GreenPillCommonProps {
  /** Shown before the words, for example <Icon name="folder" />. */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export interface GreenPillLinkProps extends GreenPillCommonProps {
  href: string;
  target?: string;
  rel?: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

export interface GreenPillActionProps extends GreenPillCommonProps {
  href?: undefined;
  onClick: () => void;
  isDisabled?: boolean;
  /**
   * True while the work it started is running: the dark four-arrow loader takes the icon's place, the button can't be
   * pressed but keeps its full colour, and screen readers hear that it is busy.
   */
  isBusy?: boolean;
  type?: 'button' | 'submit';
}

export type GreenPillButtonProps = GreenPillLinkProps | GreenPillActionProps;

/** The main green action, fully rounded with the site's green gradient: Sync now, Choose my Songs folder, the intro. */
export function GreenPillButton(props: GreenPillButtonProps): ReactElement {
  const className = joinClassNames('sv-sync-green-pill', props.className);
  if (props.href !== undefined) {
    return <a className={className} href={props.href} target={props.target} rel={props.rel} onClick={props.onClick}>{props.icon}{props.children}</a>;
  }
  return (
    <button className={className} type={props.type === 'submit' ? 'submit' : 'button'} onClick={props.onClick} disabled={props.isDisabled === true || props.isBusy === true} aria-busy={props.isBusy === true ? true : undefined}>
      {props.isBusy === true ? <FourArrowLoader tone="on-green" /> : props.icon}
      {props.children}
    </button>
  );
}
