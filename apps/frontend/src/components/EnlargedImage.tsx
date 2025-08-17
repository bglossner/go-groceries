import React from 'react';
import { Dialog, DialogContent } from '@mui/material';

interface EnlargedImageProps {
  open: boolean;
  onClose: () => void;
  image: string | null;
}

const EnlargedImage: React.FC<EnlargedImageProps> = ({ open, onClose, image }) => {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogContent>
        {image && <img src={image} alt="Enlarged Recipe" style={{ width: '100%', height: 'auto' }} />}
      </DialogContent>
    </Dialog>
  );
};

export default EnlargedImage;
