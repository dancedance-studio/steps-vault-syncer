import { loadSongMusicSourceOrNull, type SongMusicSource } from '../generators/song-music-source';

/** Years of link songs for one player; past this, the oldest records go first. */
const MAX_LINK_SONG_SOURCES = 500;

/**
 * Where a website link song's music came from (the addon, and the link the player typed), by the site's song id. Sync
 * keeps it on this computer only, for "How it was made" and to sync the song again. The site never gets it.
 */
export interface LinkSongSource {
  songId: string;
  source: SongMusicSource;
}

/** Adds the record, or replaces the one for the same song, newest last. */
export function withLinkSongSource({ sources, songId, source }: { sources: readonly LinkSongSource[]; songId: string; source: SongMusicSource }): LinkSongSource[] {
  return [...sources.filter((saved) => saved.songId !== songId), { songId, source }].slice(-MAX_LINK_SONG_SOURCES);
}

/** Reads saved records, keeping only the complete ones. */
export function loadLinkSongSources(value: unknown): LinkSongSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate: unknown) => {
    if (typeof candidate !== 'object' || candidate === null) return [];
    const { songId, source } = candidate as Record<string, unknown>;
    const musicSource = loadSongMusicSourceOrNull(source);
    return typeof songId === 'string' && musicSource ? [{ songId, source: musicSource }] : [];
  });
}
