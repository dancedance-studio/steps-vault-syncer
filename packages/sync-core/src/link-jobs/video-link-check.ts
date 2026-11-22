import type { DecodedAudio } from '../audio-matching/audio-decoder';
import type { AudioFingerprint } from '../audio-matching/audio-match';
import { matchSongMiddle, type MiddleMatch } from '../audio-matching/middle-match';
import { buildOnsetEnvelope, ENVELOPE_RATE_HERTZ } from '../audio-matching/onset-envelope';
import type { LinkJobAnswer } from './link-job-protocol';

/** A video may run this much longer or shorter than the song: an intro or an outro, not another song. */
export const MAXIMUM_VIDEO_LENGTH_DIFFERENCE_SECONDS = 10;
const OTHER_MUSIC_REASON = 'The music in that video isn’t this song.';

/** A video's music next to a song's fingerprint, for a verify job (design v3.132). */
export interface VideoAudioComparison {
  videoLengthSeconds: number;
  /** The song's length as its fingerprint has it. */
  fingerprintLengthSeconds: number;
  middle: MiddleMatch;
}

export type VideoCheckAnswer = Extract<LinkJobAnswer, { status: 'matched' | 'different' }>;

/** CPU-heavy like getAudioMatch (the whole file's onset envelope), so the platforms run it off the main thread. */
export function compareVideoAudio({ audio, storedFingerprint }: { audio: DecodedAudio; storedFingerprint: AudioFingerprint }): VideoAudioComparison {
  if (storedFingerprint.rateHertz !== ENVELOPE_RATE_HERTZ) throw new Error(`The song's fingerprint has ${storedFingerprint.rateHertz} frames a second, but Sync reads ${ENVELOPE_RATE_HERTZ}. Update Sync to the latest version.`);
  return {
    videoLengthSeconds: audio.samples.length / audio.sampleRate,
    fingerprintLengthSeconds: storedFingerprint.envelope.length / storedFingerprint.rateHertz,
    middle: matchSongMiddle({ storedEnvelope: storedFingerprint.envelope, playerEnvelope: buildOnsetEnvelope(audio), envelopeRateHertz: ENVELOPE_RATE_HERTZ }),
  };
}

/**
 * The length first, since it gives the player both numbers, then the middle of the song. songLengthSeconds is the
 * length the site shows for the song; 0 when it has none, and then the fingerprint's is used.
 */
export function getVideoCheckAnswer({ comparison, songLengthSeconds }: { comparison: VideoAudioComparison; songLengthSeconds: number }): VideoCheckAnswer {
  const songLength = songLengthSeconds > 0 ? songLengthSeconds : comparison.fingerprintLengthSeconds;
  if (Math.abs(comparison.videoLengthSeconds - songLength) > MAXIMUM_VIDEO_LENGTH_DIFFERENCE_SECONDS) return { status: 'different', reason: `That video is ${formatLength(comparison.videoLengthSeconds)} long; this song is ${formatLength(songLength)}.` };
  if (!comparison.middle.isSameMusic) return { status: 'different', reason: OTHER_MUSIC_REASON };
  return { status: 'matched', lengthSec: Math.round(comparison.videoLengthSeconds), offsetSec: Math.round(comparison.middle.shiftSeconds * 100) / 100 };
}

function formatLength(seconds: number): string {
  const wholeSeconds = Math.round(seconds);
  return `${String(Math.floor(wholeSeconds / 60))}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}
