import { expect, test, vi } from 'vitest';
import { validateImage } from '../../go-groceries-images-meal-resolver/src/image-storage/image-format.ts';
import { hashBlob } from '../src/db/image-cache.ts';
import { readImageDimensions, sniffImageType } from '../src/util/sync/image-container.ts';
import { preparePhoto } from '../src/util/sync/image-preflight.ts';
import { png } from './helpers.mjs';

const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCLAGVxf//Z',
  'base64',
);
const frameOffset = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
const webp = Buffer.from('UklGRhwAAABXRUJQVlA4TA8AAAAvAYAAAAcQ/Y/+ByKi/wEA', 'base64');
const lossyWebp = Buffer.from('UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoCAAMAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=', 'base64');

function jpegFrame(marker, precision, width = 2, height = 3) {
  // Only the frame header is under test for these coding processes.
  const bytes = Buffer.from(jpeg);
  bytes[frameOffset + 1] = marker;
  bytes[frameOffset + 4] = precision;
  bytes.writeUInt16BE(height, frameOffset + 5);
  bytes.writeUInt16BE(width, frameOffset + 7);
  return bytes;
}

function webpChunk(kind, payload) {
  const header = Buffer.alloc(8);
  header.write(kind);
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload, Buffer.alloc(payload.length % 2)]);
}

function webpContainer(...chunks) {
  const bytes = Buffer.concat([webp.subarray(0, 12), ...chunks]);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  return bytes;
}

const webpCanvas = (flags = 0) => webpChunk('VP8X', Buffer.from([flags, 0, 0, 0, 1, 0, 0, 2, 0, 0]));

function animation({ declaredWidth = 2, codedWidth = 2 } = {}) {
  const redFrame = Buffer.from(webp.subarray(12));
  redFrame.writeUInt32LE((redFrame.readUInt32LE(9) & ~0x3fff) | (codedWidth - 1), 9);
  const blueFrame = Buffer.from('UklGRhwAAABXRUJQVlA4TA8AAAAvAYAAAAcQ0f/+ByKi/wEA', 'base64').subarray(12);
  const frameHeader = Buffer.from([0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0, 100, 0, 0, 0]);
  frameHeader.writeUIntLE(declaredWidth - 1, 6, 3);
  return webpContainer(
    webpCanvas(2),
    webpChunk('ANIM', Buffer.alloc(6)),
    ...[redFrame, blueFrame].map(frame => webpChunk('ANMF', Buffer.concat([frameHeader, frame]))),
  );
}

const motionPhoto = Buffer.concat([jpeg, Buffer.from('\0\0\0\x10ftypmp42\0\0\0\0')]);
const mpfPhoto = Buffer.concat([jpeg.subarray(0, frameOffset), Buffer.from('\xff\xe2\0\x06MPF\0', 'latin1'), jpeg.subarray(frameOffset), jpeg]);
const jpegWithFill = Buffer.concat([jpeg.subarray(0, frameOffset), Buffer.from([0xff, 0xff, 0x01, 0xff, 0xf0, 0, 3, 0]), jpeg.subarray(frameOffset)]);
const pngWithTrailer = Buffer.concat([png, Buffer.from('trailer')]);
const webpWithUnknown = webpContainer(webpCanvas(), webpChunk('TEST', Buffer.from([1])), webp.subarray(12));
const webpWithSizeMismatch = Buffer.concat([webp, Buffer.from('trailer')]);
const shortFrame = Buffer.from(jpeg.subarray(0, frameOffset + 10));
shortFrame.writeUInt16BE(8, frameOffset + 2);

async function photo(bytes, mimeType) {
  const blob = new Blob([bytes], { type: mimeType });
  const assetId = await hashBlob(blob);
  return { blob, assetId, sha256: assetId, mimeType, byteLength: blob.size };
}

