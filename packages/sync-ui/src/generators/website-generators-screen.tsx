import type { ReactElement } from 'react';
import { Icon } from '../icons/icon';
import { AgentRow } from '../shared/agent-row';
import { GENERATOR_AGENT_SKILL } from '../shared/agent-skills';
import { APP_NAME } from '../shared/brand-names';
import { Note } from '../shared/small-parts';
import { FEATURE_TONE_COLORS } from '../shared/square-icon-tile';
import type { StepsVaultGeneratorView } from '../sync-ui-types';
import { StepsVaultGeneratorCard } from './generator-card';
import { GeneratorsHeading, YourGeneratorsHeading } from './generators-screen';

export interface WebsiteGeneratorsScreenProps {
  stepsVaultGenerator: StepsVaultGeneratorView;
  /** The site's own Make a song page, which uses the dancedance.studio generator. */
  makeSongHref: string;
  desktopAppHref: string;
  /** The Play page, where the songs made on this computer play through the app's local bridge. */
  playPageHref?: string;
}

/**
 * Generators on the website. A browser tab can't run the player's own generators (they start and run on the
 * computer, through the desktop app), so this screen shows the site's generator, says where theirs run, and offers
 * the prompt that connects one.
 */
export function WebsiteGeneratorsScreen(props: WebsiteGeneratorsScreenProps): ReactElement {
  return (
    <div className="sv-sync-screen">
      <GeneratorsHeading makeSongAction={<a className="sv-sync-button" href={props.makeSongHref}><Icon name="sparkle" strokeWidth={2.4} />Make a song</a>} />
      <StepsVaultGeneratorCard generator={props.stepsVaultGenerator} />
      <section className="sv-sync-stack" aria-labelledby="sv-sync-your-generators-heading">
        <YourGeneratorsHeading />
        <AgentRow skill={GENERATOR_AGENT_SKILL} toneColor={FEATURE_TONE_COLORS.generators} />
        <Note iconName="computer">
          Your generators run on your computer, in the {APP_NAME} app. <a href={props.desktopAppHref}>Get the app</a> to add one.
          {props.playPageHref && <> Songs they make play on the <a href={props.playPageHref}>Play</a> page.</>}
        </Note>
      </section>
    </div>
  );
}
