import { APP_NAME } from './brand-names';

/**
 * The two skills a player's AI agent can use to build an addon or connect a generator. Every prompt and GitHub link
 * in Sync and on the intro page comes from here, so moving the skills means changing one place.
 */
export interface AgentSkill {
  /** The skill's folder name, shown in bold inside the prompt. */
  skillName: string;
  githubUrl: string;
  /** What "Copy for your agent" copies. */
  promptText: string;
  /** Agent row on the Sync pages, for example "Build your own addon". */
  rowTitle: string;
  /** Under the row title, for example "One AI prompt builds yours". */
  rowLine: string;
  /** Agent box on the intro page, for example "Build your own addon in one prompt". */
  boxTitle: string;
  /** For example "make-an-addon on GitHub". */
  githubLinkText: string;
}

export const AGENT_SKILLS_BASE_URL = 'https://github.com/steps-vault/steps-vault-syncer/tree/main/.claude/skills';

function buildSkill({ skillName, task, rowTitle, rowLine, boxTitle }: { skillName: string; task: string; rowTitle: string; rowLine: string; boxTitle: string }): AgentSkill {
  const githubUrl = `${AGENT_SKILLS_BASE_URL}/${skillName}`;
  return { skillName, githubUrl, promptText: `Use the ${skillName} skill from ${githubUrl} ${task}`, rowTitle, rowLine, boxTitle, githubLinkText: `${skillName} on GitHub` };
}

export const ADDON_AGENT_SKILL: AgentSkill = buildSkill({
  skillName: 'make-an-addon',
  task: 'to build me an addon that finds songs in my Dropbox music folder.',
  rowTitle: 'Build your own addon',
  rowLine: 'One AI prompt builds yours',
  boxTitle: 'Build your own addon in one prompt',
});

export const GENERATOR_AGENT_SKILL: AgentSkill = buildSkill({
  skillName: 'make-a-generator',
  task: `to connect my own generator to ${APP_NAME}, running on my computer.`,
  rowTitle: 'Connect your own generator',
  rowLine: 'One AI prompt connects yours · free on your computer',
  boxTitle: 'Connect your own generator in one prompt',
});

/** The prompt split around the skill's name, so the name can be shown in bold. */
export function getPromptParts(skill: AgentSkill): { textBefore: string; skillName: string; textAfter: string } {
  const skillNameIndex = skill.promptText.indexOf(skill.skillName);
  if (skillNameIndex < 0) return { textBefore: skill.promptText, skillName: '', textAfter: '' };
  return {
    textBefore: skill.promptText.slice(0, skillNameIndex),
    skillName: skill.skillName,
    textAfter: skill.promptText.slice(skillNameIndex + skill.skillName.length),
  };
}
