import { Box } from '@mui/material';

export default function StoreColorDot({ color }: { color?: string }) {
  return (
    <Box
      component="span"
      aria-hidden="true"
      style={{ backgroundColor: color }}
      sx={{
        width: 12,
        height: 12,
        flexShrink: 0,
        borderRadius: '50%',
        border: '1px solid',
        borderColor: 'text.secondary',
        boxSizing: 'border-box',
      }}
    />
  );
}
