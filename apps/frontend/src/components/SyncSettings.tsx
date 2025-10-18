import React, { useState, useEffect } from 'react';
import { Typography, Box, Button, CircularProgress, Checkbox, FormControlLabel, TextField, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db, type Sync } from '../db/db';
import { saveSyncFromLocation, syncFromDb } from '../util/sync-from';
import { getPresignedUrlExpirationInfo } from '../util/file/s3-presigned';
import { handleFileImport } from '../util/db/import';
import { useDiffsModal } from '../hooks/useDiffsModal';
import { useSyncTo } from '../hooks/useSyncTo';

export const SyncSettings: React.FC = () => {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [automaticSync, setAutomaticSync] = useState(false);
  const { openDiffsModal, showErrorToast, showSuccessToast } = useDiffsModal();
  const { existingSyncTo, syncToMutation } = useSyncTo();

  const [syncFromUrlInput, setSyncFromUrlInput] = useState('');
  const [syncFromAliasInput, setSyncFromAliasInput] = useState('');
  const [isUpdatingSyncFrom, setIsUpdatingSyncFrom] = useState(false);

  const { data: existingSyncFrom } = useQuery<Sync | null>({
    queryKey: ['syncFrom'],
    queryFn: async () => await db.syncs.where('type').equals('from').first() ?? null,
  });

  useEffect(() => {
    if (existingSyncFrom && syncFromUrlInput) {
      let currentFilename: string | null = null;
      try {
        currentFilename = getPresignedUrlExpirationInfo(syncFromUrlInput).filename;
      } catch {
        // Ignore error, filename will remain null
      }

      const aliasMatches = existingSyncFrom.alias === syncFromAliasInput;
      const filenameMatches = existingSyncFrom.filename === currentFilename;

      setIsUpdatingSyncFrom(aliasMatches || filenameMatches);
    } else {
      setIsUpdatingSyncFrom(false);
    }
  }, [syncFromAliasInput, syncFromUrlInput, existingSyncFrom]);

  useEffect(() => {
    if (existingSyncFrom?.url) {
      setSyncFromUrlInput(existingSyncFrom.url);
      setSyncFromAliasInput(existingSyncFrom.alias || '');
    }
  }, [existingSyncFrom]);

  const saveSyncFromMutation = useMutation({
    mutationFn: async (data: { url: string, alias?: string }) => {
      await saveSyncFromLocation(data.url, data.alias);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syncFrom'] });
      showSuccessToast('Sync From location saved!'); // Handled by useSyncTo
    },
    onError: (error: unknown) => {
      showErrorToast(`Error saving sync from location: ${(error as Error).message}`);
    },
  });

  const syncFromDbMutation = useMutation({
    mutationFn: async () => {
      const { blob, diffsResult } = await syncFromDb(); // syncFromDb now returns blob and diffsResult

      if (diffsResult.mealDiffs.toAdd.length > 0 || diffsResult.mealDiffs.toRemove.length > 0) {
        openDiffsModal(diffsResult, blob, () => { showSuccessToast('Sync from successful!') }); // Use context to open modal
      } else {
        await handleFileImport(blob);
        if (existingSyncFrom && existingSyncFrom.id) {
          await db.syncs.update(existingSyncFrom.id, { lastSyncedAt: new Date() });
        }
        queryClient.invalidateQueries({ queryKey: ['syncFrom'] });
        showSuccessToast('Sync from successful!'); // Handled by useSyncTo
      }
    },
    onSuccess: () => {
      // Handled within mutationFn based on diffs
    },
    onError: (error: unknown) => {
      showErrorToast(`Error syncing from DB: ${(error as Error).message}`);
    },
  });

  useEffect(() => {
    if (existingSyncTo) {
      setAutomaticSync(existingSyncTo.automatic || false);
    }
  }, [existingSyncTo]);

  const updateAutomaticSyncMutation = useMutation({
    mutationFn: async (newAutomaticValue: boolean) => {
      if (existingSyncTo && existingSyncTo.id) {
        await db.syncs.update(existingSyncTo.id, { automatic: newAutomaticValue });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syncTo'] });
    },
  });

  const handleAutomaticSyncChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.checked;
    setAutomaticSync(newValue);
    updateAutomaticSyncMutation.mutate(newValue);
  };

  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false);

  const handleConfirmSyncTo = async () => {
    setSyncConfirmOpen(false);
    setSyncing(true);
    try {
      await syncToMutation.mutateAsync({ automatic: false });
    } finally {
      setSyncing(false);
    }
  };

  const handleCancelSyncTo = () => {
    setSyncConfirmOpen(false);
  };

  const handleSyncTo = () => {
    setSyncConfirmOpen(true);
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await syncToMutation.mutateAsync({ automatic: automaticSync });
    } finally {
      setSyncing(false);
    }
  };

  const handleShare = () => {
    if (existingSyncTo?.url) {
      if (navigator.share) {
        navigator.share({
          title: 'Groceries Backup',
          text: 'Here is your groceries backup file.',
          url: existingSyncTo.url,
        });
      } else {
        navigator.clipboard.writeText(existingSyncTo.url);
        showSuccessToast('URL copied to clipboard!');
      }
    }
  };

  const updateSyncFromAutomaticMutation = useMutation({
    mutationFn: async (newAutomaticValue: boolean) => {
      if (existingSyncFrom && existingSyncFrom.id) {
        await db.syncs.update(existingSyncFrom.id, { automatic: newAutomaticValue });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syncFrom'] });
    },
  });

  const handleSyncFromAutomaticChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.checked;
    updateSyncFromAutomaticMutation.mutate(newValue);
  };

  const handleTurnOffSyncFrom = () => {
    updateSyncFromAutomaticMutation.mutate(false);
  };

  return (
    <Box sx={{ mt: 4, mb: 2 }}>
      <Typography variant="h5" component="h2" gutterBottom>
        Syncing
      </Typography>
      <Typography variant="h6" component="h3" gutterBottom>
        Sync To
      </Typography>

      {!existingSyncTo && (
        <Button variant="contained" onClick={handleSyncTo} disabled={syncing}>
          Sync To Cloud
        </Button>
      )}

      {existingSyncTo && (
        <>
          <Button variant="contained" onClick={handleSyncNow} disabled={syncing}>
            Sync Now
          </Button>
          <FormControlLabel
            control={
              <Checkbox
                checked={automaticSync}
                onChange={handleAutomaticSyncChange}
              />
            }
            label="Set up automatic syncs"
          />
        </>
      )}

      {syncing && <CircularProgress size={24} sx={{ ml: 2 }} />}

      {existingSyncTo?.url && (
        <Box sx={{ mt: 2 }}>
          <Typography color="success">Sync location is set up!</Typography>
          <Button variant="contained" onClick={handleShare} sx={{ mt: 1 }}>
            Share URL
          </Button>
        </Box>
      )}

      <Typography variant="h6" component="h3" gutterBottom sx={{ mt: 2 }}>
        Sync From
      </Typography>

      <Box sx={{ mt: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <TextField
            label="Alias (Optional)"
            variant="outlined"
            value={syncFromAliasInput}
            onChange={(e) => setSyncFromAliasInput(e.target.value)}
            sx={{ flexGrow: 1 }}
          />
          <TextField
            label="Sync From URL"
            variant="outlined"
            value={syncFromUrlInput}
            onChange={(e) => setSyncFromUrlInput(e.target.value)}
            sx={{ flexGrow: 1, maxWidth: '50%' }}
          />
        </Box>
        <Button
          variant="contained"
          onClick={() => saveSyncFromMutation.mutate({ url: syncFromUrlInput, alias: syncFromAliasInput })}
          disabled={saveSyncFromMutation.isPending}
        >
          {isUpdatingSyncFrom ? 'Update Sync Location' : 'Save New Sync Location'}
        </Button>
        {saveSyncFromMutation.isPending && <CircularProgress size={24} sx={{ ml: 2 }} />}
        {existingSyncFrom && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2">
              Last synced from: {existingSyncFrom.lastSyncedAt?.toLocaleString()}
              {existingSyncFrom.alias && ` (Alias: ${existingSyncFrom.alias})`}
            </Typography>
            <Button
              variant="contained"
              onClick={() => syncFromDbMutation.mutate()}
              disabled={syncFromDbMutation.isPending}
              sx={{ mt: 1 }}
            >
              Sync DB
            </Button>
            {syncFromDbMutation.isPending && <CircularProgress size={24} sx={{ ml: 2 }} />}

            <FormControlLabel
              control={
                <Checkbox
                  checked={existingSyncFrom.automatic || false}
                  onChange={handleSyncFromAutomaticChange}
                />
              }
              label="Enable Automatic Sync"
              sx={{ mt: 1 }}
            />
            {existingSyncFrom.automatic && (
              <Button
                variant="outlined"
                color="error"
                onClick={handleTurnOffSyncFrom}
                sx={{ mt: 1, ml: 2 }}
              >
                Turn off sync
              </Button>
            )}
          </Box>
        )}
      </Box>

      <Dialog open={syncConfirmOpen} onClose={handleCancelSyncTo}>
        <DialogTitle>Confirm Sync to Cloud</DialogTitle>
        <DialogContent>
          <Typography>
            Syncing makes all your meals available to anyone you share a link with.
            Are you sure you'd like to sync?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelSyncTo} color="error">Cancel</Button>
          <Button onClick={handleConfirmSyncTo} autoFocus>Confirm</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
