import { getCheckedSongSourceInputValue, getLinkSitesText, getLinkSourceSite, getSongSourceInputValues, InvalidSongSourceInputError, type SongSourceInput } from '@dancedance/sync-core';
import { useEffect, useRef, useState, type SubmitEvent, type KeyboardEvent, type ReactElement } from 'react';
import { Icon } from '../icons/icon';
import { joinClassNames } from '../shared/class-names';
import { MissLine } from '../shared/miss-line';
import { ReceptorLoader } from '../shared/receptor-loader';
import type { LinksTabView, MusicChoiceView, PreselectedSongView, SongSourceSearchRequest, SongSourceSearchResult, SongSourceTabView } from '../sync-ui-types';
import { findLinkFieldForLink } from '../views/build-addon-views';

const MY_FILES_TAB_ID = 'my-files';
const MUSIC_FOLDERS_TAB_ID = 'music-folders';
const LINKS_TAB_ID = 'links';
const SONG_LINK_INPUT_ID = 'song-link';

export interface MusicSources {
  /** One tab for every link addon that is on; null when none is. */
  linksTab: LinksTabView | null;
  /** One tab for each addon with search fields, after Links. */
  songSourceTabs: readonly SongSourceTabView[];
  /** Opens the platform's own file picker; null when the player closed it. */
  onChooseMusicFile: () => Promise<MusicChoiceView | null>;
  /** Searches the music folders Sync already knows. */
  onSearchMusic: (query: string) => Promise<readonly MusicChoiceView[]>;
  /** Asks a song source for the song the player described; resolves when it answers, gives up, or is stopped. */
  onFindSong: (request: SongSourceSearchRequest) => Promise<SongSourceSearchResult>;
  onStopFindingSong: () => void;
}

export interface MusicStepProps extends MusicSources {
  pickedMusic: MusicChoiceView | null;
  onPickMusic: (music: MusicChoiceView) => void;
  /** "Yes, use it" on a song a song source found: picks it and goes on to the next step. */
  onUseMusic?: (music: MusicChoiceView) => void;
  /** Opens on the music folders, already searched for this song. */
  preselectedSong?: PreselectedSongView | null;
}

/** "Get music from": the player's files, their music folders, links, then one tab per search addon. */
export function MusicTabs(props: MusicStepProps): ReactElement {
  const tabs = [
    { tabId: MY_FILES_TAB_ID, label: 'My files' },
    { tabId: MUSIC_FOLDERS_TAB_ID, label: 'My music folders' },
    ...(props.linksTab ? [{ tabId: LINKS_TAB_ID, label: 'Links' }] : []),
    ...props.songSourceTabs.map((tab) => ({ tabId: `addon-${tab.addonId}`, label: tab.name })),
  ];
  const [chosenTabId, setChosenTabId] = useState(props.preselectedSong ? MUSIC_FOLDERS_TAB_ID : MY_FILES_TAB_ID);
  const tabListRef = useRef<HTMLDivElement>(null);
  // A tab whose addon (or last link addon) is turned off or removed while it is open goes away: My files shows instead, quietly.
  const isChosenTabShown = tabs.some((tab) => tab.tabId === chosenTabId);
  const selectedTabId = isChosenTabShown ? chosenTabId : MY_FILES_TAB_ID;
  useEffect(() => {
    if (isChosenTabShown) return;
    setChosenTabId(MY_FILES_TAB_ID);
    if (document.activeElement === null || document.activeElement === document.body) focusTab({ tabList: tabListRef.current, index: 0 });
  }, [isChosenTabShown]);
  const songSourceTab = props.songSourceTabs.find((tab) => `addon-${tab.addonId}` === selectedTabId);
  const moveSelection = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = getNextTabIndex({ key: event.key, index: tabs.findIndex((tab) => tab.tabId === selectedTabId), tabCount: tabs.length });
    const nextTab = index === null ? undefined : tabs[index];
    if (index === null || !nextTab) return;
    event.preventDefault();
    setChosenTabId(nextTab.tabId);
    focusTab({ tabList: tabListRef.current, index });
  };
  return (
    <div className="sv-sync-stack-small">
      <span className="sv-sync-visually-hidden" id="sv-sync-music-tabs-label">Where the music comes from</span>
      <div ref={tabListRef} className="sv-sync-tabs sv-sync-music-tabs" role="tablist" aria-labelledby="sv-sync-music-tabs-label" onKeyDown={moveSelection}>
        {tabs.map((tab) => (
          <button key={tab.tabId} id={`sv-sync-tab-${tab.tabId}`} type="button" role="tab" aria-selected={tab.tabId === selectedTabId} aria-controls="sv-sync-music-tab-panel" tabIndex={tab.tabId === selectedTabId ? 0 : -1} onClick={() => { setChosenTabId(tab.tabId); }}>
            {tab.label}
          </button>
        ))}
      </div>
      <div id="sv-sync-music-tab-panel" className="sv-sync-tab-panel" role="tabpanel" aria-labelledby={`sv-sync-tab-${selectedTabId}`}>
        {selectedTabId === MY_FILES_TAB_ID && <MyFilesTab {...props} />}
        {selectedTabId === MUSIC_FOLDERS_TAB_ID && <MusicFoldersTab {...props} />}
        {selectedTabId === LINKS_TAB_ID && props.linksTab && <LinksTab {...props} links={props.linksTab} />}
        {songSourceTab && <SongSourceTab key={songSourceTab.addonId} tab={songSourceTab} {...props} />}
      </div>
    </div>
  );
}

