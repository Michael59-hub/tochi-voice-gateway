import assert from 'node:assert/strict';
import { it as test } from 'vitest';
import { isAudioOnlyAacMp4, validateAudioUpload } from '../src/lib/uploadValidation';

const androidAacFormat = {
  codec: 'MPEG-4/AAC',
  hasAudio: true,
  hasVideo: false,
  numberOfChannels: 1,
  sampleRate: 16_000,
};

test('generic MP4 accepts parsed Android audio-only AAC metadata', () => {
  assert.equal(isAudioOnlyAacMp4(androidAacFormat), true);
});

test('generic MP4 rejects video tracks and non-AAC audio', () => {
  assert.equal(isAudioOnlyAacMp4({ ...androidAacFormat, hasVideo: true }), false);
  assert.equal(isAudioOnlyAacMp4({ ...androidAacFormat, codec: 'MPEG-4/ALAC' }), false);
  assert.equal(isAudioOnlyAacMp4({ ...androidAacFormat, codec: 'MPEG-4/AAC+H.264' }), false);
  assert.equal(isAudioOnlyAacMp4({ ...androidAacFormat, hasAudio: false }), false);
  assert.equal(isAudioOnlyAacMp4({ ...androidAacFormat, numberOfChannels: 0 }), false);
  assert.equal(isAudioOnlyAacMp4({ ...androidAacFormat, sampleRate: 0 }), false);
});

test('upload validator rejects malformed bytes and invalid claimed duration', async () => {
  const malformed = Buffer.from('not an audio container');
  assert.deepEqual(await validateAudioUpload(malformed, 1), {
    ok: false,
    errorCode: 'BAD_FORMAT',
  });
  assert.deepEqual(await validateAudioUpload(malformed, Number.NaN), {
    ok: false,
    errorCode: 'BAD_FORMAT',
  });
  assert.deepEqual(await validateAudioUpload(malformed, -1), {
    ok: false,
    errorCode: 'BAD_FORMAT',
  });
});

test('upload validator preserves the five-megabyte size cap', async () => {
  assert.deepEqual(await validateAudioUpload(Buffer.alloc(5 * 1024 * 1024 + 1), 1), {
    ok: false,
    errorCode: 'TOO_LONG',
  });
});
