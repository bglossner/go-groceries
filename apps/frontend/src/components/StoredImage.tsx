import { useState, type CSSProperties, type MouseEvent } from 'react';
import { Box, Typography } from '@mui/material';
import type { RecipeImage } from '../db/db';
import { useImageUrl } from '../hooks/useImageUrl';

export default function StoredImage({ image, alt, width, style, onClick }: {
  image: RecipeImage | null | undefined; alt: string; width?: string;
  style?: CSSProperties; onClick?: (event: MouseEvent) => void;
}) {
  const url = useImageUrl(image);
  const [failedUrl, setFailedUrl] = useState<string>();
  if (!url || failedUrl === url) return <Box sx={{ width: width ?? '100%', p: 1 }}>
    <Typography variant="caption">Image unavailable offline</Typography>
  </Box>;
  return <img src={url} alt={alt} width={width} style={style} onClick={onClick} onError={() => setFailedUrl(url)} />;
}
