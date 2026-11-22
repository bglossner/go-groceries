import { IMAGE_LIMITS } from '@go-groceries/frontend/image-assets';
import type { ImageMimeType } from '@go-groceries/frontend/image-assets';
import { ErrorWrapper } from '../types';
import { readImageDimensions } from '../../../frontend/src/util/sync/image-container';

export function validateImage(bytes: Uint8Array, mimeType: ImageMimeType) {
  try {
    const { width, height } = readImageDimensions(bytes, mimeType);
    if (width <= IMAGE_LIMITS.dimension && height <= IMAGE_LIMITS.dimension && width * height <= IMAGE_LIMITS.pixels) return;
  } catch { /* Invalid container. */ }
  throw new ErrorWrapper({ message: 'Invalid image container or dimensions', statusCode: 400 });
}
