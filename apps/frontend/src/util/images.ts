import imageCompression from "browser-image-compression";
import { z } from "zod";

export const imageUrlResolver = z.url().refine(async (url) => {
  return await verifyImageUrl(url);
}, { error: 'Invalid image URL' });

const verifyImageUrl = (url: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);    // Image loaded successfully
    img.onerror = () => resolve(false);  // Image failed to load
    img.src = url;
  });
}

export const IMAGE_OPTIONS = {
  maxSizeMB: 1,
  maxWidthOrHeight: 1920,
  useWebWorker: true,
} as const satisfies Parameters<typeof imageCompression>[1];

export const convertFilesToImageBlobs = async (files: File[], imageOptions = IMAGE_OPTIONS): Promise<File[]> => {
  return await Promise.all(files.map(async (file) => {
    const blob = await imageCompression(file, imageOptions);
    return new File([blob], file.name, { type: blob.type, lastModified: blob.lastModified || Date.now() });
  }));
}
