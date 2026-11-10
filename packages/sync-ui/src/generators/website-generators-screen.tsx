import type { ReactElement } from 'react';
import { Icon } from '../icons/icon';
import { AgentRow } from '../shared/agent-row';
import { GENERATOR_AGENT_SKILL } from '../shared/agent-skills';
import { APP_NAME } from '../shared/brand-names';
import { FEATURE_TONE_COLORS, SquareIconTile } from '../shared/square-icon-tile';
import type { StepsVaultGeneratorView } from '../sync-ui-types';
import { StepsVaultGeneratorCard } from './generator-card';
import { GeneratorsHeading, YourGeneratorsHeading } from './generators-screen';

export interface WebsiteGeneratorsScreenProps {
  stepsVaultGenerator: StepsVaultGeneratorView;
  /** The site's own Make a song page, which uses the dancedance.studio generator. */
  makeSongHref: string;
  /** "Get the app": the site's download page, which also says which systems are coming soon. */
  desktopAppHref: string;
  /** The Play page, where the songs made on this computer play through the app's local bridge. */
  playPageHref?: string;
}

/**
 * Generators on the website. A browser tab can't run the player's own generators (they start and run on the
 * computer, through the desktop app), so this screen shows the site's generator, says where theirs run, and offers
 * the prompt that connects one. Adding one, the list, and the songs being made live only in the app.
 */
export function WebsiteGeneratorsScreen(props: WebsiteGeneratorsScreenProps): ReactElement {
  return (
    <div className="sv-sync-screen">
      <GeneratorsHeading makeSongAction={<a className="sv-sync-button" href={props.makeSongHref}><Icon name="sparkle" strokeWidth={2.4} />Make a song</a>} />
      <StepsVaultGeneratorCard generator={props.stepsVaultGenerator} />
      <section className="sv-sync-stack" aria-labelledby="sv-sync-your-generators-heading">
        <YourGeneratorsHeading />
        <AgentRow skill={GENERATOR_AGENT_SKILL} toneColor={FEATURE_TONE_COLORS.generators} />
        <GeneratorsNeedTheAppNote desktopAppHref={props.desktopAppHref} playPageHref={props.playPageHref} />
      </section>
    </div>
  );
}

function GeneratorsNeedTheAppNote({ desktopAppHref, playPageHref }: { desktopAppHref: string; playPageHref?: string }): ReactElement {
  return (
    <div className="sv-sync-generators-app-note">
      <SquareIconTile tone="generators" size={44}><Icon name="computer" size={22} /></SquareIconTile>
      <p>
        Your generators run on your computer, in the {APP_NAME} app. Get the app to add one.
        {playPageHref && <> Songs they make play on the <a href={playPageHref}>Play</a> page.</>}
      </p>
      <a className="sv-sync-button" href={desktopAppHref}><Icon name="download" size={18} strokeWidth={2.4} />Get the app</a>
    </div>
  );
}
