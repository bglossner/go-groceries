import { createLazyFileRoute } from '@tanstack/react-router';
import { Typography, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, CircularProgress } from '@mui/material';
import React, { useState } from 'react';
import { db } from '../db/db';
import { useQueryClient } from '@tanstack/react-query';
import { exportDB, importDB } from 'dexie-export-import';

export const Route = createLazyFileRoute('/')({
  component: Index,
});

const exportBlobToFile = (filename: string, blob: Blob | File) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const handleExportNew = async () => {
  const exportedBlob = await exportDB(db);
  const file = new File([exportedBlob], `groceries_backupv2_${new Date().toISOString()}.json`, { type: 'application/json' });
  exportBlobToFile(file.name, file);
};

const deleteDbData = async () => {
  await db.transaction('rw', db.groceryLists, db.meals, db.groceryListStates, db.recipes, async () => {
    await Promise.all([
      db.groceryLists.clear(),
      db.meals.clear(),
      db.groceryListStates.clear(),
      db.recipes.clear(),
    ]);
  });

  await db.transaction('rw',db.tags, db.customIngredients, db.pendingRecipes, db.settings, async () => {
    await Promise.all([
      db.tags.clear(),
      db.customIngredients.clear(),
      db.pendingRecipes.clear(),
      db.settings.clear()
    ]);
  });
};

const handleImportNew = async (file: File): Promise<void> => {
  await deleteDbData();
  await importDB(file, {
    noTransaction: true,
  });
};

function Index() {
  const queryClient = useQueryClient();
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importStatus, setImportStatus] = useState<'idle' | 'loading' | 'success' | 'failure'>('idle');
  const [importError, setImportError] = useState<string | null>(null);

  const handleExport = async () => {
    await handleExportNew();
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportStatus('loading');
    setImportError(null);

    try {
      console.log('Doing new style import');
      await handleImportNew(file);

      setImportStatus('success');
      // Explicitly refetch all relevant queries
      await queryClient.refetchQueries({ queryKey: ['groceryLists'] });
      await queryClient.refetchQueries({ queryKey: ['meals'] });
      await queryClient.refetchQueries({ queryKey: ['groceryListStates'] });
      await queryClient.refetchQueries({ queryKey: ['recipes'] });
      await queryClient.refetchQueries({ queryKey: ['tags'] });
      await queryClient.refetchQueries({ queryKey: ['customIngredients'] });
      await queryClient.refetchQueries({ queryKey: ['pendingRecipes'] });
      await queryClient.refetchQueries({ queryKey: ['settings'] });

      setTimeout(() => {
        setImportModalOpen(false);
      }, 500);
    } catch (error: any) {
      setImportStatus('failure');
      setImportError(error.message || "Unknown error");
      return;
    }
  };

  return (
    <div>
      <Typography variant="h4" gutterBottom>
        Welcome to Go Groceries!
      </Typography>
      <Typography variant="body1">
        Use the navigation bar to manage your meals and grocery lists.
      </Typography>

      {/* Import Confirmation Modal */}
      <Dialog open={importModalOpen} onClose={() => { setImportModalOpen(false); setImportStatus('idle'); }}>
        <DialogTitle>Import Groceries</DialogTitle>
        <DialogContent>
          {importStatus === 'idle' && (
            <Typography>Are you sure? This will override your local DB.</Typography>
          )}
          {importStatus === 'loading' && (
            <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
              <CircularProgress />
            </Box>
          )}
          {importStatus === 'success' && (
            <Typography color="success">Import Succeeded!</Typography>
          )}
          {importStatus === 'failure' && (
            <Typography color="error">Import failed: {importError}</Typography>
          )}
        </DialogContent>
        <DialogActions>
          {importStatus === 'idle' && (
            <>
              <Button onClick={() => setImportModalOpen(false)}>No</Button>
              <Button
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '*/*';
                  input.onchange = (e) => handleImportFile(e as unknown as React.ChangeEvent<HTMLInputElement>);
                  input.click();
                }}
              >Yes</Button>
            </>
          )}
          {(importStatus === 'success' || importStatus === 'failure') && (
            <Button onClick={() => {
              setImportModalOpen(false);
              setImportStatus('idle');
            }}>Close</Button>
          )}
        </DialogActions>
      </Dialog>

      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center', gap: 2 }}>
        <Button
          variant="contained"
          onClick={() => setImportModalOpen(true)}
        >
          Import Groceries
        </Button>
        <Button
          variant="contained"
          onClick={handleExport}
        >
          Export Groceries
        </Button>
      </Box>
    </div>
  );
}