/** Arrow keys go round the tabs; Home and End go to the first and the last. Null for any other key. */
function getNextTabIndex({ key, index, tabCount }: { key: string; index: number; tabCount: number }): number | null {
  if (key === 'ArrowRight') return (index + 1) % tabCount;
  if (key === 'ArrowLeft') return (index - 1 + tabCount) % tabCount;
  if (key === 'Home') return 0;
  if (key === 'End') return tabCount - 1;
  return null;
}

function focusTab({ tabList, index }: { tabList: HTMLDivElement | null; index: number }): void {
  tabList?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
}

/** One music the player can pick; the picked one is marked. */
export function MusicChoiceRow({ music, isPicked, onPick }: { music: MusicChoiceView; isPicked: boolean; onPick: (music: MusicChoiceView) => void }): ReactElement {
  return (
    <label className={joinClassNames('sv-sync-pick', isPicked && 'sv-sync-pick--on')}>
      <input type="radio" name="sv-sync-music" checked={isPicked} onChange={() => { onPick(music); }} />
      <span className="sv-sync-min-width-0">
        <span className="sv-sync-pick-title" dir="auto">{music.title} <span className="sv-sync-muted">· {music.artist}</span></span>
        <span className="sv-sync-pick-subtitle">{[music.sourceText, music.lengthText].filter(Boolean).join(' · ')}</span>
      </span>
      {music.hasVideo && <span className="sv-sync-badge">Video too</span>}
    </label>
  );
}

function MyFilesTab({ pickedMusic, onPickMusic, onChooseMusicFile }: MusicStepProps): ReactElement {
  const [chosenMusic, setChosenMusic] = useState<MusicChoiceView | null>(null);
  const chooseFile = async (): Promise<void> => {
    const music = await onChooseMusicFile();
    if (!music) return;
    setChosenMusic(music);
    onPickMusic(music);
  };
  return (
    <div className="sv-sync-stack-small">
      <button className="sv-sync-button sv-sync-button--ghost sv-sync-align-start" type="button" onClick={() => void chooseFile()}><Icon name="file" />Choose a file…</button>
      {chosenMusic && <MusicChoiceRow music={chosenMusic} isPicked={pickedMusic?.musicId === chosenMusic.musicId} onPick={onPickMusic} />}
    </div>
  );
}

