import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography } from '@mui/material';

interface FromImagesMealCreationProps {
  open: boolean;
  onClose: () => void;
}

const FromImagesMealCreation: React.FC<FromImagesMealCreationProps> = ({ open, onClose }) => {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Create Meal From Images</DialogTitle>
      <DialogContent>
        <Typography>From Images</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default FromImagesMealCreation;
