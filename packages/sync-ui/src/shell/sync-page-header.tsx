import type { MouseEvent, ReactElement } from 'react';
import { APP_NAME, SYNC_ABOUT_PATH, SYNC_ABOUT_URL } from '../shared/brand-names';
import type { SyncPlatform } from '../sync-ui-types';

/** Where "What Sync can do →" goes: the intro page, on the website or (from the app) in the player's browser. */
export interface AboutSyncLinkView {
  href: string;
  /** Website: the router's own navigation. Without it the link simply follows its address. */
  onOpen?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/** The app opens https links in the player's browser, so the desktop link points at the site itself. */
export function getDefaultAboutSyncLink(platform: SyncPlatform): AboutSyncLinkView {
  return { href: platform === 'website' ? SYNC_ABOUT_PATH : SYNC_ABOUT_URL };
}

export function AboutSyncLink({ link, platform }: { link: AboutSyncLinkView; platform: SyncPlatform }): ReactElement {
  const isOpenedInBrowser = platform === 'desktop';
  return (
    <a className="sv-sync-about-link" href={link.href} onClick={link.onOpen} target={isOpenedInBrowser ? '_blank' : undefined} rel={isOpenedInBrowser ? 'noreferrer' : undefined}>
      What Sync can do →
    </a>
  );
}

export interface SyncPageHeaderProps {
  platform: SyncPlatform;
  aboutSyncLink?: AboutSyncLinkView;
}

/**
 * The top of every Sync page. The website shows the eyebrow, title and one line; the app window already has its title
 * bar and each screen its own heading, so it keeps only the eyebrow and the link.
 */
export function SyncPageHeader({ platform, aboutSyncLink = getDefaultAboutSyncLink(platform) }: SyncPageHeaderProps): ReactElement {
  if (platform === 'desktop') {
    return (
      <div className="sv-sync-page-header sv-sync-page-header--desktop">
        <span className="sv-sync-eyebrow">{APP_NAME}</span>
        <AboutSyncLink link={aboutSyncLink} platform={platform} />
      </div>
    );
  }
  return (
    <div className="sv-sync-page-header sv-sync-website-header">
      <div>
        <span className="sv-sync-eyebrow">{APP_NAME}</span>
        <h1 className="sv-sync-display-title">Sync to my game</h1>
        <p className="sv-sync-lede">Your library&apos;s songs in your own StepMania, lined up with your own music.</p>
      </div>
      <AboutSyncLink link={aboutSyncLink} platform={platform} />
    </div>
  );
}
