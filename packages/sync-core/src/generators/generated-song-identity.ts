import type { GeneratorSongFacts } from './generator-protocol';

/** What Sync needs to know about a library song to notice that a generated song is the same song. */
export interface LibrarySongIdentity {
  librarySongId: string;
  title: string;
  artist: string;
  youtubeId: string | null;
}

/**
 * One key per song, whoever made it: the song's video (youtubeId) when known, else the title and the artist. Making the same song
 * again finds the earlier version by this key.
 */
export function getGeneratedSongKey(song: Pick<GeneratorSongFacts, 'title' | 'artist' | 'youtubeId'>): string {
  if (song.youtubeId) return `youtube:${song.youtubeId}`;
  return `song:${getTitleAndArtistKey(song)}`;
}

/** The library song that is the same song as this generated one: the same video (youtubeId), or the same title and artist. */
export function findSameLibrarySong({ song, librarySongs }: { song: Pick<GeneratorSongFacts, 'title' | 'artist' | 'youtubeId'>; librarySongs: readonly LibrarySongIdentity[] }): LibrarySongIdentity | null {
  const titleAndArtistKey = getTitleAndArtistKey(song);
  const sameVideoSong = song.youtubeId ? librarySongs.find((librarySong) => librarySong.youtubeId === song.youtubeId) : undefined;
  return sameVideoSong ?? librarySongs.find((librarySong) => getTitleAndArtistKey(librarySong) === titleAndArtistKey) ?? null;
}

function getTitleAndArtistKey(song: { title: string; artist: string }): string {
  return `${getComparableText(song.title)}\n${getComparableText(song.artist)}`;
}

/** "Cheap  Thrills " and "cheap thrills" are the same title. */
function getComparableText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();
}
