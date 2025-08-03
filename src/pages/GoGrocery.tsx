import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db, type GroceryList, type Meal, type GroceryListState } from '../db/db';
import { List, ListItem, ListItemText, Checkbox, Typography, Button, Divider, Box, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import { useSearch } from '@tanstack/react-router';
import { z } from 'zod';

const groceryListSearchSchema = z.object({
  groceryListId: z.number(),
});

const capitalize = (s: string) => s.replace(/\b\w/g, l => l.toUpperCase());

const GoGroceryPage: React.FC = () => {
  const queryClient = useQueryClient();
  const search = useSearch({ from: '/go-grocery' });
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const validatedSearch = groceryListSearchSchema.safeParse(search);

  if (!validatedSearch.success) {
    return <Typography>Invalid grocery list ID</Typography>;
  }

  const { groceryListId } = validatedSearch.data;

  const { data: groceryList } = useQuery<GroceryList | undefined>({
    queryKey: ['groceryList', groceryListId],
    queryFn: () => db.groceryLists.get(groceryListId!),
    enabled: !!groceryListId,
  });

  const { data: meals } = useQuery<Meal[]> ({
    queryKey: ['meals'],
    queryFn: () => db.meals.toArray(),
  });

  const { data: groceryListState } = useQuery<GroceryListState | undefined>({
    queryKey: ['groceryListState', groceryListId],
    queryFn: () => db.groceryListStates.where('groceryListId').equals(groceryListId).first(),
  });

  const mutation = useMutation({
    mutationFn: async (checkedIngredients: string[]) => {
      const currentState = await db.groceryListStates.where('groceryListId').equals(groceryListId).first();
      if (currentState) {
        return db.groceryListStates.put({ ...currentState, checkedIngredients });
      } else {
        return db.groceryListStates.add({
          groceryListId,
          checkedIngredients,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groceryListState', groceryListId] });
      setResetConfirmOpen(false);
    },
  });

  const aggregatedIngredients = useMemo(() => {
    if (!groceryList || !meals) return [];
    const ingredientsMap = new Map<string, { quantity: number, sources: string[] }>();
    groceryList.meals.forEach(mealId => {
      const meal = meals.find(m => m.id === mealId);
      if (meal) {
        meal.ingredients.forEach(ing => {
          const lowerCaseName = ing.name.toLowerCase();
          const existing = ingredientsMap.get(lowerCaseName) || { quantity: 0, sources: [] };
          ingredientsMap.set(lowerCaseName, {
            quantity: existing.quantity + (ing.quantity ?? 1),
            sources: [...existing.sources, `${meal.name}: ${ing.quantity ?? 1}`]
          });
        });
      }
    });
    groceryList.customIngredients?.forEach(ing => {
      const lowerCaseName = ing.name.toLowerCase();
      const existing = ingredientsMap.get(lowerCaseName) || { quantity: 0, sources: [] };
      ingredientsMap.set(lowerCaseName, {
        quantity: existing.quantity + (ing.quantity ?? 1),
        sources: [...existing.sources, `Custom: ${ing.quantity ?? 1}`]
      });
    });
    const ingredients = Array.from(ingredientsMap.entries()).map(([name, { quantity, sources }]) => ({ name, quantity, sources }));
    const checked = groceryListState?.checkedIngredients || [];
    return ingredients.sort((a, b) => {
      const aChecked = checked.includes(a.name);
      const bChecked = checked.includes(b.name);
      if (aChecked === bChecked) return 0;
      return aChecked ? 1 : -1;
    });
  }, [groceryList, meals, groceryListState]);

  const handleToggle = (ingredientName: string) => {
    const checked = groceryListState?.checkedIngredients || [];
    const newChecked = checked.includes(ingredientName) ? checked.filter(i => i !== ingredientName) : [...checked, ingredientName];
    mutation.mutate(newChecked);
  };

  const handleResetClick = () => {
    setResetConfirmOpen(true);
  };

  const handleConfirmReset = () => {
    mutation.mutate([]);
  };

  const handleCancelReset = () => {
    setResetConfirmOpen(false);
  };

  if (!groceryList) {
    return <Typography>Loading...</Typography>;
  }

  const checkedCount = groceryListState?.checkedIngredients?.length || 0;
  const uncheckedCount = aggregatedIngredients.length - checkedCount;
  const allItemsChecked = uncheckedCount === 0 && aggregatedIngredients.length > 0;
  const hasChanges = checkedCount > 0;

  return (
    <div>
      <Typography variant="h4">{groceryList.name}</Typography>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        {hasChanges && <Button onClick={handleResetClick} variant="outlined">Reset</Button>}
      </Box>
      {allItemsChecked && (
        <Typography variant="h5" sx={{ textAlign: 'center', my: 4 }}>
          Congratulations! You've got all your groceries.
        </Typography>
      )}
      <List>
        {aggregatedIngredients.map((ing, index) => {
          const isChecked = groceryListState?.checkedIngredients?.includes(ing.name) || false;
          const showDivider = isChecked && index === uncheckedCount;
          return (
            <React.Fragment key={index}>
              {showDivider && <Divider sx={{ my: 1 }} />}
              <ListItem onClick={() => handleToggle(ing.name)}>
                <Checkbox
                  edge="start"
                  checked={isChecked}
                  tabIndex={-1}
                  disableRipple
                />
                <ListItemText
                  sx={{ margin: 0 }}
                  primary={`${capitalize(ing.name)}: ${ing.quantity}`}
                  secondary={ing.sources.join(', ')}
                />
              </ListItem>
            </React.Fragment>
          );
        })}
      </List>

      <Dialog open={resetConfirmOpen} onClose={handleCancelReset}>
        <DialogTitle>Discard Changes?</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to discard any changes?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelReset}>Cancel</Button>
          <Button onClick={handleConfirmReset} color="error">Discard</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
};

export default GoGroceryPage;