function MusicFoldersTab({ pickedMusic, onPickMusic, onSearchMusic, preselectedSong }: MusicStepProps): ReactElement {
  const [query, setQuery] = useState(preselectedSong ? getPreselectedSongQuery(preselectedSong) : '');
  const [results, setResults] = useState<readonly MusicChoiceView[] | null>(null);
  useEffect(() => {
    if (!preselectedSong) return;
    let isStillShown = true;
    void findPreselectedSongMusic({ preselectedSong, onSearchMusic }).then((found) => {
      if (!isStillShown) return;
      setQuery(found.query);
      setResults(found.musics);
      const onlyMusic = found.musics.length === 1 ? found.musics[0] : undefined;
      if (onlyMusic) onPickMusic(onlyMusic);
    });
    return () => { isStillShown = false; };
    // Searches once, when the tab opens for the preselected song; later searches are the player's own.
  }, []);
  const search = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (query.trim() === '') return;
    setResults(await onSearchMusic(query.trim()).catch(() => []));
  };
  return (
    <div className="sv-sync-stack-small">
      <form className="sv-sync-row" role="search" onSubmit={(event) => void search(event)}>
        <label className="sv-sync-grow sv-sync-search-box">
          <span className="sv-sync-visually-hidden">Search your music folders</span>
          <Icon name="search" />
          <input className="sv-sync-field" type="search" value={query} placeholder="Search your music" onChange={(event) => { setQuery(event.target.value); }} />
        </label>
        <button className="sv-sync-button sv-sync-button--ghost" type="submit"><Icon name="search" />Search</button>
      </form>
      {results?.length === 0 && <span className="sv-sync-small sv-sync-muted">No music found for “{query.trim()}”. Check your music folders under Audio sources.</span>}
      {results && results.length > 0 && (
        <div className="sv-sync-pick-list" role="radiogroup" aria-label="Music in your folders">
          {results.map((music) => <MusicChoiceRow key={music.musicId} music={music} isPicked={pickedMusic?.musicId === music.musicId} onPick={onPickMusic} />)}
        </div>
      )}
    </div>
  );
}

function getPreselectedSongQuery(preselectedSong: PreselectedSongView): string {
  return [preselectedSong.title, preselectedSong.artist].filter(Boolean).join(' ');
}

/** Title and artist first; a file often has no artist tag, so then the title alone. */
async function findPreselectedSongMusic({ preselectedSong, onSearchMusic }: { preselectedSong: PreselectedSongView; onSearchMusic: MusicSources['onSearchMusic'] }): Promise<{ query: string; musics: readonly MusicChoiceView[] }> {
  const fullQuery = getPreselectedSongQuery(preselectedSong);
  const musics = await onSearchMusic(fullQuery).catch(() => []);
  if (musics.length > 0 || fullQuery === preselectedSong.title) return { query: fullQuery, musics };
  return { query: preselectedSong.title, musics: await onSearchMusic(preselectedSong.title).catch(() => []) };
}

type SearchState =
  | { kind: 'idle' }
  | { kind: 'asking' }
  | { kind: 'found'; musics: readonly MusicChoiceView[]; checkedMusic: MusicChoiceView | null }
  /** addonMessage: the addon's own sentence, when it gave one. */
  | { kind: 'not-found'; addonMessage: string }
  | { kind: 'not-answering' };

/** What a finder's lines call whoever is asked: a search addon by its name, or "your link addon". */
interface FinderWords {
  seesWhatYouType: string;
  asking: string;
  didNotFind: string;
  isNotAnswering: string;
}

/** What was typed, checked: the request to send, or the problem to show under a field. */
type FinderCheck =
  /** sourceText: what each found song shows as where it comes from, instead of the platform's own text; null keeps that. */
  | { kind: 'request'; request: SongSourceSearchRequest; sourceText: string | null }
  | { kind: 'problem'; inputId: string; message: string };