test.each([
  ['motion JPEG with bytes after EOI', motionPhoto, 'image/jpeg', 2, 3],
  ['MPF JPEG with a second JPEG after EOI', mpfPhoto, 'image/jpeg', 2, 3],
  ['JPEG without EOI', jpeg.subarray(0, -2), 'image/jpeg', 2, 3],
  ['JPEG with fill bytes and unfamiliar metadata', jpegWithFill, 'image/jpeg', 2, 3],
  ['12-bit extended sequential JPEG', jpegFrame(0xc1, 12), 'image/jpeg', 2, 3],
  ['arithmetic progressive JPEG', jpegFrame(0xca, 8), 'image/jpeg', 2, 3],
  ['PNG with bytes after IEND', pngWithTrailer, 'image/png', 1, 1],
  ['WebP with an unknown padded chunk', webpWithUnknown, 'image/webp', 2, 3],
  ['WebP with a RIFF size mismatch', webpWithSizeMismatch, 'image/webp', 2, 3],
  ['animated WebP', animation(), 'image/webp', 2, 3],
])('preflight and Worker accept %s at the dimension check', async (_name, bytes, mimeType, width, height) => {
  const source = await photo(bytes, mimeType);
  expect.soft(sniffImageType(bytes)).toBe(mimeType);
  expect.soft(() => readImageDimensions(bytes, mimeType)).not.toThrow();
  expect.soft(() => validateImage(bytes, mimeType)).not.toThrow();
  expect(await preparePhoto(source)).toEqual({ assetId: source.assetId, mimeType, byteLength: bytes.length,
    observed: { detected: mimeType, width, height } });
});

test.each([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])(
  'reads JPEG frame marker %i', marker => {
    expect(readImageDimensions(jpegFrame(marker, 8), 'image/jpeg')).toEqual({ width: 2, height: 3 });
  },
);

test('reads dimensions from lossy WebP', () => {
  expect(readImageDimensions(lossyWebp, 'image/webp')).toEqual({ width: 2, height: 3 });
});

test.each([
  ['non-image bytes', Buffer.from('not a photo'), 'image/jpeg'],
  ['incorrect MIME magic', png, 'image/jpeg'],
  ['truncated JPEG segment', jpeg.subarray(0, frameOffset + 9), 'image/jpeg'],
  ['JPEG frame segment missing declared component records', shortFrame, 'image/jpeg'],
  ['JPEG with no frame', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg'],
  ['JPEG with a zero edge', jpegFrame(0xc0, 8, 0), 'image/jpeg'],
  ['truncated PNG header', png.subarray(0, 32), 'image/png'],
  ['WebP canvas with an incomplete image chunk header', webpContainer(webpCanvas(), webp.subarray(12, 18)), 'image/webp'],
  ['animated WebP frame without a coded image header', webpContainer(webpCanvas(2), webpChunk('ANMF', Buffer.alloc(16))), 'image/webp'],
  ['animated WebP frame before its canvas', webpContainer(animation().subarray(44), webpCanvas(2)), 'image/webp'],
  ['truncated lossless WebP header', webp.subarray(0, 24), 'image/webp'],
  ['truncated lossy WebP header', lossyWebp.subarray(0, 29), 'image/webp'],
  ['animated WebP frame rectangle larger than the canvas', animation({ declaredWidth: 3 }), 'image/webp'],
  ['animated WebP coded frame larger than the canvas', animation({ codedWidth: 3 }), 'image/webp'],
  ['Worker edge over 8192', jpegFrame(0xc0, 8, 8193, 1), 'image/jpeg'],
  ['Worker pixels over 16 MiPx', jpegFrame(0xc0, 8, 4097, 4096), 'image/jpeg'],
])('Worker rejects %s', (_name, bytes, mimeType) => {
  expect(() => validateImage(bytes, mimeType)).toThrow('Invalid image container or dimensions');
});

test.each([
  ['a source edge over 16384', jpegFrame(0xc0, 8, 16385, 1), 'image/jpeg', 'The photo is too large to process safely.'],
  ['a source over 64 MiPx', jpegFrame(0xc0, 8, 8193, 8192), 'image/jpeg', 'The photo is too large to process safely.'],
  ['a source over 32 MiB', new Uint8Array(32 * 1024 * 1024 + 1), 'image/jpeg', 'The photo is too large to process safely.'],
  ['an oversized animated WebP frame', animation({ codedWidth: 16384 }), 'image/webp', 'The photo container is invalid or unsupported.'],
])('preflight rejects %s before asking the browser to decode', async (_name, bytes, mimeType, reason) => {
  const decode = vi.spyOn(globalThis, 'createImageBitmap');
  try {
    expect(await preparePhoto(await photo(bytes, mimeType))).toMatchObject({ reason });
    expect(decode).not.toHaveBeenCalled();
  } finally { decode.mockRestore(); }
});
