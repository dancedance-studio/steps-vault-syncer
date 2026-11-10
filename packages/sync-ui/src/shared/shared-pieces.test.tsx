/// <reference types="vite/client" />
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentBox, AgentRow, COPIED_MESSAGE_MILLISECONDS } from './agent-row';
import { ADDON_AGENT_SKILL, AGENT_SKILLS_BASE_URL, GENERATOR_AGENT_SKILL, getPromptParts } from './agent-skills';
import { FourArrowLoader } from './four-arrow-loader';
import { GreenPillButton } from './green-pill-button';
import syncUiCss from '../styles/sync-ui.css?raw';

const SYNC_UI_SOURCES_BY_FILE_NAME: Readonly<Record<string, string>> = import.meta.glob<string>('../**/*.tsx', { query: '?raw', import: 'default', eager: true });

function setClipboard(clipboard: Partial<Clipboard> | undefined): void {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
}

async function flushPromises(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

describe('the agent skills', () => {
  it('come from one place, with the owner’s GitHub links and prompts that name them', () => {
    expect(ADDON_AGENT_SKILL.githubUrl).toBe('https://github.com/steps-vault/steps-vault-syncer/tree/main/.claude/skills/make-an-addon');
    expect(GENERATOR_AGENT_SKILL.githubUrl).toBe(`${AGENT_SKILLS_BASE_URL}/make-a-generator`);
    expect(ADDON_AGENT_SKILL.promptText).toBe(`Use the make-an-addon skill from ${ADDON_AGENT_SKILL.githubUrl} to build me an addon that finds songs in my Dropbox music folder.`);
    expect(GENERATOR_AGENT_SKILL.promptText).toContain('to connect my own generator to dancedance.studio Sync, running on my computer.');
    expect(getPromptParts(ADDON_AGENT_SKILL)).toEqual({ textBefore: 'Use the ', skillName: 'make-an-addon', textAfter: ` skill from ${ADDON_AGENT_SKILL.githubUrl} to build me an addon that finds songs in my Dropbox music folder.` });
  });

  it('open GitHub in a new tab that can’t reach back into Sync, and long addresses wrap inside the prompt', () => {
    render(<><AgentRow skill={GENERATOR_AGENT_SKILL} /><AgentBox skill={ADDON_AGENT_SKILL} /></>);
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')?.split(' ')).toContain('noopener');
    }
    expect(syncUiCss).toMatch(/\.sv-sync-agent-prompt \{[^}]*overflow-wrap: anywhere;/);
  });
});

describe('Copy for your agent', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    setClipboard(undefined);
  });

  it('copies the prompt, shows “Copied ✓” for about 2 seconds and says “Copied” politely', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });
    render(<AgentRow skill={ADDON_AGENT_SKILL} />);
    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion?.textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Copy for your agent' }));
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(ADDON_AGENT_SKILL.promptText);
    expect(screen.getByRole('button', { name: 'Copied ✓' })).toBeDefined();
    expect(liveRegion?.textContent).toBe('Copied');
    act(() => { vi.advanceTimersByTime(COPIED_MESSAGE_MILLISECONDS); });
    expect(screen.getByRole('button', { name: 'Copy for your agent' })).toBeDefined();
    expect(liveRegion?.textContent).toBe('');
    expect(screen.getByRole('link', { name: 'make-an-addon on GitHub' }).getAttribute('href')).toBe(ADDON_AGENT_SKILL.githubUrl);
  });

  it('without a clipboard, shows the prompt selected so the player can copy it', () => {
    setClipboard(undefined);
    render(<AgentRow skill={GENERATOR_AGENT_SKILL} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy for your agent' }));
    const prompt = document.querySelector('code');
    expect(prompt?.textContent).toBe(GENERATOR_AGENT_SKILL.promptText);
    expect(window.getSelection()?.toString()).toBe(GENERATOR_AGENT_SKILL.promptText);
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('Selected. Press Ctrl+C to copy.');
  });

  it('selects the prompt when the browser refuses to copy', async () => {
    setClipboard({ writeText: vi.fn(() => Promise.reject(new Error('Not allowed.'))) });
    render(<AgentBox skill={ADDON_AGENT_SKILL} />);
    expect(screen.getByText('Build your own addon in one prompt')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Copy for your agent' }));
    await flushPromises();
    expect(screen.getByRole('button', { name: 'Copy for your agent' })).toBeDefined();
    expect(window.getSelection()?.toString()).toBe(ADDON_AGENT_SKILL.promptText);
    expect(screen.getByRole('link', { name: 'View the skill on GitHub' }).getAttribute('href')).toBe(ADDON_AGENT_SKILL.githubUrl);
  });
});

