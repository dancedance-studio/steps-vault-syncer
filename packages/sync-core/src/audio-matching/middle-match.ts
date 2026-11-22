import { SAME_EDIT_MINIMUM_CORRELATION } from './realign-offset';

/** Long enough to tell songs apart by their rhythm, short enough to sit well inside any song. */
const MIDDLE_WINDOW_SECONDS = 30;
/** How far the window may sit from the same place in the other file: the matcher's 15 s, plus the 10 s a length may differ. */
const MAXIMUM_MIDDLE_SHIFT_SECONDS = 25;
/** The matcher's shortest overlap; a shorter window says nothing. */
const MINIMUM_WINDOW_SECONDS = 5;

export interface MiddleMatch {
  /** The middle correlates at least as well as the matcher asks of a whole song (0.6). */
  isSameMusic: boolean;
  /** Pearson correlation of the window and the other file's music at the best place. */
  correlation: number;
  /** How much later the middle comes in the other file (negative: earlier). */
  shiftSeconds: number;
}

/**
 * Whether the middle of a song is in another file's music: 30 s of the song's onset envelope around its middle (half
 * the song when it is shorter than a minute) slides along the other file's envelope, up to 25 s either side of the same
 * place, and must correlate at least as well as the matcher asks of a whole song. The middle is where an intro, an
 * outro or a skit in a video changes nothing.
 */
export function matchSongMiddle({ storedEnvelope, playerEnvelope, envelopeRateHertz }: { storedEnvelope: ArrayLike<number>; playerEnvelope: ArrayLike<number>; envelopeRateHertz: number }): MiddleMatch {
  const windowLength = Math.min(Math.round(MIDDLE_WINDOW_SECONDS * envelopeRateHertz), Math.floor(storedEnvelope.length / 2));
  const noMatch: MiddleMatch = { isSameMusic: false, correlation: 0, shiftSeconds: 0 };
  if (windowLength < MINIMUM_WINDOW_SECONDS * envelopeRateHertz || playerEnvelope.length < windowLength) return noMatch;
  const windowStart = Math.floor((storedEnvelope.length - windowLength) / 2);
  const window = standardize(Float64Array.from({ length: windowLength }, (_, index) => storedEnvelope[windowStart + index] ?? 0));
  const maximumLag = Math.round(MAXIMUM_MIDDLE_SHIFT_SECONDS * envelopeRateHertz);
  const lowestLag = Math.max(-windowStart, -maximumLag);
  const highestLag = Math.min(playerEnvelope.length - windowLength - windowStart, maximumLag);
  if (lowestLag > highestLag) return noMatch;
  const best = findBestLag({ window, player: Float64Array.from(playerEnvelope), firstStart: windowStart + lowestLag, lastStart: windowStart + highestLag });
  return { isSameMusic: best.correlation >= SAME_EDIT_MINIMUM_CORRELATION, correlation: best.correlation, shiftSeconds: (best.start - windowStart) / envelopeRateHertz };
}

/**
 * The start in the player's envelope where the window correlates best. The window is standardised, so its Pearson
 * correlation with a stretch of the player's envelope is Σ window·stretch / (length · the stretch's deviation); running
 * sums give each stretch's deviation without going over it again.
 */
function findBestLag({ window, player, firstStart, lastStart }: { window: Float64Array; player: Float64Array; firstStart: number; lastStart: number }): { start: number; correlation: number } {
  const { sums, squareSums } = buildRunningSums(player);
  let best = { start: firstStart, correlation: 0 };
  for (let start = firstStart; start <= lastStart; start += 1) {
    const deviation = getDeviation({ sums, squareSums, start, length: window.length });
    if (deviation === 0) continue;
    let total = 0;
    for (let index = 0; index < window.length; index += 1) total += (window[index] ?? 0) * (player[start + index] ?? 0);
    const correlation = total / (window.length * deviation);
    if (correlation > best.correlation) best = { start, correlation };
  }
  return { start: best.start, correlation: Math.min(1, best.correlation) };
}

function buildRunningSums(values: Float64Array): { sums: Float64Array; squareSums: Float64Array } {
  const sums = new Float64Array(values.length + 1);
  const squareSums = new Float64Array(values.length + 1);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? 0;
    sums[index + 1] = (sums[index] ?? 0) + value;
    squareSums[index + 1] = (squareSums[index] ?? 0) + value * value;
  }
  return { sums, squareSums };
}

/** The population standard deviation of values[start, start + length), from the running sums. */
function getDeviation({ sums, squareSums, start, length }: { sums: Float64Array; squareSums: Float64Array; start: number; length: number }): number {
  const mean = ((sums[start + length] ?? 0) - (sums[start] ?? 0)) / length;
  const meanOfSquares = ((squareSums[start + length] ?? 0) - (squareSums[start] ?? 0)) / length;
  const variance = meanOfSquares - mean * mean;
  // A flat stretch (silence) correlates with nothing; rounding can leave a tiny variance there.
  return variance > 1e-12 ? Math.sqrt(variance) : 0;
}

function standardize(values: Float64Array): Float64Array {
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const deviation = Math.sqrt(values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length);
  return values.map((value) => (deviation === 0 ? 0 : (value - mean) / deviation));
}
