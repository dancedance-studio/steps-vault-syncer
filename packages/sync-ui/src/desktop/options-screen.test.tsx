import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AppVersionsView, UpdateCheckView } from '../sync-ui-types';
import { OptionsScreen, type OptionsScreenProps } from './options-screen';

function buildInstalledVersions(updateCheck: UpdateCheckView): AppVersionsView {
  return { kind: 'installed', currentVersion: '0.1.0', updateCheck, isAutomaticCheckOn: true, shouldGetTestVersionsFirst: false };
}

function renderOptions(overrides: Partial<OptionsScreenProps>): OptionsScreenProps {
  const props: OptionsScreenProps = {
    versions: buildInstalledVersions({ kind: 'not-checked' }), isStartWithWindowsOn: true,
    onCheckForUpdates: vi.fn(), onRestartToUpdate: vi.fn(), onToggleAutomaticUpdateCheck: vi.fn(), onToggleTestVersionsFirst: vi.fn(), onToggleStartWithWindows: vi.fn(),
    ...overrides,
  };
  render(<OptionsScreen {...props} />);
  return props;
}

describe('OptionsScreen', () => {
  it('shows the version with a Check for updates button, and the three switches of an installed copy', () => {
    const props = renderOptions({ versions: buildInstalledVersions({ kind: 'up-to-date' }) });
    expect(screen.getByText('Version 0.1.0 · Up to date ✓')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(props.onCheckForUpdates).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('switch')).toHaveLength(3);
    expect(screen.getByRole('switch', { name: 'Check for new versions automatically' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Get test versions first' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('switch', { name: 'Start Sync when Windows starts' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Test versions come a day or so before everyone else. They can have problems.')).toBeDefined();
  });

  it('turns each switch on or off', () => {
    const props = renderOptions({});
    fireEvent.click(screen.getByRole('switch', { name: 'Check for new versions automatically' }));
    expect(props.onToggleAutomaticUpdateCheck).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole('switch', { name: 'Get test versions first' }));
    expect(props.onToggleTestVersionsFirst).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Start Sync when Windows starts' }));
    expect(props.onToggleStartWithWindows).toHaveBeenCalledWith(false);
  });

  it('shows the four-arrow loader while checking, and no button to press twice', () => {
    renderOptions({ versions: buildInstalledVersions({ kind: 'checking' }) });
    const checking = screen.getByRole('status');
    expect(checking.textContent).toBe('Checking…');
    expect(checking.querySelectorAll('.sv-sync-four-arrows-arrow')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull();
  });

  it('says which version is ready and restarts to it', () => {
    const props = renderOptions({ versions: buildInstalledVersions({ kind: 'ready', version: '0.2.0' }) });
    expect(screen.getByText('Version 0.2.0 is ready')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
    expect(props.onRestartToUpdate).toHaveBeenCalledOnce();
  });

  it('shows MISS with Try again when a check failed', () => {
    const props = renderOptions({ versions: buildInstalledVersions({ kind: 'failed' }) });
    expect(screen.getByRole('alert').textContent).toBe('MISSSync couldn’t check for updates.Try again');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onCheckForUpdates).toHaveBeenCalledOnce();
  });

  it('run from source, says updates come from git and keeps only the start with Windows switch', () => {
    renderOptions({ versions: { kind: 'from-source', currentVersion: '0.1.0' } });
    expect(screen.getByText('Running from source · updates come from git')).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getAllByRole('switch')).toHaveLength(1);
    expect(screen.getByRole('switch', { name: 'Start Sync when Windows starts' })).toBeDefined();
  });
});
