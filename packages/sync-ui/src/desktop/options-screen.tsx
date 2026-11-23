import type { ReactElement, ReactNode } from 'react';
import { FourArrowLoader } from '../shared/four-arrow-loader';
import { MissLine } from '../shared/miss-line';
import { ToggleSwitch } from '../shared/small-parts';
import type { AppVersionsView, UpdateCheckView } from '../sync-ui-types';

export interface OptionsScreenProps {
  versions: AppVersionsView;
  isStartWithWindowsOn: boolean;
  onCheckForUpdates: () => void;
  onRestartToUpdate: () => void;
  onToggleAutomaticUpdateCheck: (isOn: boolean) => void;
  onToggleTestVersionsFirst: (isOn: boolean) => void;
  onToggleStartWithWindows: (isOn: boolean) => void;
}

/**
 * Desktop only: the app's version and how it gets new ones, and whether it starts with Windows. A copy run from source
 * gets its updates from git, so it shows no update button and no update switches.
 */
export function OptionsScreen(props: OptionsScreenProps): ReactElement {
  const { versions } = props;
  return (
    <div className="sv-sync-screen">
      <div className="sv-sync-screen-header">
        <h2 className="sv-sync-heading-1 sv-sync-heading-1--medium">Options</h2>
      </div>
      <ul className="sv-sync-option-list" aria-label="Options">
        <li className="sv-sync-option-row" aria-live="polite">
          <VersionLine versions={versions} onCheckForUpdates={props.onCheckForUpdates} onRestartToUpdate={props.onRestartToUpdate} />
        </li>
        {versions.kind === 'installed' && (
          <>
            <SwitchRow switchId="sv-sync-option-automatic-update-check" title="Check for new versions automatically" isOn={versions.isAutomaticCheckOn} onToggle={props.onToggleAutomaticUpdateCheck} />
            <SwitchRow switchId="sv-sync-option-test-versions" title="Get test versions first" isOn={versions.shouldGetTestVersionsFirst} onToggle={props.onToggleTestVersionsFirst}>
              Test versions come a day or so before everyone else. They can have problems.
            </SwitchRow>
          </>
        )}
        <SwitchRow switchId="sv-sync-option-start-with-windows" title="Start Sync when Windows starts" isOn={props.isStartWithWindowsOn} onToggle={props.onToggleStartWithWindows} />
      </ul>
    </div>
  );
}

function VersionLine({ versions, onCheckForUpdates, onRestartToUpdate }: { versions: AppVersionsView; onCheckForUpdates: () => void; onRestartToUpdate: () => void }): ReactElement {
  if (versions.kind === 'from-source') {
    return <span className="sv-sync-option-text"><b className="sv-sync-option-title">Running from source · updates come from git</b></span>;
  }
  const check = versions.updateCheck;
  if (check.kind === 'failed') {
    return <MissLine action={<button className="sv-sync-button sv-sync-button--ghost sv-sync-button--small" type="button" onClick={onCheckForUpdates}>Try again</button>}>Sync couldn’t check for updates.</MissLine>;
  }
  if (check.kind === 'ready') {
    return (
      <>
        <span className="sv-sync-option-text"><b className="sv-sync-option-title">Version {check.version} is ready</b></span>
        <button className="sv-sync-button sv-sync-button--small" type="button" onClick={onRestartToUpdate}>Restart to update</button>
      </>
    );
  }
  return (
    <>
      <span className="sv-sync-option-text"><b className="sv-sync-option-title">Version {versions.currentVersion}{check.kind === 'up-to-date' && ' · Up to date ✓'}</b></span>
      {renderCheckControl({ check, onCheckForUpdates })}
    </>
  );
}

function renderCheckControl({ check, onCheckForUpdates }: { check: Exclude<UpdateCheckView, { kind: 'failed' } | { kind: 'ready' }>; onCheckForUpdates: () => void }): ReactNode {
  if (check.kind === 'checking') return <FourArrowLoader label="Checking…" />;
  if (check.kind === 'downloading') return <FourArrowLoader label={`Getting version ${check.version}…`} />;
  return <button className="sv-sync-button sv-sync-button--ghost sv-sync-button--small" type="button" onClick={onCheckForUpdates}>Check for updates</button>;
}

interface SwitchRowProps {
  switchId: string;
  title: string;
  isOn: boolean;
  onToggle: (isOn: boolean) => void;
  /** One short line under the title. */
  children?: ReactNode;
}

function SwitchRow({ switchId, title, isOn, onToggle, children }: SwitchRowProps): ReactElement {
  const titleId = `${switchId}-title`;
  return (
    <li className="sv-sync-option-row">
      <span className="sv-sync-option-text">
        <b id={titleId} className="sv-sync-option-title">{title}</b>
        {children !== undefined && <span className="sv-sync-option-note">{children}</span>}
      </span>
      <ToggleSwitch isOn={isOn} onToggle={onToggle} labelledById={titleId} />
    </li>
  );
}
