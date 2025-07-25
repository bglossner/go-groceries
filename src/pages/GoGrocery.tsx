import React, { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db, type GroceryList, type Meal, type GroceryListState } from '../db/db';
import { List, ListItem, ListItemText, Checkbox, Typography, Button, Divider, Box } from '@mui/material';
import { useSearch } from '@tanstack/react-router';
import { z } from 'zod';

const groceryListSearchSchema = z.object({
  groceryListId: z.number(),
});

const capitalize = (s: string) => s.replace(/\b\w/g, l => l.toUpperCase());

const GoGroceryPage: React.FC = () => {
  const queryClient = useQueryClient();
  const search = useSearch({ from: '/go-grocery' });

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
    },
  });

  const aggregatedIngredients = useMemo(() => {
    if (!groceryList || !meals) return [];
    const ingredientsMap = new Map<string, number>();
    groceryList.meals.forEach(mealId => {
      const meal = meals.find(m => m.id === mealId);
      if (meal) {
        meal.ingredients.forEach(ing => {
          const lowerCaseName = ing.name.toLowerCase();
          ingredientsMap.set(lowerCaseName, (ingredientsMap.get(lowerCaseName) || 0) + ing.quantity);
        });
      }
    });
    groceryList.customIngredients?.forEach(ing => {
      const lowerCaseName = ing.name.toLowerCase();
      ingredientsMap.set(lowerCaseName, (ingredientsMap.get(lowerCaseName) || 0) + ing.quantity);
    });
    const ingredients = Array.from(ingredientsMap.entries()).map(([name, quantity]) => ({ name, quantity }));
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

  const handleReset = () => {
    mutation.mutate([]);
  };

  if (!groceryList) {
    return <Typography>Loading...</Typography>;
  }

  const checkedCount = groceryListState?.checkedIngredients?.length || 0;
  const uncheckedCount = aggregatedIngredients.length - checkedCount;
  const allItemsChecked = uncheckedCount === 0 && aggregatedIngredients.length > 0;

  return (
    <div>
      <Typography variant="h4">{groceryList.name}</Typography>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button onClick={handleReset} variant="outlined">Reset</Button>
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
                <ListItemText primary={`${capitalize(ing.name)}: ${ing.quantity}`} />
              </ListItem>
            </React.Fragment>
          );
        })}
      </List>
    </div>
  );
};

export default GoGroceryPage;