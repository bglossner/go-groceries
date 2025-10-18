import { createLazyFileRoute } from '@tanstack/react-router';
import { Typography, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, CircularProgress } from '@mui/material';
import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { exportBlobToFile, getExportBlob } from '../util/db/export';
import { handleFileImport } from '../util/db/import';

export const Route = createLazyFileRoute('/')({
  component: Index,
});

const handleExportNew = async () => {
  const exportedBlob = await getExportBlob();
  const file = new File([exportedBlob], `groceries_backupv2_${new Date().toISOString()}.json`, { type: 'application/json' });
  exportBlobToFile(file.name, file);
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
      await handleFileImport(file);

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
      await queryClient.refetchQueries({ queryKey: ['stores'] });
      await queryClient.refetchQueries({ queryKey: ['ingredientStores'] });

      setTimeout(() => {
        setImportModalOpen(false);
      }, 500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
