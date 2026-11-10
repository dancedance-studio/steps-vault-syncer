import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FAKE_FOUND_GAMES, FAKE_PLAYER_GROUPS } from '../fake-data/fake-sync-data';
import { ConnectGameScreen } from './connect-game-screen';
import { SongsFolderPreview } from './songs-folder-preview';

describe('ConnectGameScreen', () => {
  it('on the website, is one split panel: choose the folder first, then click Allow', () => {
    const onChooseSongsFolder = vi.fn();
    render(<ConnectGameScreen platform="website" isBrowserSupported onChooseSongsFolder={onChooseSongsFolder} desktopAppHref="#app" onCopySyncAddress={vi.fn()} />);
    const first = screen.getByRole('region', { name: 'Choose your Songs folder' });
    expect(first.textContent).toContain('FIRST');
    expect(first.textContent).toContain('Usually C:\\Games\\StepMania 5\\Songs');
    fireEvent.click(within(first).getByRole('button', { name: 'Choose my Songs folder' }));
    expect(onChooseSongsFolder).toHaveBeenCalledOnce();
    const then = screen.getByRole('region', { name: 'Click Allow' });
    expect(then.textContent).toContain('THEN');
    expect(within(then).getByRole('img', { name: /browser asking for permission/ })).toBeDefined();
    expect(screen.getByText('Your browser asks once, and again after a restart.')).toBeDefined();
  });

  it('never offers the desktop app to someone who chose the browser', () => {
    render(<ConnectGameScreen platform="website" isBrowserSupported onChooseSongsFolder={vi.fn()} desktopAppHref="#app" onCopySyncAddress={vi.fn()} />);
    expect(screen.queryByText(/desktop app/i)).toBeNull();
    expect(screen.queryByText(/New to Sync/i)).toBeNull();
    expect(document.querySelector('a[href="#app"]')).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('in Firefox or Safari, blocks calmly, explains how to open Edge and still offers the app', () => {
    const onCopySyncAddress = vi.fn();
    render(<ConnectGameScreen platform="website" isBrowserSupported={false} onChooseSongsFolder={vi.fn()} desktopAppHref="#app" onCopySyncAddress={onCopySyncAddress} />);
    expect(screen.getByRole('alert').textContent).toContain('Sync needs Chrome or Edge on a computer');
    const edgeButton = screen.getByRole('button', { name: 'Open in Edge' });
    expect(edgeButton.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(edgeButton);
    expect(edgeButton.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(onCopySyncAddress).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Get the desktop app' }).getAttribute('href')).toBe('#app');
  });

  it('in the desktop app, lists the games found as a radio group the arrow keys can move through', () => {
    const onSelectGame = vi.fn();
    const onUseSelectedGame = vi.fn();
    render(<ConnectGameScreen platform="desktop" foundGames={FAKE_FOUND_GAMES} selectedGameId="ltek" searchedPlacesText="checked C:\ and D:\" onSelectGame={onSelectGame} onUseSelectedGame={onUseSelectedGame} onChooseAnotherFolder={vi.fn()} />);
    const radios = within(screen.getByRole('radiogroup', { name: 'Games found' })).getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true');
    expect(radios[1]?.getAttribute('tabindex')).toBe('-1');
    fireEvent.keyDown(radios[0] as HTMLElement, { key: 'ArrowDown' });
    expect(onSelectGame).toHaveBeenCalledWith('stepmania-5');
    expect(document.activeElement).toBe(radios[1]);
    fireEvent.keyDown(radios[0] as HTMLElement, { key: 'ArrowUp' });
    expect(onSelectGame).toHaveBeenLastCalledWith('outfox');
    fireEvent.click(screen.getByRole('button', { name: /Use this folder/ }));
    expect(onUseSelectedGame).toHaveBeenCalledOnce();
  });
});

describe('SongsFolderPreview', () => {
  it('shows every group of the player locked, and where dancedance.studio songs will go', () => {
    render(<SongsFolderPreview songsFolderPath="C:\\Games\\StepMania 5\\Songs" playerGroups={FAKE_PLAYER_GROUPS} layoutText="by genre" onChangeLayout={vi.fn()} onChooseAnotherFolder={vi.fn()} onContinue={vi.fn()} />);
    expect(screen.getByText('1,312 songs in 7 groups. We never touch them.')).toBeDefined();
    const groups = within(screen.getByRole('list', { name: 'Groups in your Songs folder' })).getAllByRole('listitem');
    expect(groups.filter((group) => group.textContent.includes('Yours — never touched'))).toHaveLength(FAKE_PLAYER_GROUPS.length);
    expect(groups.at(-1)?.textContent).toContain('New dancedance.studio groups');
  });
});
