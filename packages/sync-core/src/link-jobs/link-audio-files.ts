import type { LinkAudioContentType } from './link-job-protocol';

/**
 * The type of a music file the website takes as it is for a link song, from the file's first bytes; null for any other
 * file (flac, webm, raw AAC…), which Sync converts first. The bytes, not the name: an addon's file name or address
 * doesn't always say what the file is.
 */
export function getLinkAudioContentTypeOrNull(bytes: Uint8Array): LinkAudioContentType | null {
  if (hasTextAt({ bytes, offset: 0, text: 'OggS' })) return 'audio/ogg';
  if (hasTextAt({ bytes, offset: 0, text: 'RIFF' }) && hasTextAt({ bytes, offset: 8, text: 'WAVE' })) return 'audio/wav';
  if (hasTextAt({ bytes, offset: 4, text: 'ftyp' })) return 'audio/mp4';
  if (hasTextAt({ bytes, offset: 0, text: 'ID3' }) || isMpegAudioFrameStart(bytes)) return 'audio/mpeg';
  return null;
}

/** An MP3 frame header: 11 sync bits, then a layer other than 00, which is raw AAC (ADTS) and not MPEG audio. */
function isMpegAudioFrameStart(bytes: Uint8Array): boolean {
  const [firstByte = 0, secondByte = 0] = bytes;
  return firstByte === 0xff && (secondByte & 0xe0) === 0xe0 && (secondByte & 0x06) !== 0;
}

function hasTextAt({ bytes, offset, text }: { bytes: Uint8Array; offset: number; text: string }): boolean {
  return Array.from(text).every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}
