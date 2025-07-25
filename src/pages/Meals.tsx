import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db, type Meal, ingredientSchema } from '../db/db';
import { Button, TextField, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText, IconButton, Box } from '@mui/material';
import { Edit, Delete } from '@mui/icons-material';
import { useForm, Controller, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import IngredientForm from '../components/IngredientForm';

const mealFormSchema = z.object({
  name: z.string().min(1, 'Meal name is required'),
  ingredients: z.array(ingredientSchema).optional(),
});

type MealForm = z.infer<typeof mealFormSchema>;

const Meals: React.FC = () => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedMeal, setSelectedMeal] = useState<Meal | null>(null);

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
    resolver: zodResolver(mealFormSchema),
    defaultValues: {
      name: '',
      ingredients: [{ name: '', quantity: 1 }],
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
        ingredients: [{ name: '', quantity: 1 }],
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
    const now = new Date();
    const mealPayload: Meal = {
      id: selectedMeal?.id,
      name: data.name,
      ingredients: data.ingredients?.filter(ing => ing.name && ing.name.trim() !== '' && ing.quantity && ing.quantity > 0).map(ing => ({
        name: ing.name!.trim().toLowerCase(),
        quantity: Number(ing.quantity!),
      })) || [],
      createdAt: selectedMeal?.createdAt || now,
      updatedAt: now,
    };
    mutation.mutate(mealPayload);
  };

  return (
    <div>
      <List>
        {meals?.map((meal) => (
          <ListItem key={meal.id}>
            <ListItemText
              primary={meal.name}
              secondary={`Created: ${meal.createdAt ? new Date(meal.createdAt).toLocaleString() : 'N/A'} - Updated: ${meal.updatedAt ? new Date(meal.updatedAt).toLocaleString() : 'N/A'
                }`}
            />
            <IconButton onClick={() => handleClickOpen(meal)}>
              <Edit />
            </IconButton>
            <IconButton onClick={() => deleteMutation.mutate(meal.id!)}>
              <Delete />
            </IconButton>
          </ListItem>
        ))}
      </List>

      <Dialog open={open} onClose={handleClose}>
        <DialogTitle>{selectedMeal ? 'Edit Meal' : 'Create New Meal'}</DialogTitle>
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