describe('FourArrowLoader', () => {
  it('draws ← ↓ ↑ → as decoration and says its label as a status', () => {
    render(<FourArrowLoader label="Waiting for the code…" />);
    expect(screen.getByRole('status').textContent).toBe('Waiting for the code…');
    const arrows = document.querySelectorAll('.sv-sync-four-arrows-arrow');
    expect([...arrows].map((arrow) => (arrow as SVGElement).style.transform)).toEqual(['rotate(90deg)', 'rotate(0deg)', 'rotate(180deg)', 'rotate(-90deg)']);
    expect(arrows[0]?.getAttribute('width')).toBe('16');
    expect(document.querySelector('.sv-sync-four-arrows')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('on a green button, puts 15 px dark arrows straight on the green, pulsing without the glow', () => {
    render(<FourArrowLoader tone="on-green" />);
    expect(document.querySelector('.sv-sync-four-arrow-loader')?.className).toBe('sv-sync-four-arrow-loader sv-sync-four-arrow-loader--on-green');
    expect([...document.querySelectorAll('.sv-sync-four-arrows-arrow')].map((arrow) => arrow.getAttribute('width'))).toEqual(['15', '15', '15', '15']);
    expect(syncUiCss).toContain('.sv-sync-four-arrow-loader--on-green .sv-sync-four-arrows { gap: 3px; padding: 0; background: none; color: #0b1400; }');
    expect(syncUiCss).toContain('.sv-sync-four-arrow-loader--on-green .sv-sync-four-arrows-arrow { opacity: .22; animation-name: sv-sync-four-arrows-on-green; }');
    expect(syncUiCss).toContain('@keyframes sv-sync-four-arrows-on-green { 0%, 60%, 100% { opacity: .22; } 20% { opacity: .95; } }');
  });

  it('stays still at 70% when the system asks for less motion', () => {
    const reducedMotionRules = syncUiCss.slice(syncUiCss.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reducedMotionRules).toMatch(/\.sv-sync-four-arrows-arrow \{ animation: none !important; opacity: \.7; \}/);
    expect(reducedMotionRules).toContain('.sv-sync-four-arrow-loader--on-green .sv-sync-four-arrows-arrow { opacity: .6; }');
    expect(syncUiCss).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.sv-sync-root \*, \.sv-sync-root \*::before, \.sv-sync-root \*::after \{ animation: none !important; transition: none !important; \}/);
  });

  it('is the only waiting sign left: nothing in Sync spins or turns', () => {
    expect(syncUiCss).not.toMatch(/rotate\(360deg\)|sv-sync-spin|slow-turn/);
    expect(Object.keys(SYNC_UI_SOURCES_BY_FILE_NAME).length).toBeGreaterThan(40);
    for (const [fileName, sourceText] of Object.entries(SYNC_UI_SOURCES_BY_FILE_NAME)) {
      if (fileName.endsWith('.test.tsx')) continue;
      expect({ fileName, hasSpinningClass: /sv-sync-spin|slow-turn|className="[^"]*\bspin\b/.test(sourceText) }).toEqual({ fileName, hasSpinningClass: false });
    }
  });
});

describe('GreenPillButton', () => {
  it('is disabled and busy while its work runs, and a link when it has an address', () => {
    const { rerender } = render(<GreenPillButton onClick={vi.fn()} isBusy>Syncing…</GreenPillButton>);
    const button = screen.getByRole('button', { name: 'Syncing…' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    rerender(<GreenPillButton href="/sync/connect">Use it in my browser</GreenPillButton>);
    expect(screen.getByRole('link', { name: 'Use it in my browser' }).getAttribute('href')).toBe('/sync/connect');
  });

  it('shows the dark four-arrow loader in place of its icon while busy, at full colour', () => {
    const { rerender } = render(<GreenPillButton onClick={vi.fn()} icon={<svg className="test-icon" />}>Sync now</GreenPillButton>);
    expect(document.querySelector('.test-icon')).not.toBeNull();
    rerender(<GreenPillButton onClick={vi.fn()} icon={<svg className="test-icon" />} isBusy>Sending…</GreenPillButton>);
    const button = screen.getByRole('button', { name: 'Sending…' });
    expect(button.querySelector('.test-icon')).toBeNull();
    expect(button.querySelector('.sv-sync-four-arrow-loader--on-green')).not.toBeNull();
    const busyPillRules = syncUiCss.match(/\.sv-sync-green-pill\[aria-busy="true"\] \{[^}]*\}/g) ?? [];
    expect(busyPillRules).toEqual(['.sv-sync-green-pill[aria-busy="true"] { opacity: 1; }']);
  });
});
