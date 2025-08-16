import imageCompression from "browser-image-compression";
import { z } from "zod";
import { type MealRecipeImage } from "../shareable/meals";
import type { Recipe } from "../db/db";

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

const base64ToFile = (base64: string, filename: string = 'image', mimeType?: string): File => {
  const arr = base64.split(',');
  const mime = mimeType || arr[0].match(/:(.*?);/)?.[1];
  const bstr = atob(arr[arr.length - 1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
};

export const mapMealRecipeImagesToRecipeImages = (mealRecipeImages: MealRecipeImage[] | undefined): Recipe['images'] => {
  if (!mealRecipeImages) return [];
  return mealRecipeImages.map(img => {
    if (img.type === 'url') {
      return img.url;
    } else if (img.type === 'file') {
      return img.file;
    } else if (img.type === 'blob') {
      return new File([img.blob], `meal-recipe-image-${crypto.randomUUID()}.png`, { type: img.blob.type });
    } else if (img.type === 'base64') {
      // Assuming base64 is a data URL, otherwise a proper filename/mimeType would be needed
      return base64ToFile(img.base64, `meal-recipe-image-${crypto.randomUUID()}.png`);
    }
    return ''; // Should not happen due to discriminated union
  }).filter((img): img is File | string => !!img); // Filter out any empty strings from fallback
};
