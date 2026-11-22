import { describe, expect, it } from 'vitest';
import type { DecodedAudio } from '../audio-matching/audio-decoder';
import { buildFingerprint } from '../audio-matching/audio-match';
import { matchSongMiddle } from '../audio-matching/middle-match';
import { applyClipOperations, buildSeededRandom, renderSyntheticSong, SYNTHETIC_SAMPLE_RATE, type SyntheticEvent, type SyntheticSong } from '../audio-matching/testing/synthetic-audio';
import { compareVideoAudio, getVideoCheckAnswer, type VideoAudioComparison } from './video-link-check';

/** Rendering a minute and a half of synthetic music, twice, takes a while on slow machines. */
const RENDER_TIMEOUT_MILLISECONDS = 30_000;
const SONG_SECONDS = 90;

/** Kicks and noise bursts at uneven, seeded times: each seed is a different song, with no two shifts alike. */
function buildSong({ seconds, seed }: { seconds: number; seed: number }): Float32Array {
  const getNextRandom = buildSeededRandom(seed);
  const sampleCount = seconds * SYNTHETIC_SAMPLE_RATE;
  const events: SyntheticEvent[] = [];
  for (let position = 0; position < sampleCount; position += Math.floor((0.3 + 0.4 * getNextRandom()) * SYNTHETIC_SAMPLE_RATE)) {
    events.push({ kind: 'kick', startSample: position, sampleCount: 15000, amplitude: 0.3 + 0.4 * getNextRandom() });
    events.push({ kind: 'noise', startSample: position + 6000, sampleCount: 4000, amplitude: 0.2, seed: events.length, decaySamples: 1000 });
  }
  const song: SyntheticSong = { sampleCount, events };
  return renderSyntheticSong(song);
}

function buildAudio(samples: Float32Array): DecodedAudio {
  return { samples, sampleRate: SYNTHETIC_SAMPLE_RATE };
}

const nightDrive = buildSong({ seconds: SONG_SECONDS, seed: 7 });
const otherSong = buildSong({ seconds: SONG_SECONDS, seed: 11 });
const nightDriveFingerprint = buildFingerprint(buildAudio(nightDrive));

describe('compareVideoAudio', () => {
  it('finds the middle of the song in a video with a 4 s intro, and how much later its music starts', { timeout: RENDER_TIMEOUT_MILLISECONDS }, () => {
    const video = applyClipOperations({ samples: nightDrive, operations: [{ kind: 'pad-start', sampleCount: 4 * SYNTHETIC_SAMPLE_RATE }] });
    const comparison = compareVideoAudio({ audio: buildAudio(video), storedFingerprint: nightDriveFingerprint });
    expect(comparison.middle.isSameMusic).toBe(true);
    expect(comparison.middle.correlation).toBeGreaterThan(0.9);
    expect(comparison.middle.shiftSeconds).toBeCloseTo(4, 1);
    expect(comparison.videoLengthSeconds).toBeCloseTo(94, 1);
    expect(getVideoCheckAnswer({ comparison, songLengthSeconds: SONG_SECONDS })).toEqual({ status: 'matched', lengthSec: 94, offsetSec: expect.closeTo(4, 1) as number });
  });

  it('says other music isn’t this song, even at the same length', { timeout: RENDER_TIMEOUT_MILLISECONDS }, () => {
    const comparison = compareVideoAudio({ audio: buildAudio(otherSong), storedFingerprint: nightDriveFingerprint });
    expect(comparison.middle.isSameMusic).toBe(false);
    expect(getVideoCheckAnswer({ comparison, songLengthSeconds: SONG_SECONDS })).toEqual({ status: 'different', reason: 'The music in that video isn’t this song.' });
  });

  it('says a video that starts like the song but has other music in the middle isn’t this song', { timeout: RENDER_TIMEOUT_MILLISECONDS }, () => {
    const firstPart = nightDrive.subarray(0, 30 * SYNTHETIC_SAMPLE_RATE);
    const otherMiddle = otherSong.subarray(30 * SYNTHETIC_SAMPLE_RATE);
    const video = new Float32Array(firstPart.length + otherMiddle.length);
    video.set(firstPart);
    video.set(otherMiddle, firstPart.length);
    expect(compareVideoAudio({ audio: buildAudio(video), storedFingerprint: nightDriveFingerprint }).middle.isSameMusic).toBe(false);
  });

  it('refuses a fingerprint at another rate', () => {
    expect(() => compareVideoAudio({ audio: buildAudio(nightDrive), storedFingerprint: { ...nightDriveFingerprint, rateHertz: 200 } })).toThrow(/Update Sync/);
  });
});

describe('getVideoCheckAnswer', () => {
  const sameMiddle: VideoAudioComparison = { videoLengthSeconds: 221, fingerprintLengthSeconds: 220.6, middle: { isSameMusic: true, correlation: 0.93, shiftSeconds: 1.234 } };

  it('matches within 10 s of the song’s length, with the video’s length and the shift', () => {
    expect(getVideoCheckAnswer({ comparison: sameMiddle, songLengthSeconds: 221 })).toEqual({ status: 'matched', lengthSec: 221, offsetSec: 1.23 });
    expect(getVideoCheckAnswer({ comparison: { ...sameMiddle, videoLengthSeconds: 231 }, songLengthSeconds: 221 }).status).toBe('matched');
  });

  it('says both lengths when they differ by more than 10 s, even with the same middle', () => {
    expect(getVideoCheckAnswer({ comparison: { ...sameMiddle, videoLengthSeconds: 312 }, songLengthSeconds: 221 })).toEqual({ status: 'different', reason: 'That video is 5:12 long; this song is 3:41.' });
  });

  it('uses the fingerprint’s length when the site sent none', () => {
    expect(getVideoCheckAnswer({ comparison: { ...sameMiddle, videoLengthSeconds: 312 }, songLengthSeconds: 0 })).toEqual({ status: 'different', reason: 'That video is 5:12 long; this song is 3:41.' });
  });
});

describe('matchSongMiddle', () => {
  it('uses half of a song shorter than a minute, and says nothing for a song too short to tell', () => {
    const getNextRandom = buildSeededRandom(3);
    const envelope = Float64Array.from({ length: 4000 }, () => getNextRandom());
    const shifted = Float64Array.from({ length: 4300 }, (_, index) => (index < 300 ? getNextRandom() : (envelope[index - 300] ?? 0)));
    expect(matchSongMiddle({ storedEnvelope: envelope, playerEnvelope: shifted, envelopeRateHertz: 100 })).toEqual({ isSameMusic: true, correlation: expect.closeTo(1, 5) as number, shiftSeconds: 3 });
    expect(matchSongMiddle({ storedEnvelope: envelope.subarray(0, 900), playerEnvelope: shifted, envelopeRateHertz: 100 })).toEqual({ isSameMusic: false, correlation: 0, shiftSeconds: 0 });
  });
});
