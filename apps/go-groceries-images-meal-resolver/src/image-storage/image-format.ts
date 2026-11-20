import { IMAGE_LIMITS } from '@go-groceries/frontend/image-assets';
import type { ImageMimeType } from '@go-groceries/frontend/image-assets';
import { ErrorWrapper } from '../types';

/** Container signatures/dimensions, not a decoder or a transformation of the bytes. */
export function validateImage(bytes: Uint8Array, mimeType: ImageMimeType) {
  const invalid = () => { throw new ErrorWrapper({ message: 'Invalid image container or dimensions', statusCode: 400 }); };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, size: number) => String.fromCharCode(...bytes.subarray(start, start + size));
  let width = 0, height = 0;
  if (mimeType === 'image/png') {
    if (bytes.length < 45 || ascii(0, 8) !== '\x89PNG\r\n\x1a\n' || view.getUint32(8) !== 13 || ascii(12, 4) !== 'IHDR') invalid();
    width = view.getUint32(16); height = view.getUint32(20);
    const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
    if (!depths[bytes[25]]?.includes(bytes[24]) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] > 1) invalid();
    let offset = 8, hasData = false, ended = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      const kind = ascii(offset + 4, 4);
      if (offset + 12 + length > bytes.length) invalid();
      if (kind === 'IHDR' && offset !== 8) invalid();
      if (kind === 'IDAT' && length > 0) hasData = true;
      if (kind === 'IEND') { ended = length === 0 && offset + 12 === bytes.length; break; }
      offset += 12 + length;
    }
    if (!hasData || !ended) invalid();
  } else if (mimeType === 'image/jpeg') {
    if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) invalid();
    let offset = 2, scans = 0, frameMarker = 0, ended = false;
    const components = new Set<number>();
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) invalid();
      while (bytes[offset] === 0xff) offset++;
      if (offset >= bytes.length) invalid();
      const marker = bytes[offset++];
      if (marker === 0xd9) {
        if (!scans || offset !== bytes.length) invalid();
        ended = true;
        break;
      }
      if (marker === 0x01 || marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) invalid();
      if (offset + 2 > bytes.length) invalid();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) invalid();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (frameMarker || length < 8 || bytes[offset + 2] !== 8) invalid();
        const count = bytes[offset + 7];
        if (count < 1 || count > 4 || length !== 8 + count * 3) invalid();
        let blocks = 0;
        for (let index = 0; index < count; index++) {
          const start = offset + 8 + index * 3;
          const component = bytes[start], sampling = bytes[start + 1];
          const horizontal = sampling >> 4, vertical = sampling & 15;
          if (components.has(component) || horizontal < 1 || horizontal > 4 || vertical < 1 || vertical > 4 || bytes[start + 2] > 3) invalid();
          components.add(component);
          blocks += horizontal * vertical;
        }
        if (blocks > 10) invalid();
        frameMarker = marker;
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5);
      } else if (marker === 0xda) {
        if (!frameMarker || length < 8) invalid();
        const count = bytes[offset + 2];
        if (count < 1 || count > components.size || length !== 6 + count * 2) invalid();
        const scanComponents = new Set<number>();
        for (let index = 0; index < count; index++) {
          const component = bytes[offset + 3 + index * 2], tables = bytes[offset + 4 + index * 2];
          if (!components.has(component) || scanComponents.has(component) || (tables >> 4) > 3 || (tables & 15) > 3) invalid();
          scanComponents.add(component);
        }
        const spectralStart = bytes[offset + length - 3], spectralEnd = bytes[offset + length - 2];
        const approximation = bytes[offset + length - 1], high = approximation >> 4, low = approximation & 15;
        if (frameMarker !== 0xc2) {
          if (spectralStart !== 0 || spectralEnd !== 63 || approximation !== 0) invalid();
        } else if (spectralStart > spectralEnd || spectralEnd > 63 || (spectralStart === 0 && spectralEnd !== 0) ||
          (spectralStart > 0 && count !== 1) || high > 13 || low > 13 || (high !== 0 && high !== low + 1)) invalid();
        offset += length;
        let hasEntropy = false;
        while (offset < bytes.length) {
          if (bytes[offset] !== 0xff) { hasEntropy = true; offset++; continue; }
          if (bytes[offset + 1] === 0) { hasEntropy = true; offset += 2; continue; }
          if (bytes[offset + 1] >= 0xd0 && bytes[offset + 1] <= 0xd7) { offset += 2; continue; }
          if (bytes[offset + 1] === 0xff) { offset++; continue; }
          break;
        }
        if (!hasEntropy || offset >= bytes.length) invalid();
        scans++;
        continue;
      } else if (![0xc4, 0xdb, 0xdd, 0xfe, ...Array.from({ length: 16 }, (_, index) => 0xe0 + index)].includes(marker)) invalid();
      offset += length;
    }
    if (!frameMarker || !scans || !ended) invalid();
  } else {
    if (bytes.length < 30 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length) invalid();
    let offset = 12, hasData = false, canvasWidth = 0, canvasHeight = 0;
    while (offset + 8 <= bytes.length) {
      const chunk = ascii(offset, 4);
      const length = view.getUint32(offset + 4, true);
      const start = offset + 8;
      const end = start + length + length % 2;
      if (end > bytes.length) invalid();
      if (chunk === 'VP8X') {
        if (offset !== 12 || length !== 10 || (bytes[start] & 0xc3) || bytes[start + 1] || bytes[start + 2] || bytes[start + 3]) invalid();
        canvasWidth = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16);
        canvasHeight = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16);
      } else if (chunk === 'VP8L') {
        if (hasData || length < 6 || bytes[start] !== 0x2f || (bytes[start + 4] & 0xe0)) invalid();
        width = 1 + bytes[start + 1] + ((bytes[start + 2] & 0x3f) << 8);
        height = 1 + (bytes[start + 2] >> 6) + (bytes[start + 3] << 2) + ((bytes[start + 4] & 0xf) << 10);
        hasData = true;
      } else if (chunk === 'VP8 ') {
        if (hasData || length < 11 || (bytes[start] & 1) || ascii(start + 3, 3) !== '\x9d\x01\x2a') invalid();
        width = view.getUint16(start + 6, true) & 0x3fff;
        height = view.getUint16(start + 8, true) & 0x3fff;
        hasData = true;
      } else if (!['ALPH', 'ICCP', 'EXIF', 'XMP '].includes(chunk)) invalid();
      offset = end;
    }
    // Static WebP only: validating an animation's individual frames needs a decoder.
    if (!hasData || offset !== bytes.length || (canvasWidth && (canvasWidth !== width || canvasHeight !== height))) invalid();
  }
  if (width < 1 || height < 1 || width > IMAGE_LIMITS.dimension || height > IMAGE_LIMITS.dimension || width * height > IMAGE_LIMITS.pixels) invalid();
}
