import { HttpRequestError, type HttpClient } from '../network/http-client';
import { ADDON_CALL_TIMEOUT_MILLISECONDS, getInstalledAddonOptionValues, MAX_ADDON_ANSWER_BYTES, type InstalledAddon } from './addon-client';
import { InvalidAddonAnswerError, isAddonProviding } from './addon-protocol';
import { buildSongSearchRequestBody, parseSongSearchAnswer, type SongSearchAnswer, type SongSearchFacts } from './song-search-protocol';

export type SongSearchCallResult = SongSearchAnswer | { kind: 'not-answering' };

/**
 * Asks one addon once for versions of a song, by its facts. An addon that is offline, slow or broken never throws: it
 * is 'not-answering'.
 */
export async function fetchSongSearch({ httpClient, addon, song }: { httpClient: HttpClient; addon: InstalledAddon; song: SongSearchFacts }): Promise<SongSearchCallResult> {
  if (!isAddonProviding({ manifest: addon.manifest, ability: 'song-search' })) throw new Error(`${addon.manifest.name} can’t search for songs.`);
  try {
    const response = await httpClient.requestJson({
      url: `${addon.baseUrl}/song-search`,
      method: 'POST',
      jsonBody: buildSongSearchRequestBody({ song, optionValues: getInstalledAddonOptionValues(addon) }),
      timeoutMilliseconds: ADDON_CALL_TIMEOUT_MILLISECONDS,
      maxResponseBytes: MAX_ADDON_ANSWER_BYTES,
    });
    return parseSongSearchAnswer(response);
  } catch (error) {
    if (error instanceof HttpRequestError || error instanceof InvalidAddonAnswerError) return { kind: 'not-answering' };
    throw error;
  }
}
