import React from 'react';
import { Dialog, DialogTitle, DialogContent, Button, Stack } from '@mui/material';

interface MealCreationTypeSelectionProps {
  open: boolean;
  onClose: () => void;
  onSelectType: (type: 'manual' | 'youtube' | 'images') => void;
}

const MealCreationTypeSelection: React.FC<MealCreationTypeSelectionProps> = ({ open, onClose, onSelectType }) => {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Choose Meal Creation Type</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Button variant="contained" onClick={() => onSelectType('manual')}>
            Manual Creation
          </Button>
          <Button variant="contained" onClick={() => onSelectType('youtube')}>
            From YouTube Video
          </Button>
          <Button variant="contained" onClick={() => onSelectType('images')}>
            From Images
          </Button>
        </Stack>
      </DialogContent>
    </Dialog>
  );
};

export default MealCreationTypeSelection;
