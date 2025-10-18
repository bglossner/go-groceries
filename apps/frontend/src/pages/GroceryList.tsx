import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db, type GroceryList, type Meal, type Recipe, type Store, type IngredientStore } from '../db/db';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText, IconButton, Checkbox, TextField, Typography, Accordion, AccordionSummary, AccordionDetails, Box, ToggleButtonGroup, ToggleButton } from '@mui/material';
import { Edit, Delete, ExpandMore } from '@mui/icons-material';
import { useForm, Controller, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from '@tanstack/react-router';
import IngredientForm from '../components/IngredientForm';
import { ingredientSchema } from '../types/ingredients';
import EnlargedImage from '../components/EnlargedImage';

const groceryListFormSchema = z.object({
  name: z.string().optional().transform(name => name?.trim()),
  meals: z.array(z.number()).optional(),
  customIngredients: z.array(ingredientSchema).optional(),
});

type GroceryListForm = z.infer<typeof groceryListFormSchema>;

import { capitalize } from '../util/string';

const AggregatedIngredientsDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  ingredients: { name: string; quantity: number, sources: string[] }[];
  stores: Store[];
  ingredientStores: IngredientStore[];
}> = ({ open, onClose, ingredients, stores, ingredientStores }) => {
  const [storeFilter, setStoreFilter] = useState<number | 'all'>('all');

  const handleFilterChange = (
    _: React.MouseEvent<HTMLElement>,
    newFilter: number | 'all',
  ) => {
    if (newFilter !== null) {
      setStoreFilter(newFilter);
    }
  };

  const ingredientsByStore = useMemo(() => {
    const byStore = new Map<number, { name: string; quantity: number; sources: string[] }[]>();
    const uncategorized: { name: string; quantity: number; sources: string[] }[] = [];

    ingredients.forEach(ing => {
      const storeIds = ingredientStores.filter(is => is.ingredientName === ing.name).map(is => is.storeId);
      if (storeIds.length > 0) {
        storeIds.forEach(storeId => {
          if (!byStore.has(storeId)) byStore.set(storeId, []);
          byStore.get(storeId)!.push(ing);
        });
      } else {
        uncategorized.push(ing);
      }
    });

    byStore.forEach(ings => ings.sort((a, b) => a.name.localeCompare(b.name)));
    uncategorized.sort((a, b) => a.name.localeCompare(b.name));

    return { byStore, uncategorized };
  }, [ingredients, ingredientStores]);

  const filteredIngredients = useMemo(() => {
    if (storeFilter === 'all') {
      return { byStore: ingredientsByStore.byStore, uncategorized: ingredientsByStore.uncategorized };
    }
    const filteredByStore = new Map<number, { name: string; quantity: number; sources: string[] }[]>();
    if (ingredientsByStore.byStore.has(storeFilter)) {
      filteredByStore.set(storeFilter, ingredientsByStore.byStore.get(storeFilter)!);
    }
    return { byStore: filteredByStore, uncategorized: [] };
  }, [storeFilter, ingredientsByStore]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Aggregated Ingredients</DialogTitle>
      <DialogContent>
        <ToggleButtonGroup
          value={storeFilter}
          exclusive
          onChange={handleFilterChange}
          aria-label="store filter"
          sx={{ mb: 2 }}
        >
          <ToggleButton value="all" aria-label="all stores">
            All
          </ToggleButton>
          {stores.map(store => (
            store.id && <ToggleButton key={store.id} value={store.id} aria-label={store.name}>
              {store.name}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        {Array.from(filteredIngredients.byStore.entries()).map(([storeId, ings]) => {
          const store = stores.find(s => s.id === storeId);
          return (
            <Accordion key={storeId} defaultExpanded>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography>{store?.name || 'Unknown Store'}</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <List>
                  {ings.map((ing, index) => (
                    <ListItem key={index}>
                      <ListItemText
                        primary={`${capitalize(ing.name)}: ${ing.quantity}`}
                        secondary={ing.sources.join(', ')}
                      />
                    </ListItem>
                  ))}
                </List>
              </AccordionDetails>
            </Accordion>
          );
        })}

        {filteredIngredients.uncategorized.length > 0 && (
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Typography>Uncategorized</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <List>
                {filteredIngredients.uncategorized.map((ing, index) => (
                  <ListItem key={index}>
                    <ListItemText
                      primary={`${capitalize(ing.name)}: ${ing.quantity}`}
                      secondary={ing.sources.join(', ')}
                    />
                  </ListItem>
                ))}
              </List>
            </AccordionDetails>
          </Accordion>
        )}

      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

const GroceryListPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [selectedList, setSelectedList] = useState<GroceryList | null>(null);
  const [viewingAggregatedIngredients, setViewingAggregatedIngredients] = useState<{ name: string; quantity: number; sources: string[] }[] | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ id: number; name: string } | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [mealSearchTerm, setMealSearchTerm] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const { data: groceryLists } = useQuery({
    queryKey: ['groceryLists'],
    queryFn: () => db.groceryLists.orderBy('createdAt').reverse().toArray(),
  });

  const { data: meals } = useQuery<Meal[]>({
    queryKey: ['meals'],
    queryFn: async () => {
      const allMeals = await db.meals.toArray();
      allMeals.sort((a, b) => {
        if (a.name.toLowerCase() < b.name.toLowerCase()) return -1;
        if (a.name.toLowerCase() > b.name.toLowerCase()) return 1;
        return 0;
      });
      return allMeals;
    },
  });

  const { data: recipes } = useQuery<Recipe[]>({
    queryKey: ['recipes'],
    queryFn: () => db.recipes.toArray(),
  });

  const { data: customIngredients } = useQuery({
    queryKey: ['customIngredients'],
    queryFn: () => db.customIngredients.toArray(),
  });

  const { data: stores } = useQuery({ queryKey: ['stores'], queryFn: () => db.stores.orderBy('name').toArray() });
  const { data: ingredientStores } = useQuery({ queryKey: ['ingredientStores'], queryFn: () => db.ingredientStores.toArray() });

  const methods = useForm<GroceryListForm>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(groceryListFormSchema) as any,
    defaultValues: {
      name: '',
      meals: [],
      customIngredients: [{ name: '', quantity: undefined }],
    },
  });

  const { control, handleSubmit, reset, watch, formState: { isDirty } } = methods;

  const watchedMeals = watch("meals", []);
  const watchedCustomIngredients = watch("customIngredients");

  const mutation = useMutation({
    mutationFn: async (list: Partial<GroceryList>) => {
      const customIngredientsToSave = list.customIngredients?.filter(ing => ing.name && ing.name.trim() !== '') || [];

      const previousCustomIngredients = selectedList?.customIngredients || [];
      const previousIngredientNames = new Set(previousCustomIngredients.map(ing => ing.name!.toLowerCase()));
      const currentIngredientNames = new Set(customIngredientsToSave.map(ing => ing.name!.toLowerCase()));

      // Handle increments for newly added ingredients
      if (customIngredientsToSave.length > 0) {
        const existingIngredients = await db.customIngredients.toArray();
        const existingIngredientNames = new Set(existingIngredients.map(i => i.name.toLowerCase()));

        for (const newIng of customIngredientsToSave) {
          const lowerCaseName = newIng.name!.toLowerCase();
          if (!existingIngredientNames.has(lowerCaseName)) {
            // New custom ingredient, add to db with usageCount = 1
            await db.customIngredients.add({ name: lowerCaseName, usageCount: 1 });
          } else if (!previousIngredientNames.has(lowerCaseName)) {
            // Existing custom ingredient, but newly added to this grocery list
            const existing = await db.customIngredients.where('name').equalsIgnoreCase(lowerCaseName).first();
            if (existing) {
              await db.customIngredients.put({ ...existing, usageCount: (existing.usageCount || 0) + 1 });
            }
          }
        }
      }

      // Handle decrements for removed ingredients
      for (const oldIng of previousCustomIngredients) {
        const lowerCaseName = oldIng.name!.toLowerCase();
        if (!currentIngredientNames.has(lowerCaseName)) {
          // Ingredient was in the previous list but is not in the current list
          const existing = await db.customIngredients.where('name').equalsIgnoreCase(lowerCaseName).first();
          if (existing) {
            await db.customIngredients.put({ ...existing, usageCount: Math.max(0, (existing.usageCount || 0) - 1) });
          }
        }
      }

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
      queryClient.invalidateQueries({ queryKey: ['customIngredients'] });
      setFormOpen(false);
      setSelectedList(null);
      reset();
      setDiscardConfirmOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => db.groceryLists.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groceryLists'] });
      setDeleteConfirmOpen(false);
      setItemToDelete(null);
    },
  });

  const handleClickOpen = (list: GroceryList | null = null) => {
    setSelectedList(list);
    if (list) {
      reset({
        name: list.name || '',
        meals: list.meals || [],
        customIngredients: list.customIngredients?.map(ing => ({ name: ing.name, quantity: ing.quantity })) || [{ name: '', quantity: undefined }],
      });
    } else {
      reset({
        name: '',
        meals: [],
        customIngredients: [{ name: '', quantity: undefined }],
      });
    }
    setFormOpen(true);
  };

  const handleFormClose = (discardChanges = false) => {
    if (isDirty && !discardChanges) {
      setDiscardConfirmOpen(true);
    } else {
      setFormOpen(false);
      setSelectedList(null);
      reset();
      setDiscardConfirmOpen(false);
    }
  };

  const onSubmit = (data: GroceryListForm) => {
    const newList: Partial<GroceryList> = {
      name: data.name || new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
      meals: data.meals || [],
      customIngredients: data.customIngredients?.filter(ing => ing.name && ing.name.trim() !== '').map(ing => ({
        name: ing.name!.trim().toLowerCase(),
        quantity: ing.quantity == null ? 1 : Number(ing.quantity!),
      })) || [],
    };
    mutation.mutate(newList);
  };

  const handleViewAggregatedClick = (list: GroceryList) => {
    if (!meals) return;
    const ingredientsMap = new Map<string, { quantity: number, sources: string[] }>();
    list.meals.forEach(mealId => {
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
    list.customIngredients?.forEach(ing => {
      const lowerCaseName = ing.name.toLowerCase();
      const existing = ingredientsMap.get(lowerCaseName) || { quantity: 0, sources: [] };
      ingredientsMap.set(lowerCaseName, {
        quantity: existing.quantity + (ing.quantity ?? 1),
        sources: [...existing.sources, `Custom: ${ing.quantity ?? 1}`]
      });
    });
    const ingredients = Array.from(ingredientsMap.entries()).map(([name, { quantity, sources }]) => ({ name, quantity, sources }));
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
          ingredientsMap.set(lowerCaseName, (ingredientsMap.get(lowerCaseName) || 0) + (ing.quantity ?? 1));
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

  const handleDeleteClick = (id: number, name: string) => {
    setItemToDelete({ id, name });
    setDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = () => {
    if (itemToDelete) {
      deleteMutation.mutate(itemToDelete.id);
    }
  };

  const handleCancelDelete = () => {
    setDeleteConfirmOpen(false);
    setItemToDelete(null);
  };

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
                <IconButton onClick={() => handleDeleteClick(list.id!, list.name)}>
                  <Delete />
                </IconButton>
                <Link to="/go-grocery" search={{ groceryListId: list.id }}>
                  <Button>GO!</Button>
                </Link>
                <Button onClick={() => handleViewAggregatedClick(list)}>View Aggregated Ingredients</Button>
                <List>
                  {list.meals.map(mealId => {
                    const meal = meals?.find(m => m.id === mealId);
                    const thumbnail = meal?.images?.find(img => img.isThumbnail);
                    const recipe = recipes?.find(r => r.mealId === meal?.id);
                    let thumbnailUrl: string | null = null;
                    if (thumbnail && thumbnail.type === 'recipeImage' && recipe) {
                      const image = recipe.images[thumbnail.imageIndex];
                      if (typeof image === 'string') {
                        thumbnailUrl = image;
                      } else if (image instanceof File) {
                        thumbnailUrl = URL.createObjectURL(image);
                      }
                    }
                    return meal ? (
                      <ListItem key={mealId}>
                        {thumbnailUrl && (
                          <img
                            src={thumbnailUrl}
                            alt="thumbnail"
                            width="50"
                            style={{ marginRight: '10px', cursor: 'pointer' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedImage(thumbnailUrl);
                            }}
                          />
                        )}
                        <ListItemText primary={meal.name} />
                      </ListItem>
                    ) : null;
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

      <Dialog open={formOpen} onClose={(_event, reason) => {
        if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
          handleFormClose();
        }
      }} sx={{ '& .MuiDialog-paper': { minWidth: '33%' } }}>
        <DialogTitle>{selectedList ? 'Edit Grocery List' : 'Create New Grocery List'}</DialogTitle>
        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit)}>
            <DialogContent>
              <Controller
                name="name"
                control={control}
                render={({ field, formState: { errors } }) => (
                  <TextField
                    {...field}
                    autoFocus
                    margin="dense"
                    label="Grocery List Name"
                    type="text"
                    fullWidth
                    error={!!errors.name}
                    helperText={errors.name?.message}
                    onBlur={(e) => {
                      field.onChange(e.target.value.trim());
                      field.onBlur();
                    }}
                  />
                )}
              />
              <Typography variant="h6" sx={{ mt: 2 }}>Select Meals</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <TextField
                  label="Search Meals"
                  variant="outlined"
                  value={mealSearchTerm}
                  onChange={(e) => setMealSearchTerm(e.target.value)}
                  sx={{ flexGrow: 1, mr: 1 }}
                />
                <Button onClick={() => setMealSearchTerm('')} variant="outlined">Clear</Button>
              </Box>
              <Controller
                name="meals"
                control={control}
                render={({ field }) => (
                  <List>
                    {meals?.filter(meal => meal.name.toLowerCase().includes(mealSearchTerm.toLowerCase())).map(meal => {
                      const thumbnail = meal.images?.find(img => img.isThumbnail);
                      const recipe = recipes?.find(r => r.mealId === meal.id);
                      let thumbnailUrl: string | null = null;
                      if (thumbnail && thumbnail.type === 'recipeImage' && recipe) {
                        const image = recipe.images[thumbnail.imageIndex];
                        if (typeof image === 'string') {
                          thumbnailUrl = image;
                        } else if (image instanceof File) {
                          thumbnailUrl = URL.createObjectURL(image);
                        }
                      }

                      return (
                        <ListItem key={meal.id} dense component="div" onClick={() => {
                          const newMeals = field.value?.includes(meal.id!) ?
                            field.value.filter((id: number) => id !== meal.id!) :
                            [...(field.value || []), meal.id!];
                          field.onChange(newMeals);
                          setMealSearchTerm('');
                        }}>
                          <Checkbox
                            edge="start"
                            checked={field.value?.includes(meal.id!) || false}
                            tabIndex={-1}
                            disableRipple
                          />
                          {thumbnailUrl && (
                            <img
                              src={thumbnailUrl}
                              alt="thumbnail"
                              width="50"
                              style={{ marginRight: '10px', cursor: 'pointer' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedImage(thumbnailUrl);
                              }}
                            />
                          )}
                          <ListItemText primary={meal.name} />
                        </ListItem>
                      )
                    })}
                  </List>
                )}
              />
              <IngredientForm name="customIngredients" label="Custom Ingredients" customIngredients={customIngredients} enableAutocomplete />
              <Typography variant="subtitle1" sx={{ mt: 2 }}>
              Total Aggregated Ingredients: {formAggregatedIngredientsCount}
            </Typography>
          </DialogContent>
            <DialogActions>
              <Button onClick={() => handleFormClose()}>Cancel</Button>
              <Button type="submit">{selectedList ? 'Save' : 'Create'}</Button>
            </DialogActions>
          </form>
        </FormProvider>
      </Dialog>
      <AggregatedIngredientsDialog
        open={!!viewingAggregatedIngredients}
        onClose={() => setViewingAggregatedIngredients(null)}
        ingredients={viewingAggregatedIngredients || []}
        stores={stores || []}
        ingredientStores={ingredientStores || []}
      />

      <Dialog open={deleteConfirmOpen} onClose={handleCancelDelete}>
        <DialogTitle>Confirm Deletion</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete {itemToDelete?.name}?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelDelete}>Go Back</Button>
          <Button onClick={handleConfirmDelete} color="error">Delete</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={discardConfirmOpen} onClose={() => setDiscardConfirmOpen(false)}>
        <DialogTitle>Discard Changes?</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to discard any changes?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDiscardConfirmOpen(false)}>Cancel</Button>
          <Button onClick={() => handleFormClose(true)} color="error">Discard</Button>
        </DialogActions>
      </Dialog>

      <EnlargedImage open={!!selectedImage} onClose={() => setSelectedImage(null)} image={selectedImage} />

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
