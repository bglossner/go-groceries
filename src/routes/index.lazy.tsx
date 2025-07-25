import { createLazyFileRoute } from '@tanstack/react-router';
import { Typography, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, CircularProgress } from '@mui/material';
import React, { useState } from 'react';
import { db } from '../db/db';
import { useQueryClient } from '@tanstack/react-query';

export const Route = createLazyFileRoute('/')({
  component: Index,
});

function Index() {
  const queryClient = useQueryClient();
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importStatus, setImportStatus] = useState<'idle' | 'loading' | 'success' | 'failure'>('idle');
  const [importError, setImportError] = useState<string | null>(null);

  const handleExport = async () => {
    try {
      const allGroceryLists = await db.groceryLists.toArray();
      const allMeals = await db.meals.toArray();
      const allGroceryListStates = await db.groceryListStates.toArray();

      const data = {
        groceryLists: allGroceryLists,
        meals: allMeals,
        groceryListStates: allGroceryListStates,
      };

      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `groceries_backup_${new Date().toISOString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error exporting data:", error);
      alert("Failed to export data. Check console for details.");
    }
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportStatus('loading');
    setImportError(null);

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const importedData = JSON.parse(e.target?.result as string);

          await db.transaction('rw', db.groceryLists, db.meals, db.groceryListStates, async () => {
            await Promise.all([
              db.groceryLists.clear(),
              db.meals.clear(),
              db.groceryListStates.clear(),
            ]);

            await Promise.all([
              db.groceryLists.bulkAdd(importedData.groceryLists),
              db.meals.bulkAdd(importedData.meals),
              db.groceryListStates.bulkAdd(importedData.groceryListStates),
            ]);
          });

          setImportStatus('success');
          // Explicitly refetch all relevant queries
          await queryClient.refetchQueries({ queryKey: ['groceryLists'] });
          await queryClient.refetchQueries({ queryKey: ['meals'] });
          await queryClient.refetchQueries({ queryKey: ['groceryListStates'] });

          setTimeout(() => {
            setImportModalOpen(false);
          }, 500);
        } catch (innerError: any) {
          console.error("Error importing data:", innerError);
          setImportStatus('failure');
          setImportError(innerError.message || "Unknown error");
        }
      };
      reader.readAsText(file);
    } catch (outerError: any) {
      console.error("Error reading file:", outerError);
      setImportStatus('failure');
      setImportError(outerError.message || "Unknown error");
    }
  };

  return (
    <div>
      <Typography variant="h4" gutterBottom>
        Welcome to Groceries Helper!
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
                  input.accept = 'application/json';
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