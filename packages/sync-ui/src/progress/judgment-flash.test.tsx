/// <reference types="vite/client" />
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import syncUiCss from '../styles/sync-ui.css?raw';
import { JudgmentFlash, JudgmentText, getSyncJudgmentWord } from './judgment-flash';
import { SyncProgressBar } from './sync-progress-bar';

function stubReducedMotion(shouldReduceMotion: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: shouldReduceMotion && query.includes('reduce'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

/** The rules for phones (≤560 px); jsdom can't apply media queries, so the test reads them. */
function getPhoneRules(): string {
  const phoneRulesStart = syncUiCss.indexOf('@media (max-width: 560px)');
  expect(phoneRulesStart).toBeGreaterThan(-1);
  return syncUiCss.slice(phoneRulesStart, syncUiCss.indexOf('\n}', phoneRulesStart));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('JudgmentFlash', () => {
  it('chooses FLAWLESS!! only when nothing needs the player', () => {
    expect(getSyncJudgmentWord(0)).toBe('FLAWLESS!!');
    expect(getSyncJudgmentWord(4)).toBe('PERFECT!');
  });

  it('says how many songs need the player, with buttons to see more or close', () => {
    const onSeeActivity = vi.fn();
    const onDismiss = vi.fn();
    render(<JudgmentFlash syncedCount={19} needsYouCount={4} onSeeActivity={onSeeActivity} onDismiss={onDismiss} />);
    expect(screen.getByRole('status').textContent).toContain('PERFECT!');
    expect(screen.getByText('19 synced · 4 need you')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'View activity' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSeeActivity).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('flashes when motion is fine', () => {
    stubReducedMotion(false);
    render(<JudgmentText word="FLAWLESS!!" />);
    expect(screen.getByText('FLAWLESS!!').className).toContain('sv-sync-judgment--flash');
  });

  it('simply appears, with no flash, when the system asks for reduced motion', () => {
    stubReducedMotion(true);
    render(<JudgmentText word="FLAWLESS!!" />);
    expect(screen.getByText('FLAWLESS!!').className).not.toContain('sv-sync-judgment--flash');
  });

  it('on phones, puts FLAWLESS!! at 34 px on its own line, the title and note full width, then the buttons', () => {
    render(<JudgmentFlash syncedCount={23} needsYouCount={0} onSeeActivity={vi.fn()} onDismiss={vi.fn()} />);
    const panelParts = [...screen.getByRole('status').children];
    expect(panelParts.map((part) => part.className.split(' ')[0])).toEqual(['sv-sync-judgment', 'sv-sync-judgment-text', 'sv-sync-button', 'sv-sync-button']);
    expect(panelParts.slice(2).map((part) => part.textContent)).toEqual(['View activity', 'Done']);
    const phoneRules = getPhoneRules();
    expect(phoneRules).toContain('.sv-sync-judgment-panel > .sv-sync-judgment { font-size: 34px; flex-basis: 100%; }');
    expect(phoneRules).toContain('.sv-sync-judgment-panel > .sv-sync-judgment-text { min-width: 0; flex-basis: 100%; }');
  });

  it('on phones, shows the status counts as a two-column grid with no dividers', () => {
    const phoneRules = getPhoneRules();
    expect(phoneRules).toContain('.sv-sync-counter-tiles { display: grid; grid-template-columns: 1fr 1fr; row-gap: 10px; }');
    expect(phoneRules).toContain('.sv-sync-counter-tile + .sv-sync-counter-tile { border-left: 0; }');
  });
});

describe('SyncProgressBar', () => {
  it('reads out the progress politely and only asks to keep the tab open on the website', () => {
    const { rerender } = render(<SyncProgressBar platform="website" currentSongNumber={3} totalSongCount={10} currentStepText="Finding audio · Paris" />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('Syncing 3 of 10');
    expect(screen.getByText('Syncing 3 of 10').closest('[aria-live="polite"]')).not.toBeNull();
    expect(screen.queryByText(/Keep this tab open/)).not.toBeNull();
    rerender(<SyncProgressBar platform="desktop" currentSongNumber={3} totalSongCount={10} currentStepText="Finding audio · Paris" />);
    expect(screen.queryByText(/Keep this tab open/)).toBeNull();
  });
});
