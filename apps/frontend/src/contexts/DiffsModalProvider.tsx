import React, { useState, type ReactNode, useCallback } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, List, ListItem, Snackbar, Alert } from '@mui/material';
import { handleFileImport } from '../util/db/import';
import { useQueryClient } from '@tanstack/react-query';
import { type Meal } from '../db/db';
import { DiffsModalContext } from './DiffsModalContext';
import { saveSuccessfulSync } from '../util/sync-from';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error';
}

export const DiffsModalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const [diffsModalOpen, setDiffsModalOpen] = useState(false);
  const [diffs, setDiffs] = useState<{ mealDiffs: { toAdd: Meal[], toRemove: Meal[] } } | null>(null);
  const [importBlob, setImportBlob] = useState<Blob | null>(null);
  const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);

  const TOAST_DURATION = 5000; // milliseconds

  const [toastMessages, setToastMessages] = useState<Toast[]>([]);

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

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToastMessages((prev) => [...prev, { id: Math.random().toString(36).substring(7), message, type }]);
  }, [setToastMessages]);

  const showSuccessToast = useCallback((message: string) => showToast(message, 'success'), [showToast]);
  const showErrorToast = useCallback((message: string) => showToast(message, 'error'), [showToast]);

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
      {toastMessages.map((toast, index) => (
        <Snackbar
          key={toast.id}
          open={true}
          autoHideDuration={TOAST_DURATION}
          onClose={() => setToastMessages((prev) => prev.filter((t) => t.id !== toast.id))}
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
          sx={{ top: `${8 + index * 60}px !important` }}
        >
          <Alert onClose={() => setToastMessages((prev) => prev.filter((t) => t.id !== toast.id))} severity={toast.type} sx={{ width: '100%' }}>
            {toast.message}
          </Alert>
        </Snackbar>
      ))}
    </DiffsModalContext.Provider>
  );
};