interface SongFinderProps extends MusicStepProps {
  inputs: readonly SongSourceInput[];
  words: FinderWords;
  /** Runs before anything is sent, so what breaks a field's rules never reaches an addon. */
  checkInput: (valuesByInputId: Readonly<Record<string, string>>) => FinderCheck;
}

const LINK_ADDON_WORDS: FinderWords = { seesWhatYouType: 'Your link addon sees the link.', asking: 'Asking your link addon…', didNotFind: 'Your link addon didn’t find this song.', isNotAnswering: 'Your link addon isn’t answering.' };

/**
 * Links: one field for every link addon that is on. The link is checked against all their sites together, then goes to
 * the first addon, in the player's order, whose sites take it; a found song shows the link's site as where it comes from.
 */
function LinksTab({ links, ...props }: MusicStepProps & { links: LinksTabView }): ReactElement {
  const songLinkInput: SongSourceInput = { id: SONG_LINK_INPUT_ID, kind: 'link', label: 'Song link', placeholder: 'https://…', sites: links.sites };
  return <SongFinder {...props} inputs={[songLinkInput]} words={LINK_ADDON_WORDS} checkInput={(valuesByInputId) => checkSongLink({ links, input: songLinkInput, value: valuesByInputId[SONG_LINK_INPUT_ID] ?? '' })} />;
}

function checkSongLink({ links, input, value }: { links: LinksTabView; input: SongSourceInput; value: string }): FinderCheck {
  try {
    const link = getCheckedSongSourceInputValue({ input, value });
    // The check takes only links on the addons' sites together, so one of the addons takes this one.
    const linkField = findLinkFieldForLink({ linksTab: links, link });
    if (!linkField) return { kind: 'problem', inputId: input.id, message: 'That site isn’t allowed here.' };
    return { kind: 'request', request: { addonId: linkField.addonId, valuesByInputId: { [linkField.inputId]: link } }, sourceText: getLinkSourceSite({ link, sites: linkField.sites }) };
  } catch (error) {
    if (error instanceof InvalidSongSourceInputError) return { kind: 'problem', inputId: error.inputId, message: error.message };
    throw error;
  }
}

/** A search addon's own tab: its search fields, and its name in every line. */
function SongSourceTab({ tab, ...props }: MusicStepProps & { tab: SongSourceTabView }): ReactElement {
  const words = { seesWhatYouType: `${tab.name} sees what you type.`, asking: `Asking ${tab.name}…`, didNotFind: `${tab.name} didn’t find this song.`, isNotAnswering: `${tab.name} isn’t answering.` };
  const checkInput = (valuesByInputId: Readonly<Record<string, string>>): FinderCheck => {
    const problem = getFirstInputProblemOrNull({ inputs: tab.inputs, valuesByInputId });
    return problem ? { kind: 'problem', ...problem } : { kind: 'request', request: { addonId: tab.addonId, valuesByInputId }, sourceText: null };
  };
  return <SongFinder {...props} inputs={tab.inputs} words={words} checkInput={checkInput} />;
}

/**
 * Fields, checked here before anything is sent; then the songs found (one goes straight to "Is this the song?",
 * several are a list to pick from) to check and use.
 */
