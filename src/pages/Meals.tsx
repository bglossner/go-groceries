import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db, type Meal, ingredientSchema } from '../db/db';
import { Button, TextField, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText, IconButton, Box, Accordion, AccordionSummary, AccordionDetails, Typography } from '@mui/material';
import { Edit, Delete, ExpandMore } from '@mui/icons-material';
import { useForm, Controller, FormProvider, type ResolverOptions } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import IngredientForm from '../components/IngredientForm';

const mealFormSchema = z.object({
  name: z.string().min(1, 'Meal name is required'),
  ingredients: z.array(ingredientSchema).transform((ingredients) => {
    return ingredients.filter(ing => ing.name && ing.name.trim() !== '');
  }).refine((ingredients) => ingredients.length > 0, 'Must have at least 1 ingredient')
});

type MealForm = z.infer<typeof mealFormSchema>;

const capitalize = (s: string) => s.replace(/\b\w/g, l => l.toUpperCase());

const Meals: React.FC = () => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedMeal, setSelectedMeal] = useState<Meal | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ id: number; name: string } | null>(null);

  const { data: meals } = useQuery({
    queryKey: ['meals'],
    queryFn: async () => {
      const allMeals = await db.meals.toArray();
      const mappedWithDate = allMeals.map(meal => ({
        ...meal,
        updatedAt: new Date(meal.updatedAt || meal.createdAt || new Date()),
      }));
      mappedWithDate.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      return mappedWithDate;
    },
  });

  const methods = useForm<MealForm>({
    resolver: (values, ctx, options) => {
      const resolver = zodResolver(mealFormSchema);
      const resolveValues = resolver(values as MealForm, ctx, options as ResolverOptions<z.input<typeof mealFormSchema>>);
      console.log(resolveValues);
      return resolveValues;
    },
    defaultValues: {
      name: '',
      ingredients: [{ name: '', quantity: undefined }],
    },
  });

  const { control, handleSubmit, reset, formState: { errors } } = methods;

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
      handleClose();
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

  const handleClose = () => {
    setOpen(false);
    setSelectedMeal(null);
    reset();
  };

  const onSubmit = (data: MealForm) => {
    console.log('submit')
    const now = new Date();
    const mealPayload: Meal = {
      id: selectedMeal?.id,
      name: data.name,
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
      <List>
        {meals?.map((meal) => (
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