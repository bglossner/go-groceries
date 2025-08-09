import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db, type Meal, ingredientSchema, type Tag } from '../db/db';
import { Button, TextField, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText, IconButton, Box, Accordion, AccordionSummary, AccordionDetails, Typography, Chip, Autocomplete, createFilterOptions, Container, DialogContentText, Checkbox, ListItemButton, ListItemIcon } from '@mui/material';
import { useNavigate } from '@tanstack/react-router';
import { Edit, Delete, ExpandMore, Restaurant, FilterList } from '@mui/icons-material';
import { useForm, Controller, FormProvider, type ResolverOptions, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import IngredientForm from '../components/IngredientForm';

const mealFormSchema = z.object({
  name: z.string().min(1, 'Meal name is required').transform(name => name.trim()),
  ingredients: z.array(ingredientSchema).transform((ingredients) => {
    return ingredients.filter(ing => ing.name && ing.name.trim() !== '');
  }).refine((ingredients) => ingredients.length > 0, 'Must have at least 1 ingredient'),
  tags: z.array(z.object({ id: z.number().optional(), name: z.string() })).optional(),
});

type MealForm = z.infer<typeof mealFormSchema>;

const capitalize = (s: string) => s.replace(/\b\w/g, l => l.toUpperCase());

const filter = createFilterOptions<Tag>();

const sessionStartTime = new Date();

const Meals: React.FC = () => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedMeal, setSelectedMeal] = useState<Meal | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ id: number; name: string } | null>(null);
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [selectedFilterTags, setSelectedFilterTags] = useState<Tag[]>([]);

  const handleFilterDialogOpen = () => {
    setFilterDialogOpen(true);
  };

  const handleFilterDialogClose = () => {
    setFilterDialogOpen(false);
  };

  const handleToggleFilterTag = (tag: Tag) => {
    setSelectedFilterTags(prev =>
      prev.some(t => t.id === tag.id) ? prev.filter(t => t.id !== tag.id) : [...prev, tag]
    );
  };

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

  const { data: tags } = useQuery<Tag[]>({
    queryKey: ['tags'],
    queryFn: () => db.tags.toArray(),
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
      tags: [],
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
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setOpen(false);
      setSelectedMeal(null);
      reset();
      setDiscardConfirmOpen(false);
      window.scrollTo(0, 0);
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

  const handleClickOpen = async (meal: Meal | null = null) => {
    setSelectedMeal(meal);
    if (meal) {
      const mealTags = meal.tags ? await db.tags.bulkGet(meal.tags) : [];
      reset({
        name: meal.name,
        ingredients: meal.ingredients.map(ing => ({ name: ing.name, quantity: ing.quantity })),
        tags: mealTags.filter(tag => tag !== undefined) as Tag[],
      });
    } else {
      reset({
        name: '',
        ingredients: [{ name: '', quantity: undefined }],
        tags: [],
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

  const onSubmit = async (data: MealForm) => {
    const now = new Date();

    const uniqueTags = new Map<string, Tag>();
    for (const tag of data.tags || []) {
      const processedTagName = (typeof tag === 'string' ? tag : tag.name).trim().toLowerCase();
      if (!uniqueTags.has(processedTagName)) {
        uniqueTags.set(processedTagName, { ...tag, name: processedTagName });
      }
    }

    const tagIds = await Promise.all(Array.from(uniqueTags.values()).map(async (tag) => {
      if (tag.id) return tag.id;
      const existingTag = await db.tags.where('name').equalsIgnoreCase(tag.name).first();
      if (existingTag) return existingTag.id!;
      return db.tags.add({ name: tag.name });
    }));

    const mealPayload: Meal = {
      id: selectedMeal?.id,
      name: data.name.trim(),
      ingredients: data.ingredients?.filter(ing => ing.name && ing.name.trim() !== '').map(ing => ({
        name: ing.name!.trim().toLowerCase(),
        quantity: ing.quantity == null ? 1 : Number(ing.quantity!),
      })) || [],
      tags: tagIds.filter(id => id !== undefined) as number[] || [],
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
        <IconButton onClick={handleFilterDialogOpen}>
          <FilterList />
        </IconButton>
        <Button onClick={() => {
          setSearchTerm('');
          setSelectedFilterTags([]);
        }} variant="outlined">Clear</Button>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
        {selectedFilterTags.map(tag => (
          <Chip
            key={tag.id}
            label={tag.name}
            onDelete={() => handleToggleFilterTag(tag)}
            color="primary"
          />
        ))}
      </Box>
      <List>
        {meals?.filter(meal => {
          const matchesSearch = meal.name.toLowerCase().includes(searchTerm.toLowerCase());
          const matchesTags = selectedFilterTags.every(filterTag => meal.tags?.includes(filterTag.id!));
          return matchesSearch && matchesTags;
        }).map((meal) => (
          <Accordion key={meal.id}>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Box sx={{ width: '100%' }}>
                <Typography variant="h6">{meal.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {`Created: ${meal.createdAt ? new Date(meal.createdAt).toLocaleString() : 'N/A'} - Updated: ${meal.updatedAt ? new Date(meal.updatedAt).toLocaleString() : 'N/A'}`}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                  {meal.tags?.map(tagId => {
                    const tag = tags?.find(t => t.id === tagId);
                    return tag ? <Chip key={tag.id} label={tag.name} size="small" /> : null;
                  })}
                </Box>
              </Box>
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
                {meal.tags && meal.tags.length > 0 && (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="h6">Tags:</Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {meal.tags.map(tagId => {
                          const tag = tags?.find(t => t.id === tagId);
                          return tag ? <Chip color="primary" key={tag.id} label={tag.name} /> : null;
                        })}
                      </Box>
                    </Box>
                  )}
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
              <Controller
                name="tags"
                control={control}
                render={({ field }) => (
                  <Autocomplete
                    {...field}
                    multiple
                    freeSolo
                    options={(tags || []).filter(tag => !field.value?.some(selectedTag => selectedTag.name === tag.name))}
                    getOptionLabel={(option) => {
                      if (typeof option === 'string') {
                        return capitalize(option);
                      }
                      return capitalize(option.name);
                    }}
                    filterOptions={(options, params) => {
                      const filtered = filter(options, params);
                      if (params.inputValue !== '') {
                        filtered.push({
                          id: undefined,
                          name: `Add "${capitalize(params.inputValue)}"`,
                        });
                      }
                      return filtered;
                    }}
                    value={field.value || []}
                    onChange={(_, newValue) => {
                      const uniqueTags = new Map<string, { name: string }>();
                      newValue.forEach(option => {
                          let processedTagName: string;
                          if (typeof option === 'string') {
                              processedTagName = option.trim().toLowerCase();
                          } else if (option.name.startsWith('Add "') && option.name.endsWith('"')) {
                              processedTagName = option.name.substring(5, option.name.length - 1).trim().toLowerCase();
                          } else {
                              processedTagName = option.name.trim().toLowerCase();
                          }

                          if (!uniqueTags.has(processedTagName)) {
                              uniqueTags.set(processedTagName, { name: processedTagName });
                          }
                      });
                      field.onChange(Array.from(uniqueTags.values()));
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        variant="outlined"
                        label="Tags"
                        placeholder="Add tags"
                        margin="dense"
                        fullWidth
                      />
                    )}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip color="primary" variant="outlined" label={capitalize(option.name)} {...getTagProps({ index })} />
                      ))
                    }
                  />
                )}
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={handleClose}>Cancel</Button>
              <Button type="submit">{selectedMeal ? 'Save' : 'Create'}</Button>
            </DialogActions>
          </form>
        </FormProvider>
      </Dialog>

      <Dialog open={filterDialogOpen} onClose={handleFilterDialogClose}>
        <DialogTitle>Filter by Tags</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Select tags to filter meals by. Only meals with all selected tags will be shown.
          </DialogContentText>
          <List>
            {tags?.slice().sort((a, b) => a.name.localeCompare(b.name)).map(tag => (
              <ListItem key={tag.id} disablePadding>
                <ListItemButton onClick={() => handleToggleFilterTag(tag)} dense>
                  <ListItemIcon>
                    <Checkbox
                      edge="start"
                      checked={selectedFilterTags.some(t => t.id === tag.id)}
                      tabIndex={-1}
                      disableRipple
                    />
                  </ListItemIcon>
                  <ListItemText primary={tag.name} />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedFilterTags([])}>Clear</Button>
          <Button onClick={handleFilterDialogClose}>Close</Button>
        </DialogActions>
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

      <Box sx={{ position: 'fixed', bottom: 16, left: 0, right: 0 }}>
        <Container maxWidth="lg">
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              onClick={() => handleClickOpen()}
            >
              Create New Meal
            </Button>
          </Box>
        </Container>
      </Box>
    </div>
  );
};

export default Meals;