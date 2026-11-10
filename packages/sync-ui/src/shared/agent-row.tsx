import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type RefObject } from 'react';
import { Icon } from '../icons/icon';
import { getPromptParts, type AgentSkill } from './agent-skills';
import { joinClassNames } from './class-names';

/** How long "Copied ✓" shows before the button says "Copy for your agent" again. */
export const COPIED_MESSAGE_MILLISECONDS = 2_000;

/** idle: nothing yet; copied: on the clipboard; selected: no clipboard here, so the prompt is selected for Ctrl+C. */
export type CopyForAgentState = 'idle' | 'copied' | 'selected';

const LIVE_MESSAGES_BY_STATE: Readonly<Record<CopyForAgentState, string>> = { idle: '', copied: 'Copied', selected: 'Selected. Press Ctrl+C to copy.' };

/**
 * Copies the prompt with the Clipboard API. When the browser has none, or refuses (no permission, an old app frame),
 * it selects the prompt's text instead, so the player can still copy it themselves.
 */
export function useCopyForAgent({ promptText, promptElementRef }: { promptText: string; promptElementRef: RefObject<HTMLElement | null> }): { copyState: CopyForAgentState; handleCopy: () => void } {
  const [copyState, setCopyState] = useState<CopyForAgentState>('idle');
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
  }, []);
  const showCopied = (): void => {
    setCopyState('copied');
    if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => { setCopyState('idle'); }, COPIED_MESSAGE_MILLISECONDS);
  };
  // The agent row shows its prompt only once it is needed, so the text is selected after that render.
  useEffect(() => {
    if (copyState !== 'selected') return;
    const promptElement = promptElementRef.current;
    const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (!promptElement || !selection) return;
    selection.selectAllChildren(promptElement);
  }, [copyState, promptElementRef]);
  const selectPrompt = (): void => {
    if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    setCopyState('selected');
  };
  const handleCopy = (): void => {
    const clipboard = typeof navigator === 'undefined' ? undefined : (navigator.clipboard as Clipboard | undefined);
    if (typeof clipboard?.writeText !== 'function') {
      selectPrompt();
      return;
    }
    clipboard.writeText(promptText).then(showCopied, selectPrompt);
  };
  return { copyState, handleCopy };
}

function CopyForAgentButton({ copyState, onCopy, className }: { copyState: CopyForAgentState; onCopy: () => void; className: string }): ReactElement {
  const isCopied = copyState === 'copied';
  return (
    <>
      <button className={joinClassNames(className, isCopied && `${className}--copied`)} type="button" onClick={onCopy}>{isCopied ? 'Copied ✓' : 'Copy for your agent'}</button>
      <span className="sv-sync-visually-hidden" aria-live="polite">{LIVE_MESSAGES_BY_STATE[copyState]}</span>
    </>
  );
}

function PromptText({ skill }: { skill: AgentSkill }): ReactElement {
  const { textBefore, skillName, textAfter } = getPromptParts(skill);
  return <>{textBefore}<b>{skillName}</b>{textAfter}</>;
}

export interface AgentRowProps {
  skill: AgentSkill;
  /** The feature's colour for the small lightning, for example "#ffd36b" for addons. */
  toneColor?: string;
}

/**
 * The dashed row above the addon and generator lists: what it does on the left, copy and GitHub on the right. The
 * prompt itself shows only when the clipboard can't be used, already selected for copying.
 */
export function AgentRow({ skill, toneColor }: AgentRowProps): ReactElement {
  const promptRef = useRef<HTMLElement | null>(null);
  const { copyState, handleCopy } = useCopyForAgent({ promptText: skill.promptText, promptElementRef: promptRef });
  return (
    <div className="sv-sync-agent-row" style={toneColor ? { '--sv-sync-agent-tone': toneColor } as CSSProperties : undefined}>
      <div className="sv-sync-agent-row-text">
        <b>{skill.rowTitle}</b>
        <span className="sv-sync-agent-row-line"><Icon name="lightning" size={12} />{skill.rowLine}</span>
      </div>
      <div className="sv-sync-agent-row-actions">
        <CopyForAgentButton copyState={copyState} onCopy={handleCopy} className="sv-sync-agent-copy" />
        <a className="sv-sync-agent-link" href={skill.githubUrl} target="_blank" rel="noreferrer">{skill.githubLinkText}</a>
      </div>
      {copyState === 'selected' && <code ref={promptRef} className="sv-sync-agent-prompt sv-sync-agent-prompt--fallback"><PromptText skill={skill} /></code>}
    </div>
  );
}

export interface AgentBoxProps {
  skill: AgentSkill;
  /** Defaults to "View the skill on GitHub", as on the intro page. */
  githubLinkText?: string;
}

/** The intro page's box: a title, the ready-made prompt in a code block, "Copy for your agent" and the GitHub link. */
export function AgentBox({ skill, githubLinkText = 'View the skill on GitHub' }: AgentBoxProps): ReactElement {
  const promptRef = useRef<HTMLElement | null>(null);
  const { copyState, handleCopy } = useCopyForAgent({ promptText: skill.promptText, promptElementRef: promptRef });
  return (
    <div className="sv-sync-agent-box">
      <span className="sv-sync-agent-box-title"><Icon name="lightning" size={14} />{skill.boxTitle}</span>
      <code ref={promptRef} className="sv-sync-agent-prompt"><PromptText skill={skill} /></code>
      <span className="sv-sync-agent-box-actions">
        <CopyForAgentButton copyState={copyState} onCopy={handleCopy} className="sv-sync-agent-copy" />
        <a className="sv-sync-agent-link" href={skill.githubUrl} target="_blank" rel="noreferrer">{githubLinkText}</a>
      </span>
    </div>
  );
}