function SongFinder({ inputs, words, checkInput, onPickMusic, onUseMusic, onFindSong, onStopFindingSong }: SongFinderProps): ReactElement {
  const [valuesByInputId, setValuesByInputId] = useState<Record<string, string>>({});
  const [problemsByInputId, setProblemsByInputId] = useState<Record<string, string>>({});
  const [search, setSearch] = useState<SearchState>({ kind: 'idle' });
  const fieldsByInputId = useRef(new Map<string, HTMLInputElement>());
  const isAskingRef = useRef(false);
  // Leaving the tab (another tab, Cancel, or the addon turned off) stops a question still waiting for its answer.
  useEffect(() => () => { if (isAskingRef.current) onStopFindingSong(); }, []);
  const showProblem = ({ inputId, message }: { inputId: string; message: string }): void => {
    setProblemsByInputId({ [inputId]: message });
    fieldsByInputId.current.get(inputId)?.focus();
  };
  const changeValue = ({ input, value }: { input: SongSourceInput; value: string }): void => {
    setValuesByInputId((current) => ({ ...current, [input.id]: value }));
    setProblemsByInputId((current) => ({ ...current, [input.id]: '' }));
  };
  const findSong = async (): Promise<void> => {
    const checked = checkInput(valuesByInputId);
    if (checked.kind === 'problem') {
      showProblem(checked);
      return;
    }
    setProblemsByInputId({});
    setSearch({ kind: 'asking' });
    isAskingRef.current = true;
    const result = await onFindSong(checked.request).catch((): SongSourceSearchResult => ({ kind: 'not-answering', message: '' }));
    isAskingRef.current = false;
    setSearch(getSearchState({ result, sourceText: checked.sourceText }));
    // The platform checks again with the addon's own fields; the Links field stands for all of them.
    if (result.kind === 'invalid-input') showProblem({ inputId: inputs.some((input) => input.id === result.inputId) ? result.inputId : (inputs[0]?.id ?? result.inputId), message: result.message });
  };
  const handleSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void findSong();
  };
  const confirmMusic = (music: MusicChoiceView): void => {
    if (onUseMusic) onUseMusic(music);
    else onPickMusic(music);
  };
  // With one song found there is nothing else to pick, so the player goes back to change what they typed.
  const pickAnother = (foundSearch: Extract<SearchState, { kind: 'found' }>): void => {
    if (foundSearch.musics.length > 1) {
      setSearch({ ...foundSearch, checkedMusic: null });
      return;
    }
    setSearch({ kind: 'idle' });
    const firstInput = inputs[0];
    if (firstInput) fieldsByInputId.current.get(firstInput.id)?.focus();
  };
  const tryAgainButton = <button className="sv-sync-button sv-sync-button--ghost sv-sync-button--small" type="button" onClick={() => void findSong()}>Try again</button>;
  return (
    <form className="sv-sync-stack-small" onSubmit={handleSubmit} noValidate>
      {inputs.map((input) => (
        <SongSourceField
          key={input.id}
          input={input}
          value={valuesByInputId[input.id] ?? ''}
          problem={problemsByInputId[input.id] ?? ''}
          fieldRef={(field) => { if (field) fieldsByInputId.current.set(input.id, field); else fieldsByInputId.current.delete(input.id); }}
          onChange={(value) => { changeValue({ input, value }); }}
        />
      ))}
      <span className="sv-sync-sees-line"><Icon name="eye" size={15} />{words.seesWhatYouType}</span>
      {search.kind === 'asking'
        ? <div className="sv-sync-row sv-sync-wrap" aria-live="polite"><ReceptorLoader label={words.asking} isSmall /><button className="sv-sync-button sv-sync-button--ghost sv-sync-button--small" type="button" onClick={onStopFindingSong}>Stop</button></div>
        : <button className="sv-sync-button sv-sync-align-start" type="submit"><Icon name="search" />Find the song</button>}
      {search.kind === 'not-found' && <MissLine action={tryAgainButton}>{words.didNotFind}{search.addonMessage === '' ? '' : ` ${search.addonMessage}`}</MissLine>}
      {search.kind === 'not-answering' && <MissLine action={tryAgainButton}>{words.isNotAnswering}</MissLine>}
      {search.kind === 'found' && search.checkedMusic === null && (
        <div className="sv-sync-pick-list" role="radiogroup" aria-label="Music found">
          {search.musics.map((music) => <MusicChoiceRow key={music.musicId} music={music} isPicked={false} onPick={(picked) => { setSearch({ ...search, checkedMusic: picked }); }} />)}
        </div>
      )}
      {search.kind === 'found' && search.checkedMusic && <SongCheck music={search.checkedMusic} onUse={confirmMusic} onPickAnother={() => { pickAnother(search); }} />}
    </form>
  );
}

