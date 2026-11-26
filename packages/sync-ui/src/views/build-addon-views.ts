/** Builds what the addon screens show from installed addons; shared by the website and the desktop app. */
import { getAddonOptionValues, getIgnoredAbilityReasonOrNull, isAddonProviding, isHostOnSites, parseUrlOrNull, type AddonManifest, type AddonOption, type AddonOptionValues, type InstalledAddon } from '@dancedance/sync-core';
import type { AddonInstallPreview, AddonOptionView, AddonView, LinkFieldView, LinksTabView, SongSourceTabView } from '../sync-ui-types';

export function buildAddonView(addon: InstalledAddon): AddonView {
  const { manifest } = addon;
  return {
    addonId: manifest.id,
    name: manifest.name,
    version: manifest.version,
    author: manifest.author,
    providesText: getProvidesText(manifest),
    isEnabled: addon.isEnabled,
    health: { kind: 'working', note: addon.baseUrl },
    options: buildAddonOptionViews({ options: manifest.options, values: addon.optionValues }),
    isAudioSource: isAddonProviding({ manifest, ability: 'audio-links' }),
    ...buildIgnoredAbilityNote(manifest),
  };
}

function buildIgnoredAbilityNote(manifest: AddonManifest): Pick<AddonView, 'ignoredAbilityNote'> {
  const reason = getIgnoredAbilityReasonOrNull(manifest);
  return reason === null ? {} : { ignoredAbilityNote: reason };
}

/** The consent step's preview: every option starts at the addon's default. */
export function buildAddonInstallPreview({ address, manifest, startCommand = null }: { address: string; manifest: AddonManifest; startCommand?: string | null }): AddonInstallPreview {
  return {
    address,
    name: manifest.name,
    version: manifest.version,
    author: manifest.author,
    providesText: getProvidesText(manifest),
    options: buildAddonOptionViews({ options: manifest.options, values: {} }),
    seesWhatYouType: isAddonProviding({ manifest, ability: 'song-source' }),
    startCommand,
  };
}

/** The picks from the consent step, as values for buildInstalledAddon (which checks them against the manifest). */
export function getAddonOptionValuesFromViews(options: readonly AddonOptionView[]): AddonOptionValues {
  return Object.fromEntries(options.map((option) => [option.optionId, option.value]));
}

/**
 * The tabs after Links on the Make a song page: one for each song source that is on and has search fields, named after
 * it, in the order the player added them. A tab has only the addon's search fields; its link fields are in Links.
 */
export function buildSongSourceTabs(addons: readonly InstalledAddon[]): SongSourceTabView[] {
  return getSongSourcesThatAreOn(addons).flatMap((addon) => {
    const searchInputs = addon.manifest.inputs.filter((input) => input.kind === 'search');
    return searchInputs.length === 0 ? [] : [{ addonId: addon.manifest.id, name: addon.manifest.name, inputs: searchInputs }];
  });
}

/** One Links tab for every link addon that is on; null when none is, and then there is no Links tab. */
export function buildLinksTab(addons: readonly InstalledAddon[]): LinksTabView | null {
  const linkFields = getSongSourcesThatAreOn(addons).flatMap((addon) => addon.manifest.inputs.flatMap((input) => (input.kind === 'link' ? [{ addonId: addon.manifest.id, inputId: input.id, sites: [...input.sites] }] : [])));
  if (linkFields.length === 0) return null;
  return { linkFields, sites: [...new Set(linkFields.flatMap((linkField) => linkField.sites))] };
}

/**
 * The link field a link goes to: the first, in the player's addon order, whose sites take the link's host (a subdomain
 * of a site counts). Null for a link that isn't one, or is on no addon's site.
 */
export function findLinkFieldForLink({ linksTab, link }: { linksTab: LinksTabView; link: string }): LinkFieldView | null {
  const hostName = parseUrlOrNull(link)?.hostname;
  if (hostName === undefined) return null;
  return linksTab.linkFields.find((linkField) => isHostOnSites({ hostName, sites: linkField.sites })) ?? null;
}

function getSongSourcesThatAreOn(addons: readonly InstalledAddon[]): InstalledAddon[] {
  return addons.filter((addon) => addon.isEnabled && isAddonProviding({ manifest: addon.manifest, ability: 'song-source' }));
}

/** "Audio and video links · Song search · New songs to make": what Sync asks the addon for. */
function getProvidesText(manifest: AddonManifest): string {
  const providedTexts: string[] = [];
  if (isAddonProviding({ manifest, ability: 'audio-links' })) providedTexts.push(isAddonProviding({ manifest, ability: 'video-links' }) ? 'Audio and video links' : 'Audio links');
  if (isAddonProviding({ manifest, ability: 'song-search' })) providedTexts.push('Song search');
  if (isAddonProviding({ manifest, ability: 'song-source' })) providedTexts.push('New songs to make');
  return providedTexts.join(' · ');
}

export function buildAddonOptionViews({ options, values }: { options: readonly AddonOption[] | undefined; values: AddonOptionValues }): AddonOptionView[] {
  const checkedValues = getAddonOptionValues({ options, savedValues: values });
  return (options ?? []).map((option) => ({ optionId: option.id, label: option.label, choices: option.choices, value: checkedValues[option.id] ?? option.default }));
}
