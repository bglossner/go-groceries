import React, { useState, type ReactNode, useCallback } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, List, ListItem } from '@mui/material';
import { handleFileImport } from '../util/db/import';
import { useQueryClient } from '@tanstack/react-query';
import { type Meal } from '../db/db';
import { DiffsModalContext } from './DiffsModalContext';
import { saveSuccessfulSync } from '../util/sync-from';
import { useToast } from '../hooks/useToast';

export const DiffsModalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const [diffsModalOpen, setDiffsModalOpen] = useState(false);
  const [diffs, setDiffs] = useState<{ mealDiffs: { toAdd: Meal[], toRemove: Meal[] } } | null>(null);
  const [importBlob, setImportBlob] = useState<Blob | null>(null);
  const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);
  const { showSuccessToast, showErrorToast } = useToast();

  const openDiffsModal = useCallback((diffsData: { mealDiffs: { toAdd: Meal[], toRemove: Meal[] } }, blob: Blob, onConfirm: () => void) => {
    setDiffs(diffsData);
    setImportBlob(blob);
    setOnConfirm(() => onConfirm); // Store the callback
    setDiffsModalOpen(true);
  }, [setDiffs, setImportBlob, setOnConfirm, setDiffsModalOpen]);

  const closeDiffsModal = useCallback(() => {
    setDiffsModalOpen(false);
    setDiffs(null);
    setImportBlob(null);
    setOnConfirm(null);
  }, [setDiffs, setImportBlob, setOnConfirm, setDiffsModalOpen]);

  const handleConfirmImport = async () => {
    if (importBlob) {
      await handleFileImport(importBlob);
      await saveSuccessfulSync();
      queryClient.invalidateQueries({ queryKey: ['syncFrom'] });
      if (onConfirm) {
        onConfirm(); // Call the callback
      }
    }
    closeDiffsModal();
  };

  const handleCancelImport = () => {
    closeDiffsModal();
  };

  return (
    <DiffsModalContext.Provider value={{ openDiffsModal, closeDiffsModal, showSuccessToast, showErrorToast }}>
      {children}
      <Dialog open={diffsModalOpen} onClose={handleCancelImport}>
        <DialogTitle>Confirm Import with Changes</DialogTitle>
        <DialogContent>
          <Typography>
            The imported data contains the following changes to your meals:
          </Typography>
          {diffs && diffs.mealDiffs.toAdd.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="h6">Meals to be Added:</Typography>
              <List>
                {diffs.mealDiffs.toAdd.map((meal, index) => (
                  <ListItem key={index}>
                    <Typography>{meal.name}</Typography>
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
          {diffs && diffs.mealDiffs.toRemove.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="h6">Meals to be Removed:</Typography>
              <List>
                {diffs.mealDiffs.toRemove.map((meal, index) => (
                  <ListItem key={index}>
                    <Typography>{meal.name}</Typography>
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
          <Typography sx={{ mt: 2 }}>
            Are you sure you want to proceed with importing these changes?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelImport} color="error">Cancel</Button>
          <Button onClick={handleConfirmImport} autoFocus>Confirm Import</Button>
        </DialogActions>
      </Dialog>
    </DiffsModalContext.Provider>
  );
};