/** "Is this the song?": what the song source found, to check before making it. */
function SongCheck({ music, onUse, onPickAnother }: { music: MusicChoiceView; onUse: (music: MusicChoiceView) => void; onPickAnother: () => void }): ReactElement {
  return (
    <div className="sv-sync-song-check" role="group" aria-label="Is this the song?">
      <b>Is this the song?</b>
      <span dir="auto">{[`${music.title} · ${music.artist}`, music.sourceText, music.lengthText].filter(Boolean).join(' · ')}{music.hasVideo ? ' · video too' : ''}</span>
      <span className="sv-sync-row sv-sync-wrap">
        <button className="sv-sync-button sv-sync-button--small" type="button" onClick={() => { onUse(music); }}>Yes, use it</button>
        <button className="sv-sync-button sv-sync-button--ghost sv-sync-button--small" type="button" onClick={onPickAnother}>Pick another</button>
      </span>
    </div>
  );
}

interface SongSourceFieldProps {
  input: SongSourceInput;
  value: string;
  problem: string;
  fieldRef: (field: HTMLInputElement | null) => void;
  onChange: (value: string) => void;
}

/** One field, labelled by the addon. A link field says which sites it takes; a problem stays until the player edits the text. */
function SongSourceField({ input, value, problem, fieldRef, onChange }: SongSourceFieldProps): ReactElement {
  const hintId = `sv-sync-input-hint-${input.id}`;
  const problemId = `sv-sync-input-problem-${input.id}`;
  const describedByIds = [input.kind === 'link' ? hintId : '', problem === '' ? '' : problemId].filter(Boolean).join(' ');
  return (
    <div className="sv-sync-stack-tiny">
      <label className="sv-sync-field-label">
        {input.label}
        <input ref={fieldRef} className={joinClassNames('sv-sync-field', input.kind === 'link' && 'sv-sync-mono')} type={input.kind === 'link' ? 'url' : 'search'} value={value} placeholder={input.placeholder ?? undefined} aria-invalid={problem !== ''} aria-describedby={describedByIds === '' ? undefined : describedByIds} onChange={(event) => { onChange(event.target.value); }} />
      </label>
      {input.kind === 'link' && <span id={hintId} className="sv-sync-small sv-sync-muted">Works with {getLinkSitesText({ sites: input.sites, joinWord: 'and' })} links.</span>}
      {problem !== '' && <span id={problemId} className="sv-sync-small sv-sync-error-text sv-sync-field-problem" role="alert"><Icon name="warning" />{problem}</span>}
    </div>
  );
}

/** The first field with a problem, from the same check Sync runs again before calling the addon; null when all are fine. */
function getFirstInputProblemOrNull({ inputs, valuesByInputId }: { inputs: readonly SongSourceInput[]; valuesByInputId: Readonly<Record<string, string>> }): { inputId: string; message: string } | null {
  try {
    getSongSourceInputValues({ inputs, valuesByInputId });
    return null;
  } catch (error) {
    if (error instanceof InvalidSongSourceInputError) return { inputId: error.inputId, message: error.message };
    throw error;
  }
}

function getSearchState({ result, sourceText }: { result: SongSourceSearchResult; sourceText: string | null }): SearchState {
  if (result.kind === 'found') {
    const musics = sourceText === null ? result.musics : result.musics.map((music) => ({ ...music, sourceText }));
    return { kind: 'found', musics, checkedMusic: musics.length === 1 ? (musics[0] ?? null) : null };
  }
  if (result.kind === 'not-found') return { kind: 'not-found', addonMessage: result.message };
  if (result.kind === 'not-answering') return { kind: 'not-answering' };
  return { kind: 'idle' };
}
