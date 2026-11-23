type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';
type Dimensions = { width: number; height: number };

function ascii(bytes: Uint8Array, start: number, size: number) {
  return String.fromCharCode(...bytes.subarray(start, start + size));
}

export function sniffImageType(bytes: Uint8Array): ImageMimeType | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  const header = ascii(bytes, 0, 12);
  if (header.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png';
  if (header.startsWith('RIFF') && header.slice(8) === 'WEBP') return 'image/webp';
}

function invalid(): never {
  throw new Error('Invalid image container');
}

function readJpegDimensions(bytes: Uint8Array, view: DataView) {
  let offset = 2; // Skip SOI.
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) invalid();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    // Stop before entropy-coded data or the end of the primary JPEG.
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0 || offset + 2 > bytes.length) invalid();
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) invalid();
    // C4 is DHT, C8 is JPG, and CC is DAC. The other C0–CF markers are SOFn.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length < 8) invalid();
      const components = bytes[offset + 7];
      if (!components || length < 8 + 3 * components) invalid();
      return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
    }
    offset += length;
  }
  return invalid();
}

function readPngDimensions(bytes: Uint8Array, view: DataView) {
  // Signature, chunk header, 13-byte IHDR payload and CRC.
  if (bytes.length < 33 || view.getUint32(8) !== 13 || ascii(bytes, 12, 4) !== 'IHDR') invalid();
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function uint24LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
}

function* webpDimensionChunks(bytes: Uint8Array, view: DataView, offset: number, limit: number) {
  while (offset + 8 <= limit) {
    const kind = ascii(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    if (kind === 'VP8X' || kind === 'VP8L' || kind === 'VP8 ' || kind === 'ANMF') {
      if (end > limit) invalid();
      yield { kind, start, end, length };
    }
    offset = end + length % 2;
  }
}

function readWebpBitstreamDimensions(bytes: Uint8Array, view: DataView, { kind, start, length }: { kind: string; start: number; length: number }) {
  if (kind === 'VP8L') {
    if (length < 5 || bytes[start] !== 0x2f) invalid();
    const dimensions = view.getUint32(start + 1, true);
    return { width: 1 + (dimensions & 0x3fff), height: 1 + ((dimensions >>> 14) & 0x3fff) };
  }
  if (kind === 'VP8 ') {
    if (length < 10 || (bytes[start] & 1) || ascii(bytes, start + 3, 3) !== '\x9d\x01\x2a') invalid();
    const width = view.getUint16(start + 6, true) & 0x3fff;
    const height = view.getUint16(start + 8, true) & 0x3fff;
    if (width < 1 || height < 1) invalid();
    return { width, height };
  }
}

function checkWebpFrame(bytes: Uint8Array, view: DataView, start: number, end: number, canvas: Dimensions) {
  if (end - start < 16) invalid();
  const maxWidth = canvas.width - 2 * uint24LE(bytes, start);
  const maxHeight = canvas.height - 2 * uint24LE(bytes, start + 3);
  if (1 + uint24LE(bytes, start + 6) > maxWidth || 1 + uint24LE(bytes, start + 9) > maxHeight) invalid();
  // Bound the coded frame as well as its declared rectangle before browser allocation.
  let hasBitstream = false;
  for (const chunk of webpDimensionChunks(bytes, view, start + 16, end)) {
    const frame = readWebpBitstreamDimensions(bytes, view, chunk);
    if (!frame) continue;
    if (frame.width > maxWidth || frame.height > maxHeight) invalid();
    hasBitstream = true;
  }
  if (!hasBitstream) invalid();
}

function readWebpDimensions(bytes: Uint8Array, view: DataView) {
  let canvas: Dimensions | undefined;
  let animated = false;
  let hasFrame = false;
  for (const chunk of webpDimensionChunks(bytes, view, 12, bytes.length)) {
    const { kind, start, end, length } = chunk;
    if (kind === 'VP8X') {
      if (length < 10 || canvas) invalid();
      canvas = { width: 1 + uint24LE(bytes, start + 4), height: 1 + uint24LE(bytes, start + 7) };
      animated = Boolean(bytes[start] & 0x02);
    } else if (kind === 'ANMF') {
      if (!canvas || !animated) invalid();
      checkWebpFrame(bytes, view, start, end, canvas);
      hasFrame = true;
    } else {
      const frame = readWebpBitstreamDimensions(bytes, view, chunk)!;
      if (canvas && (frame.width !== canvas.width || frame.height !== canvas.height)) invalid();
      if (animated) invalid();
      return frame;
    }
  }
  if (!canvas || !hasFrame) invalid();
  return canvas;
}

/** Read encoded dimensions before callers apply their size limits and decode. */
export function readImageDimensions(bytes: Uint8Array, mimeType: ImageMimeType | undefined) {
  if (!mimeType || sniffImageType(bytes) !== mimeType) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { width, height } = mimeType === 'image/jpeg' ? readJpegDimensions(bytes, view)
    : mimeType === 'image/png' ? readPngDimensions(bytes, view) : readWebpDimensions(bytes, view);
  if (width < 1 || height < 1) invalid();
  return { width, height };
}
