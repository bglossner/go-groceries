import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db, type Meal, ingredientSchema } from '../db/db';
import { Button, TextField, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText, IconButton, Box, Accordion, AccordionSummary, AccordionDetails, Typography } from '@mui/material';
import { useNavigate } from '@tanstack/react-router';
import { Edit, Delete, ExpandMore, Restaurant } from '@mui/icons-material';
import { useForm, Controller, FormProvider, type ResolverOptions, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import IngredientForm from '../components/IngredientForm';

const mealFormSchema = z.object({
  name: z.string().min(1, 'Meal name is required').transform(name => name.trim()),
  ingredients: z.array(ingredientSchema).transform((ingredients) => {
    return ingredients.filter(ing => ing.name && ing.name.trim() !== '');
  }).refine((ingredients) => ingredients.length > 0, 'Must have at least 1 ingredient')
});

type MealForm = z.infer<typeof mealFormSchema>;

const capitalize = (s: string) => s.replace(/\b\w/g, l => l.toUpperCase());

const sessionStartTime = new Date();

const Meals: React.FC = () => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedMeal, setSelectedMeal] = useState<Meal | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ id: number; name: string } | null>(null);
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');

  const { data: meals } = useQuery({
    queryKey: ['meals'],
    queryFn: async () => {
      const allMeals = await db.meals.toArray();
      const mappedWithDate = allMeals.map(meal => ({
        ...meal,
        updatedAt: new Date(meal.updatedAt || meal.createdAt || new Date()),
      }));
      mappedWithDate.sort((a, b) => {
        const aIsNew = a.createdAt >= sessionStartTime;
        const bIsNew = b.createdAt >= sessionStartTime;

        if (aIsNew && !bIsNew) return -1;
        if (!aIsNew && bIsNew) return 1;

        if (aIsNew && bIsNew) {
          return b.createdAt.getTime() - a.createdAt.getTime();
        }

        if (a.name.toLowerCase() < b.name.toLowerCase()) return -1;
        if (a.name.toLowerCase() > b.name.toLowerCase()) return 1;

        return 0;
      });
      return mappedWithDate;
    },
  });

  const methods = useForm<MealForm>({
    resolver: (values, ctx, options) => {
      const resolver = zodResolver(mealFormSchema) as Resolver<MealForm>;
      const resolveValues = resolver(values as MealForm, ctx, options as ResolverOptions<MealForm>);
      return resolveValues;
    },
    defaultValues: {
      name: '',
      ingredients: [{ name: '', quantity: undefined }],
    },
  });

  const { control, handleSubmit, reset, formState: { errors, isDirty } } = methods;
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: async (meal: Meal) => {
      if (meal.id) {
        return db.meals.put(meal);
      } else {
        return db.meals.add(meal);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meals'] });
      setOpen(false);
      setSelectedMeal(null);
      reset();
      setDiscardConfirmOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => db.meals.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meals'] });
      setDeleteConfirmOpen(false);
      setItemToDelete(null);
    },
  });

  const handleClickOpen = (meal: Meal | null = null) => {
    setSelectedMeal(meal);
    if (meal) {
      reset({
        name: meal.name,
        ingredients: meal.ingredients.map(ing => ({ name: ing.name, quantity: ing.quantity }))
      });
    } else {
      reset({
        name: '',
        ingredients: [{ name: '', quantity: undefined }],
      });
    }
    setOpen(true);
  };

  const handleClose = (event?: object, reason?: "backdropClick" | "escapeKeyDown", discardChanges = false) => {
    if (!discardChanges && isDirty && (reason === "backdropClick" || reason === "escapeKeyDown")) {
      setDiscardConfirmOpen(true);
    } else if (!discardChanges && isDirty && event === undefined) { // This handles the case where handleClose is called without event/reason, e.g., from the Cancel button
      setDiscardConfirmOpen(true);
    } else {
      setOpen(false);
      setSelectedMeal(null);
      reset();
      setDiscardConfirmOpen(false);
    }
  };

  const handleDiscardChanges = () => {
    handleClose(undefined, undefined, true);
  };

  const handleCancelDiscard = () => {
    setDiscardConfirmOpen(false);
  };

  const onSubmit = (data: MealForm) => {
    const now = new Date();
    const mealPayload: Meal = {
      id: selectedMeal?.id,
      name: data.name.trim(),
      ingredients: data.ingredients?.filter(ing => ing.name && ing.name.trim() !== '').map(ing => ({
        name: ing.name!.trim().toLowerCase(),
        quantity: ing.quantity == null ? 1 : Number(ing.quantity!),
      })) || [],
      createdAt: selectedMeal?.createdAt || now,
      updatedAt: now,
    };
    mutation.mutate(mealPayload);
  };

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
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <TextField
          label="Search Meals"
          variant="outlined"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          sx={{ flexGrow: 1, mr: 1 }}
        />
        <Button onClick={() => setSearchTerm('')} variant="outlined">Clear</Button>
      </Box>
      <List>
        {meals?.filter(meal => meal.name.toLowerCase().includes(searchTerm.toLowerCase())).map((meal) => (
          <Accordion key={meal.id}>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <ListItemText
                primary={meal.name}
                secondary={`Created: ${meal.createdAt ? new Date(meal.createdAt).toLocaleString() : 'N/A'} - Updated: ${meal.updatedAt ? new Date(meal.updatedAt).toLocaleString() : 'N/A'
                  }`}
              />
            </AccordionSummary>
            <AccordionDetails>
              <Box>
                <IconButton onClick={() => handleClickOpen(meal)}>
                  <Edit />
                </IconButton>
                <IconButton onClick={() => handleDeleteClick(meal.id!, meal.name)}>
                  <Delete />
                </IconButton>
                <IconButton onClick={() => meal.id && navigate({ to: '/recipe/$mealId', params: { mealId: meal.id.toString() } })}>
                  <Restaurant />
                </IconButton>
                <Typography variant="h6" sx={{ mt: 2 }}>Ingredients:</Typography>
                <List>
                  {meal.ingredients.map((ing, index) => (
                    <ListItem key={index}>
                      <ListItemText primary={`${capitalize(ing.name)}: ${ing.quantity}`} />
                    </ListItem>
                  ))}
                </List>
              </Box>
            </AccordionDetails>
          </Accordion>
        ))}
      </List>

      <Dialog open={open} onClose={handleClose}>
        <DialogTitle>{selectedMeal ? 'Edit Meal' : 'Create New Meal'}</DialogTitle>
        <FormProvider {...methods}>
          <form onSubmit={(...args) => { return handleSubmit(onSubmit)(...args);  }}>
            <DialogContent>
              <Controller
                name="name"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    autoFocus
                    margin="dense"
                    label="Meal Name"
                    type="text"
                    fullWidth
                    error={!!errors.name}
                    helperText={errors.name?.message}
                    onBlur={(e) => {
                      field.onChange(e.target.value.trim());
                      field.onBlur();
                    }}
                    required
                  />
                )}
              />
              <IngredientForm name="ingredients" label="Ingredients" />
            </DialogContent>
            <DialogActions>
              <Button onClick={handleClose}>Cancel</Button>
              <Button type="submit">{selectedMeal ? 'Save' : 'Create'}</Button>
            </DialogActions>
          </form>
        </FormProvider>
      </Dialog>

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

      <Dialog open={discardConfirmOpen} onClose={handleCancelDiscard}>
        <DialogTitle>Discard Changes?</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to discard any changes?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelDiscard}>Cancel</Button>
          <Button onClick={handleDiscardChanges} color="error">Discard</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={discardConfirmOpen} onClose={handleCancelDiscard}>
        <DialogTitle>Discard Changes?</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to discard any changes?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelDiscard}>Cancel</Button>
          <Button onClick={handleDiscardChanges} color="error">Discard</Button>
        </DialogActions>
      </Dialog>

      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'right' }}>
        <Button
          variant="contained"
          onClick={() => handleClickOpen()}
        >
          Create New Meal
        </Button>
      </Box>
    </div>
  );
};

export default Meals;