import React, { useState } from 'react';
import { Typography, Box, IconButton, Button, Dialog, DialogTitle, DialogContent, DialogActions, List, ListItem, ListItemText } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { db, type CustomIngredient } from '../db/db';

interface RecalcResult {
  changedCounts: { name: string; oldCount: number; newCount: number }[];
  deletedIngredients: { name: string; oldCount: number }[];
  newIngredients: { name: string; newCount: number }[];
}

const SettingsPage: React.FC = () => {
  const [recalcModalOpen, setRecalcModalOpen] = useState(false);
  const [recalcResult, setRecalcResult] = useState<RecalcResult | null>(null);

  const handleRecalc = async () => {
    const allGroceryLists = await db.groceryLists.toArray();
    const existingCustomIngredients = await db.customIngredients.toArray();

    const aggregatedCounts = new Map<string, number>();
    allGroceryLists.forEach(list => {
      list.customIngredients?.forEach(ing => {
        const lowerCaseName = ing.name!.toLowerCase();
        aggregatedCounts.set(lowerCaseName, (aggregatedCounts.get(lowerCaseName) || 0) + 1);
      });
    });

    const changedCounts: { name: string; oldCount: number; newCount: number }[] = [];
    const deletedIngredients: { name: string; oldCount: number }[] = [];
    const newIngredients: { name: string; newCount: number }[] = [];

    // Check for changed counts and deleted ingredients
    existingCustomIngredients.forEach(existingIng => {
      const lowerCaseName = existingIng.name.toLowerCase();
      const newCount = aggregatedCounts.get(lowerCaseName) || 0;

      if (newCount === 0) {
        deletedIngredients.push({ name: existingIng.name, oldCount: existingIng.usageCount || 0 });
      } else if ((existingIng.usageCount || 0) !== newCount) {
        changedCounts.push({ name: existingIng.name, oldCount: existingIng.usageCount || 0, newCount: newCount });
      }
    });

    // Check for new ingredients
    aggregatedCounts.forEach((newCount, name) => {
      if (!existingCustomIngredients.some(ing => ing.name.toLowerCase() === name)) {
        newIngredients.push({ name: name, newCount: newCount });
      }
    });

    setRecalcResult({ changedCounts, deletedIngredients, newIngredients });
    setRecalcModalOpen(true);
  };

  const handleRecalcContinue = async () => {
    if (!recalcResult) return;

    const existingCustomIngredients = await db.customIngredients.toArray();
    const ingredientsToPut: CustomIngredient[] = [];

    const changedOrNewNames = new Set<string>();
    recalcResult.changedCounts.forEach(item => {
      ingredientsToPut.push({ name: item.name.toLowerCase(), usageCount: item.newCount });
      changedOrNewNames.add(item.name.toLowerCase());
    });
    recalcResult.newIngredients.forEach(item => {
      ingredientsToPut.push({ name: item.name.toLowerCase(), usageCount: item.newCount });
      changedOrNewNames.add(item.name.toLowerCase());
    });

    existingCustomIngredients.forEach(existingIng => {
      const lowerCaseName = existingIng.name.toLowerCase();
      if (!changedOrNewNames.has(lowerCaseName) &&
          !recalcResult.deletedIngredients.some(delIng => delIng.name.toLowerCase() === lowerCaseName)) {
        ingredientsToPut.push(existingIng);
      }
    });

    await db.transaction('rw', db.customIngredients, async () => {
      await db.customIngredients.clear();
      if (ingredientsToPut.length > 0) {
        await db.customIngredients.bulkAdd(ingredientsToPut);
      }
    });

    setRecalcModalOpen(false);
    setRecalcResult(null);
  };

  const handleRecalcDiscard = () => {
    setRecalcModalOpen(false);
    setRecalcResult(null);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <IconButton onClick={() => window.history.back()}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h4" component="h1" gutterBottom sx={{ flexGrow: 1, textAlign: 'center' }}>
          Settings
        </Typography>
        <Box sx={{ width: 48 }} /> {/* Spacer to balance the IconButton */}
      </Box>

      <Box sx={{ mt: 4 }}>
        <Typography variant="h5" component="h2" gutterBottom>
          Database Update Options
        </Typography>
        <Button variant="contained" onClick={handleRecalc}>
          Recalc Custom Ingredients and Usage
        </Button>
      </Box>

      <Dialog open={recalcModalOpen} onClose={handleRecalcDiscard}>
        <DialogTitle>Recalculation Results</DialogTitle>
        <DialogContent>
          {recalcResult && (
            <>
              {recalcResult.changedCounts.length > 0 && (
                <>
                  <Typography variant="h6">Changed Usage Counts:</Typography>
                  <List>
                    {recalcResult.changedCounts.map((item, index) => (
                      <ListItem key={index}>
                        <ListItemText primary={`${item.name}: ${item.oldCount} -> ${item.newCount}`} />
                      </ListItem>
                    ))}
                  </List>
                </>
              )}

              {recalcResult.deletedIngredients.length > 0 && (
                <>
                  <Typography variant="h6">Deleted Custom Ingredients:</Typography>
                  <List>
                    {recalcResult.deletedIngredients.map((item, index) => (
                      <ListItem key={index}>
                        <ListItemText primary={`${item.name} (Usage: ${item.oldCount})`} />
                      </ListItem>
                    ))}
                  </List>
                </>
              )}

              {recalcResult.newIngredients.length > 0 && (
                <>
                  <Typography variant="h6">New Custom Ingredients:</Typography>
                  <List>
                    {recalcResult.newIngredients.map((item, index) => (
                      <ListItem key={index}>
                        <ListItemText primary={`${item.name} (Usage: ${item.newCount})`} />
                      </ListItem>
                    ))}
                  </List>
                </>
              )}

              {recalcResult.changedCounts.length === 0 &&
               recalcResult.deletedIngredients.length === 0 &&
               recalcResult.newIngredients.length === 0 && (
                <Typography>No changes detected.</Typography>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleRecalcDiscard}>Discard</Button>
          <Button onClick={handleRecalcContinue} autoFocus>Continue</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SettingsPage;