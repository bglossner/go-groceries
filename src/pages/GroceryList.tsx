import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db, type GroceryList, type Meal, ingredientSchema } from '../db/db';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText, IconButton, Checkbox, TextField, Typography, Accordion, AccordionSummary, AccordionDetails, Box } from '@mui/material';
import { Edit, Delete, ExpandMore } from '@mui/icons-material';
import { useForm, Controller, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from '@tanstack/react-router';
import IngredientForm from '../components/IngredientForm';

const groceryListFormSchema = z.object({
  name: z.string().optional(),
  meals: z.array(z.number()).optional(),
  customIngredients: z.array(ingredientSchema).optional(),
});

type GroceryListForm = z.infer<typeof groceryListFormSchema>;

const capitalize = (s: string) => s.replace(/\b\w/g, l => l.toUpperCase());

const AggregatedIngredientsDialog: React.FC<{ open: boolean; onClose: () => void; ingredients: { name: string; quantity: number }[] }> = ({ open, onClose, ingredients }) => (
  <Dialog open={open} onClose={onClose}>
    <DialogTitle>Aggregated Ingredients</DialogTitle>
    <DialogContent>
      <List>
        {ingredients.map((ing, index) => (
          <ListItem key={index}>
            <ListItemText primary={`${capitalize(ing.name)}: ${ing.quantity}`} />
          </ListItem>
        ))}
      </List>
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>Close</Button>
    </DialogActions>
  </Dialog>
);

const GroceryListPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [selectedList, setSelectedList] = useState<GroceryList | null>(null);
  const [viewingAggregatedIngredients, setViewingAggregatedIngredients] = useState<{ name: string; quantity: number }[] | null>(null);
  

  const { data: groceryLists } = useQuery({
    queryKey: ['groceryLists'],
    queryFn: () => db.groceryLists.orderBy('createdAt').reverse().toArray(),
  });

  const { data: meals } = useQuery<Meal[]>({
    queryKey: ['meals'],
    queryFn: () => db.meals.toArray(),
  });

  const methods = useForm<GroceryListForm>({
    resolver: zodResolver(groceryListFormSchema),
    defaultValues: {
      name: '',
      meals: [],
      customIngredients: [{ name: '', quantity: 1 }],
    },
  });

  const { control, handleSubmit, reset, watch } = methods;

  const watchedMeals = watch("meals", []);
  const watchedCustomIngredients = watch("customIngredients");

  const mutation = useMutation({
    mutationFn: async (list: Partial<GroceryList>) => {
      if (selectedList) {
        return db.groceryLists.put({ ...selectedList, ...list });
      } else {
        return db.groceryLists.add({
          name: list.name || new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
          meals: list.meals || [],
          customIngredients: list.customIngredients || [],
          createdAt: new Date(),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groceryLists'] });
      handleFormClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => db.groceryLists.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groceryLists'] });
    },
  });

  const handleClickOpen = (list: GroceryList | null = null) => {
    setSelectedList(list);
    if (list) {
      reset({
        name: list.name || '',
        meals: list.meals || [],
        customIngredients: list.customIngredients?.map(ing => ({ name: ing.name, quantity: ing.quantity })) || [{ name: '', quantity: 1 }],
      });
    } else {
      reset({
        name: '',
        meals: [],
        customIngredients: [{ name: '', quantity: 1 }],
      });
    }
    setFormOpen(true);
  };

  const handleFormClose = () => {
    setFormOpen(false);
    setSelectedList(null);
    reset();
  };

  const onSubmit = (data: GroceryListForm) => {
    const newList: Partial<GroceryList> = {
      name: data.name || new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
      meals: data.meals || [],
      customIngredients: data.customIngredients?.filter(ing => ing.name && ing.name.trim() !== '' && ing.quantity && ing.quantity > 0).map(ing => ({
        name: ing.name!.trim().toLowerCase(),
        quantity: Number(ing.quantity!),
      })) || [],
    };
    mutation.mutate(newList);
  };

  const handleViewAggregatedClick = (list: GroceryList) => {
    if (!meals) return;
    const ingredientsMap = new Map<string, number>();
    list.meals.forEach(mealId => {
      const meal = meals.find(m => m.id === mealId);
      if (meal) {
        meal.ingredients.forEach(ing => {
          const lowerCaseName = ing.name.toLowerCase();
          ingredientsMap.set(lowerCaseName, (ingredientsMap.get(lowerCaseName) || 0) + ing.quantity);
        });
      }
    });
    list.customIngredients?.forEach(ing => {
      const lowerCaseName = ing.name.toLowerCase();
      ingredientsMap.set(lowerCaseName, (ingredientsMap.get(lowerCaseName) || 0) + ing.quantity);
    });
    const ingredients = Array.from(ingredientsMap.entries()).map(([name, quantity]) => ({ name, quantity }));
    setViewingAggregatedIngredients(ingredients);
  };

  const formAggregatedIngredientsCount = useMemo(() => {
    if (!meals || !watchedMeals) return 0;
    const ingredientsMap = new Map<string, number>();
    watchedMeals.forEach(mealId => {
      const meal = meals.find(m => m.id === mealId);
      if (meal) {
        meal.ingredients.forEach(ing => {
          const lowerCaseName = ing.name.toLowerCase();
          ingredientsMap.set(lowerCaseName, (ingredientsMap.get(lowerCaseName) || 0) + ing.quantity);
        });
      }
    });
    watchedCustomIngredients?.forEach(ing => {
      if (ing.name && ing.name.trim() !== '' && ing.quantity && ing.quantity > 0) {
        const lowerCaseName = ing.name.toLowerCase();
        ingredientsMap.set(lowerCaseName, (ingredientsMap.get(lowerCaseName) || 0) + ing.quantity);
      }
    });
    return Array.from(ingredientsMap.values()).reduce((acc, curr) => acc + curr, 0);
  }, [watchedMeals, meals, watchedCustomIngredients]);

  

  return (
    <div>
      <List>
        {groceryLists?.map((list) => (
          <Accordion key={list.id}>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <ListItemText primary={list.name} secondary={new Date(list.createdAt).toLocaleString()} />
            </AccordionSummary>
            <AccordionDetails>
              <Box>
                <IconButton onClick={() => handleClickOpen(list)}>
                  <Edit />
                </IconButton>
                <IconButton onClick={() => deleteMutation.mutate(list.id!)}>
                  <Delete />
                </IconButton>
                <Link to="/go-grocery" search={{ groceryListId: list.id }}>
                  <Button>GO!</Button>
                </Link>
                <Button onClick={() => handleViewAggregatedClick(list)}>View Aggregated Ingredients</Button>
                <List>
                  {list.meals.map(mealId => {
                    const meal = meals?.find(m => m.id === mealId);
                    return meal ? <ListItem key={mealId}><ListItemText primary={meal.name} /></ListItem> : null;
                  })}
                  {list.customIngredients?.map((ing, index) => (
                    <ListItem key={`custom-${index}`}><ListItemText primary={`${capitalize(ing.name)}: ${ing.quantity}`} /></ListItem>
                  ))}
                </List>
              </Box>
            </AccordionDetails>
          </Accordion>
        ))}
      </List>

      <Dialog open={formOpen} onClose={handleFormClose}>
        <DialogTitle>{selectedList ? 'Edit Grocery List' : 'Create New Grocery List'}</DialogTitle>
        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit)}>
            <DialogContent>
              <Controller
                name="name"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    autoFocus
                    margin="dense"
                    label="Grocery List Name"
                    type="text"
                    fullWidth
                  />
                )}
              />
              <Typography variant="h6" sx={{ mt: 2 }}>Select Meals</Typography>
              <Controller
                name="meals"
                control={control}
                render={({ field }) => (
                  <List>
                    {meals?.map(meal => (
                      <ListItem key={meal.id} dense component="div" onClick={() => {
                        const newMeals = field.value?.includes(meal.id!) ?
                          field.value.filter((id: number) => id !== meal.id!) :
                          [...(field.value || []), meal.id!];
                        field.onChange(newMeals);
                      }}>
                        <Checkbox
                          edge="start"
                          checked={field.value?.includes(meal.id!) || false}
                          tabIndex={-1}
                          disableRipple
                        />
                        <ListItemText primary={meal.name} />
                      </ListItem>
                    ))}
                  </List>
                )}
              />
              <IngredientForm name="customIngredients" label="Custom Ingredients" />
              <Typography variant="subtitle1" sx={{ mt: 2 }}>
              Total Aggregated Ingredients: {formAggregatedIngredientsCount}
            </Typography>
          </DialogContent>
            <DialogActions>
              <Button onClick={handleFormClose}>Cancel</Button>
              <Button type="submit">{selectedList ? 'Save' : 'Create'}</Button>
            </DialogActions>
          </form>
        </FormProvider>
      </Dialog>
      <AggregatedIngredientsDialog open={!!viewingAggregatedIngredients} onClose={() => setViewingAggregatedIngredients(null)} ingredients={viewingAggregatedIngredients || []} />

      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'right' }}>
        <Button
          variant="contained"
          onClick={() => handleClickOpen()}
        >
          Create New Grocery List
        </Button>
      </Box>
    </div>
  );
};

export default GroceryListPage;