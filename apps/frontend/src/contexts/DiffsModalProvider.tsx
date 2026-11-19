import React, { useState, type ReactNode, useCallback } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, List, ListItem } from '@mui/material';
import { importSyncFile } from '../util/sync-from';
import { useQueryClient } from '@tanstack/react-query';
import { type Meal } from '../db/db';
import { DiffsModalContext } from './DiffsModalContext';
import { useToast } from '../hooks/useToast';

export const DiffsModalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const [diffsModalOpen, setDiffsModalOpen] = useState(false);
  const [diffs, setDiffs] = useState<{ mealDiffs: { toAdd: Meal[], toRemove: Meal[] } } | null>(null);
  const [importBlob, setImportBlob] = useState<Blob | null>(null);
  const [importing, setImporting] = useState(false);
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
    if (!importBlob || importing) return;
    setImporting(true);
    try {
      const message = await importSyncFile(importBlob);
      await queryClient.invalidateQueries();
      onConfirm?.();
      showSuccessToast(message);
      closeDiffsModal();
    } catch (error) { showErrorToast(error instanceof Error ? error.message : 'Import failed; retry sync.'); }
    finally { setImporting(false); }
  };

  const handleCancelImport = () => {
    if (!importing) closeDiffsModal();
  };

  return (
    <DiffsModalContext.Provider value={{ openDiffsModal, closeDiffsModal, showSuccessToast, showErrorToast }}>
      {children}
      <Dialog open={diffsModalOpen} onClose={handleCancelImport}>
        <DialogTitle>Confirm Import with Changes</DialogTitle>
        <DialogContent>
          <Typography>
            Import replaces local meals, recipes, lists and other metadata, including image-only changes.
            Any unsynced local edits will be replaced. The following meal names changed:
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
          <Button onClick={handleCancelImport} disabled={importing} color="error">Cancel</Button>
          <Button onClick={handleConfirmImport} disabled={importing} autoFocus>Confirm Import</Button>
        </DialogActions>
      </Dialog>
    </DiffsModalContext.Provider>
  );
};
