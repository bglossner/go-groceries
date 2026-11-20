import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, type RecipeImage } from '../db/db';
import { isAssetRef } from '../db/image-cache';

export const useImageUrl = (image: RecipeImage | null | undefined): string | undefined => {
  const [resolved, setResolved] = useState<{ image: typeof image; url?: string }>();
  const assetId = isAssetRef(image) ? image.assetId : undefined;
  useEffect(() => {
    let currentUrl: string | undefined;
    const release = () => { if (currentUrl) URL.revokeObjectURL(currentUrl); currentUrl = undefined; };
    const display = (blob: Blob | undefined) => {
      release();
      currentUrl = blob ? URL.createObjectURL(blob) : undefined;
      setResolved({ image, url: currentUrl });
    };
    if (assetId) {
      const subscription = liveQuery(() => db.imageAssets.get(assetId)).subscribe({
        next: asset => display(asset?.blob), error: () => display(undefined),
      });
      return () => { subscription.unsubscribe(); release(); };
    }
    if (image instanceof Blob) display(image);
    else setResolved({ image, url: typeof image === 'string' ? image : undefined });
    return release;
  }, [image, assetId]);
  return resolved && resolved.image === image ? resolved.url : undefined;
};
