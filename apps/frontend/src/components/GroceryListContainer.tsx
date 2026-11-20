import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db, type GroceryList, type Meal, type GroceryListState, type Store, type IngredientStore } from '../db/db';
import { useSetLastEditedGroceryListId } from '../hooks/useSetLastEditedGroceryListId';
import { List, ListItem, ListItemText, Checkbox, Typography, Button, Divider, Box, Dialog, DialogTitle, DialogContent, DialogActions, TextField, ToggleButtonGroup, ToggleButton } from '@mui/material';

import type { AggregatedIngredient, PartitionedIngredients } from '../types/grocery-list-types';
import { PartitionedGroceryList } from './PartitionedGroceryList';

const capitalize = (s: string) => s.replace(/\b\w/g, l => l.toUpperCase());



const aggregateAndPartitionIngredients = (
  groceryList: GroceryList,
  allMeals: Meal[] | undefined,
  allIngredientStores: IngredientStore[] | undefined,
  allStores: Store[] | undefined,
): PartitionedIngredients => {
  const ingredientsMap = new Map<string, { quantity: number, sources: string[] }>();

  if (allMeals) {
    groceryList.meals.forEach(mealId => {
      const meal = allMeals.find(m => m.id === mealId);
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
  }

  groceryList.customIngredients?.forEach(ing => {
    const lowerCaseName = ing.name.toLowerCase();
    const existing = ingredientsMap.get(lowerCaseName) || { quantity: 0, sources: [] };
    ingredientsMap.set(lowerCaseName, {
      quantity: existing.quantity + (ing.quantity ?? 1),
      sources: [...existing.sources, `Custom: ${ing.quantity ?? 1}`]
    });
  });

  const aggregatedIngredients = Array.from(ingredientsMap.entries()).map(([name, { quantity, sources }]) => ({ name, quantity, sources }));

  const byStore = new Map<number, { storeName: string; storeColor?: string; ingredients: AggregatedIngredient[] }>();
  const uncategorized: AggregatedIngredient[] = [];

  if (allIngredientStores && allStores) {
    aggregatedIngredients.forEach(ing => {
      const storeIds = allIngredientStores.filter(is => is.ingredientName === ing.name).map(is => is.storeId);
      if (storeIds.length > 0) {
        storeIds.forEach(storeId => {
          if (!byStore.has(storeId)) {
            const store = allStores.find(s => s.id === storeId);
            byStore.set(storeId, { storeName: store?.name || 'Unknown Store', storeColor: store?.color, ingredients: [] });
          }
          byStore.get(storeId)!.ingredients.push(ing);
        });
      } else {
        uncategorized.push(ing);
      }
    });
  } else {
    uncategorized.push(...aggregatedIngredients);
  }

  byStore.forEach(storeEntry => storeEntry.ingredients.sort((a, b) => a.name.localeCompare(b.name)));
  uncategorized.sort((a, b) => a.name.localeCompare(b.name));

  return { byStore, uncategorized };
};



export const GroceryListContainer: React.FC<{ groceryListId: number }> = ({ groceryListId }) => {
  const queryClient = useQueryClient();
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [partitionByStore, setPartitionByStore] = useState(false);
  const [expandedStoreAccordions, setExpandedStoreAccordions] = useState<Map<number, boolean>>(new Map());
  const setLastEditedListIdMutation = useSetLastEditedGroceryListId();

  const handlePartitionToggle = (
    _: React.MouseEvent<HTMLElement>,
    newValue: boolean | null,
  ) => {
    if (newValue !== null) {
      setPartitionByStore(newValue);
    }
  };

  const handleAccordionToggle = (storeId: number) => (event: React.SyntheticEvent) => {
    event.stopPropagation(); // Prevent AccordionSummary from expanding/collapsing
    setExpandedStoreAccordions(prev => {
      const newState = new Map(prev);
      newState.set(storeId, !newState.get(storeId));
      return newState;
    });
  };

  const { data: groceryList } = useQuery<GroceryList | undefined>({
    queryKey: ['groceryList', groceryListId],
    queryFn: () => db.groceryLists.get(groceryListId!),
    enabled: !!groceryListId,
  });

  const { data: meals } = useQuery<Meal[]>({
    queryKey: ['meals'],
    queryFn: () => db.meals.toArray(),
  });

  const { data: stores } = useQuery({ queryKey: ['stores'], queryFn: () => db.stores.orderBy('name').toArray() });
  const { data: ingredientStores } = useQuery({ queryKey: ['ingredientStores'], queryFn: () => db.ingredientStores.toArray() });

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

  const aggregatedIngredients = useMemo((): AggregatedIngredient[] | PartitionedIngredients | null => {
    if (!groceryList || !meals || !stores || !ingredientStores) return null;

    if (partitionByStore) {
      return aggregateAndPartitionIngredients(groceryList, meals, ingredientStores, stores);
    } else {
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

        if (aChecked && !bChecked) return 1;
        if (!aChecked && bChecked) return -1;

        if (a.name.toLowerCase() < b.name.toLowerCase()) return -1;
        if (a.name.toLowerCase() > b.name.toLowerCase()) return 1;

        return 0;
      });
    }
  }, [groceryList, meals, groceryListState, partitionByStore, stores, ingredientStores]);

  const totalIngredientsCount = useMemo(() => {
    if (!aggregatedIngredients) return 0;
    if (partitionByStore) {
      const partitioned = aggregatedIngredients as PartitionedIngredients;
      let count = 0;
      partitioned.byStore.forEach(entry => (count += entry.ingredients.length));
      count += partitioned.uncategorized.length;
      return count;
    } else {
      return (aggregatedIngredients as AggregatedIngredient[]).length;
    }
  }, [aggregatedIngredients, partitionByStore]);

  const handleToggle = (ingredientName: string) => {
    const checked = groceryListState?.checkedIngredients || [];
    const newChecked = checked.includes(ingredientName) ? checked.filter(i => i !== ingredientName) : [...checked, ingredientName];
    mutation.mutate(newChecked);
    setLastEditedListIdMutation.mutate(groceryListId);
    setSearchTerm('');
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

  if (!groceryList || !aggregatedIngredients) {
    return <Typography>Loading...</Typography>;
  }

  const checkedCount = groceryListState?.checkedIngredients?.length || 0;
  const uncheckedCount = totalIngredientsCount - checkedCount;
  const allItemsChecked = uncheckedCount === 0 && totalIngredientsCount > 0;
  const hasChanges = checkedCount > 0;

  const renderIngredientItem = (ing: AggregatedIngredient, showDivider: boolean) => {
    const isChecked = groceryListState?.checkedIngredients?.includes(ing.name) || false;
    return (
      <React.Fragment key={ing.name}>
        {showDivider && <Divider sx={{ my: 1 }} />}
        <ListItem>
          <Checkbox
            edge="start"
            checked={isChecked}
            tabIndex={-1}
            disableRipple
            onClick={() => handleToggle(ing.name)}
          />
          <ListItemText
            sx={{ margin: 0 }}
            primary={`${capitalize(ing.name)}: ${ing.quantity}`}
            secondary={ing.sources.join(', ')}
          />
        </ListItem>
      </React.Fragment>
    );
  };

  return (
    <div>
      <Typography variant="h4">{groceryList.name}</Typography>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <ToggleButtonGroup
          value={partitionByStore}
          exclusive
          onChange={handlePartitionToggle}
          aria-label="ingredient display mode"
        >
          <ToggleButton value={false} aria-label="all ingredients">
            All Ingredients
          </ToggleButton>
          <ToggleButton value={true} aria-label="partition by store">
            Partition by Store
          </ToggleButton>
        </ToggleButtonGroup>
        {hasChanges && <Button onClick={handleResetClick} variant="outlined">Reset</Button>}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <TextField
          label="Search Ingredients"
          variant="outlined"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          sx={{ flexGrow: 1, mr: 1 }}
        />
        <Button onClick={() => setSearchTerm('')} variant="outlined">Clear</Button>
      </Box>
      {allItemsChecked && (
        <Typography variant="h5" sx={{ textAlign: 'center', my: 4 }}>
          Congratulations! You've got all your groceries.
        </Typography>
      )}

      {partitionByStore ? (

        <PartitionedGroceryList

          partitionedIngredients={aggregatedIngredients as PartitionedIngredients}

          searchTerm={searchTerm}

          expandedStoreAccordions={expandedStoreAccordions}

          handleAccordionToggle={handleAccordionToggle}

          renderIngredientItem={renderIngredientItem}

        />

      ) : (

        <List>

          {(aggregatedIngredients as AggregatedIngredient[]).filter(ing => ing.name.toLowerCase().includes(searchTerm.toLowerCase())).map((ing, index) => {

            const isChecked = groceryListState?.checkedIngredients?.includes(ing.name) || false;

            const showDivider = isChecked && index === uncheckedCount;

            return renderIngredientItem(ing, showDivider);

          })}

        </List>

      )}

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
