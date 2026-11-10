import type { ReactElement } from 'react';
import { ArrowReceptor } from '../icons/arrow-receptor';
import { Icon } from '../icons/icon';
import { SITE_NAME } from '../shared/brand-names';

/** Website only, the right half of Connect: the browser asks before letting the page edit the Songs folder. */
export function BrowserPermissionExplainer(): ReactElement {
  return (
    <section className="sv-sync-connect-half sv-sync-connect-half--then" aria-labelledby="sv-sync-permission-heading">
      <span className="sv-sync-connect-step">THEN</span>
      <h3 id="sv-sync-permission-heading" className="sv-sync-connect-title">Click Allow</h3>
      <span className="sv-sync-connect-hint">Your browser asks once, and again after a restart.</span>
      <div className="sv-sync-browser-prompt-frame" role="img" aria-label="Example of the browser asking for permission, with the Allow button highlighted">
        <div className="sv-sync-browser-prompt" aria-hidden="true">
          <div className="sv-sync-browser-prompt-bar"><Icon name="lock" size={11} strokeWidth={2.4} />{SITE_NAME}</div>
          <div className="sv-sync-browser-prompt-title"><span className="sv-sync-browser-prompt-logo"><ArrowReceptor size={16} /></span>Let {SITE_NAME} edit files?</div>
          <div className="sv-sync-browser-prompt-body">{SITE_NAME} will be able to edit files in <b>Songs</b> until you close all tabs for this site.</div>
          <div className="sv-sync-browser-prompt-buttons"><span>Cancel</span><span className="sv-sync-browser-prompt-allow">Allow</span></div>
          <span className="sv-sync-browser-prompt-pointer"><ArrowReceptor direction="up" size={24} />CLICK ALLOW</span>
        </div>
      </div>
    </section>
  );
}
