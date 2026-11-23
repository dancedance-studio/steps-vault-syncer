import {
  buildAddonSongFacts,
  fetchAudioLinks,
  getPlainReasonOrNull,
  getVideoCheckAnswer,
  isAddonProviding,
  type AudioFingerprint,
  type AudioLink,
  type HttpClient,
  type InstalledAddon,
  type LinkJobAnswer,
  type VerifyLinkJob,
  type VideoAudioComparison,
} from '@dancedance/sync-core';

const ADDON_OFF_REASON = 'Your link addon is off in Sync, so it can’t get that video’s music.';
const NOT_ANSWERING_REASON = 'Your link addon isn’t answering. Check that it is running, then try again.';
const STILL_WORKING_REASON = 'Your link addon is still getting that video’s music. Try again in a few minutes.';
const NO_MUSIC_REASON = 'Your link addon couldn’t get the music from that video.';
const DOWNLOAD_FAILED_REASON = 'Sync couldn’t download the music your link addon got. Try again.';
const NO_FINGERPRINT_REASON = 'Sync couldn’t get this song’s sound fingerprint from dancedance.studio. Try again in a minute.';
const COMPARE_FAILED_REASON = 'Sync couldn’t read the music from that video.';

export type SiteVideoCheckAnswer = Extract<LinkJobAnswer, { status: 'matched' | 'different' | 'failed' }>;

/** What a verify job needs from the app: never the game folder, and nothing that uploads. */
export interface SiteVideoCheckPorts {
  getAddons(): readonly InstalledAddon[];
  /** The addons' network: it starts an addon on this computer that has a start command. */
  addonHttpClient: HttpClient;
  /** Into the folder where Sync already keeps addons' files, so a verify adds no storage of its own. A sourceId. */
  downloadAddonFile(options: { url: string; fileName: string | null; addonName: string }): Promise<string>;
  fetchFingerprint(vaultSongId: string): Promise<AudioFingerprint>;
  /** Off the main thread: the file decoded, then compared with the fingerprint. */
  compareVideoAudio(options: { sourceId: string; fingerprint: AudioFingerprint }): Promise<VideoAudioComparison>;
}

/** The job's own clock while the addon answers "still working": how to wait, and when to stop. */
export interface AddonWait {
  waitSeconds(seconds: number): Promise<void>;
  /** True once the job is out of time or the site cancelled it. */
  shouldStop(): boolean;
}

/**
 * Is this video's music the song (design v3.132)? Only the job's link addon is asked, with the song's facts and the
 * video's id, through /audio-links as for an install: another addon's file says nothing about this video. The music it
 * gets is compared with the song's fingerprint: its length, and the middle of the song. Nothing is installed or uploaded.
 */
export async function checkVideoForSite({ ports, job, wait }: { ports: SiteVideoCheckPorts; job: VerifyLinkJob; wait: AddonWait }): Promise<SiteVideoCheckAnswer> {
  const addon = ports.getAddons().find((candidate) => candidate.isEnabled && candidate.manifest.id === job.addonId && isAddonProviding({ manifest: candidate.manifest, ability: 'audio-links' }));
  if (!addon) return buildFailedAnswer(ADDON_OFF_REASON);
  const answer = await fetchVideoAudioLinks({ ports, addon, job, wait });
  if (answer.kind === 'failed') return buildFailedAnswer(answer.reason);
  const musicLink = answer.links.find((link) => link.kind === 'file-url' && link.media === 'audio');
  if (musicLink?.kind !== 'file-url') return buildFailedAnswer(answer.addonError ?? NO_MUSIC_REASON);
  const sourceId = await ports.downloadAddonFile({ url: musicLink.url, fileName: musicLink.fileName, addonName: addon.manifest.name }).catch(() => null);
  if (sourceId === null) return buildFailedAnswer(DOWNLOAD_FAILED_REASON);
  const fingerprint = await ports.fetchFingerprint(job.songId).catch(() => null);
  if (!fingerprint) return buildFailedAnswer(NO_FINGERPRINT_REASON);
  const comparison = await ports.compareVideoAudio({ sourceId, fingerprint }).catch(() => null);
  if (!comparison) return buildFailedAnswer(COMPARE_FAILED_REASON);
  return getVideoCheckAnswer({ comparison, songLengthSeconds: job.song.lengthSeconds });
}

/** Asks again as often as the addon says while it is still working, until it answers or the job's time is up. */
async function fetchVideoAudioLinks({ ports, addon, job, wait }: { ports: SiteVideoCheckPorts; addon: InstalledAddon; job: VerifyLinkJob; wait: AddonWait }): Promise<{ kind: 'links'; links: AudioLink[]; addonError: string | null } | { kind: 'failed'; reason: string }> {
  const song = buildAddonSongFacts({ ...job.song, youtubeId: job.videoId });
  for (;;) {
    const answer = await fetchAudioLinks({ httpClient: ports.addonHttpClient, addon, song });
    if (answer.kind === 'links') return answer;
    if (answer.kind === 'not-answering') return { kind: 'failed', reason: NOT_ANSWERING_REASON };
    if (wait.shouldStop()) return { kind: 'failed', reason: STILL_WORKING_REASON };
    await wait.waitSeconds(answer.retryAfterSeconds);
    if (wait.shouldStop()) return { kind: 'failed', reason: STILL_WORKING_REASON };
  }
}

function buildFailedAnswer(reason: string): SiteVideoCheckAnswer {
  return { status: 'failed', reason: getPlainReasonOrNull(reason) ?? COMPARE_FAILED_REASON };
}
