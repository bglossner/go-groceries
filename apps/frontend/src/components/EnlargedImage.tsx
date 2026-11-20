import React from 'react';
import { Dialog, DialogContent } from '@mui/material';
import type { RecipeImage } from '../db/db';
import StoredImage from './StoredImage';

interface EnlargedImageProps {
  open: boolean;
  onClose: () => void;
  image: RecipeImage | null;
}

const EnlargedImage: React.FC<EnlargedImageProps> = ({ open, onClose, image }) => {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogContent>
        {image && <StoredImage image={open ? image : null} alt="Enlarged Recipe" style={{ width: '100%', height: 'auto' }} />}
      </DialogContent>
    </Dialog>
  );
};

export default EnlargedImage;
