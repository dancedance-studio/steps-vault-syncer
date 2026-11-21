/**
 * Where a made song's music came from, when a song-source addon found it: for "How it was made", and to make the song
 * again. Sync keeps it on this computer only; it is not sent to the site. Music from the player's own files has none.
 */
export interface SongMusicSource {
  addonId: string;
  addonName: string;
  /** The link the player typed, as Sync checked it; null when the addon was asked with a search instead. */
  link: string | null;
}

/** Reads a saved source; anything missing or broken (and every record written before Sync kept sources) is null. */
export function loadSongMusicSourceOrNull(value: unknown): SongMusicSource | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { addonId, addonName, link } = value as Record<string, unknown>;
  if (typeof addonId !== 'string' || typeof addonName !== 'string') return null;
  return { addonId, addonName, link: typeof link === 'string' ? link : null };
}
