import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { db, type Recipe, type Meal } from '../db/db';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, TextField, Typography, Box, IconButton, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { Edit, ArrowBack } from '@mui/icons-material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState, useEffect, useRef } from 'react';

const recipeSchema = z.object({
  url: z.string().max(500).url().optional().or(z.literal('')),
  notes: z.string().max(10000).optional(),
  images: z.array(z.instanceof(File)).max(10).optional(),
});

type RecipeForm = z.infer<typeof recipeSchema>;

export const Route = createFileRoute('/recipe/$mealId')({
  component: RecipeComponent,
});

function RecipeComponent() {
  const { mealId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isEditMode, setIsEditMode] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const initialRecipeExists = useRef(false);

  const { data: meal } = useQuery<Meal | undefined>({
    queryKey: ['meal', mealId],
    queryFn: () => db.meals.get(Number(mealId)),
  });

  const { data: recipe, isLoading } = useQuery<Recipe | undefined>({
    queryKey: ['recipe', mealId],
    queryFn: () => db.recipes.where('mealId').equals(Number(mealId)).first(),
    enabled: !!mealId,
  });

  const { control, handleSubmit, reset, formState: { errors } } = useForm<RecipeForm>({
    resolver: zodResolver(recipeSchema),
    defaultValues: { url: '', notes: '', images: [] },
  });

  useEffect(() => {
    if (recipe) {
      reset({ url: recipe.url, notes: recipe.notes, images: recipe.images });
      initialRecipeExists.current = true;
      setIsEditMode(false);
    } else {
      reset({ url: '', notes: '', images: [] });
      initialRecipeExists.current = false;
      setIsEditMode(true);
    }
    setIsDirty(false);
  }, [recipe, reset]);

  const mutation = useMutation({
    mutationFn: async (formData: RecipeForm) => {
      const recipeData: Omit<Recipe, 'id'> = {
        mealId: Number(mealId),
        url: formData.url || '',
        notes: formData.notes || '',
        images: formData.images || [],
      };

      if (recipe?.id) {
        return db.recipes.put({ ...recipeData, id: recipe.id });
      } else {
        return db.recipes.add(recipeData);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipe', mealId] });
      setIsEditMode(false);
      setIsDirty(false);
    },
  });

  const onSubmit = (data: RecipeForm) => {
    mutation.mutate(data);
  };

  const handleBack = () => {
    if (isDirty) {
      setDiscardConfirmOpen(true);
    } else {
      navigate({ to: '/meals' });
    }
  };

  const handleConfirmDiscard = () => {
    setDiscardConfirmOpen(false);
    setIsDirty(false);
    if (initialRecipeExists.current) {
      if (recipe) {
        reset({ url: recipe.url, notes: recipe.notes, images: recipe.images });
      }
      setIsEditMode(false);
    } else {
      reset({ url: '', notes: '', images: [] });
      setIsEditMode(true);
    }
  };

  if (isLoading) {
    return <Typography>Loading...</Typography>;
  }

  if (!mealId) {
    return <Typography>No meal ID provided.</Typography>;
  }

  if (!meal) {
    return <Typography>Meal not found.</Typography>;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <IconButton onClick={handleBack}>
          <ArrowBack />
        </IconButton>
        <Typography variant="h4">{recipe ? `Recipe for ${meal.name}` : `Create New Recipe for ${meal.name}`}</Typography>
        {!isEditMode ? (
          <IconButton onClick={() => setIsEditMode(true)}>
            <Edit />
          </IconButton>
        ) : <div />}
      </Box>

      <form onChange={() => setIsDirty(true)} onSubmit={handleSubmit(onSubmit)}>
        <Box sx={{ mt: 2 }}>
          <Typography variant="h5">Images</Typography>
          {isEditMode ? (
            <Controller
              name="images"
              control={control}
              render={({ field }) => (
                <Box>
                  <Box sx={{ display: 'flex', gap: 3, justifyContent: 'center', alignItems: 'center' }}>
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      id="file-input"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        field.onChange([...(field.value || []), ...files]);
                        setIsDirty(true);
                      }}
                    />
                    <Button
                      variant="outlined"
                      component="label"
                      htmlFor="file-input"
                      sx={{ mt: 1, mb: 2 }}
                    >
                      Upload Photo
                    </Button>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      id="camera-input"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        field.onChange([...(field.value || []), ...files]);
                        setIsDirty(true);
                      }}
                    />
                    <Button
                      variant="outlined"
                      component="label"
                      htmlFor="camera-input"
                      sx={{ mt: 1, mb: 2 }}
                    >
                      Take Photo
                    </Button>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 3, justifyContent: 'center', flexWrap: 'wrap', p: 1 }}>
                    {(field.value && field.value.length > 0) ? (
                      field.value.map((image: File, index: number) => (
                        <Box key={index} sx={{ position: 'relative' }}>
                          <img
                            src={URL.createObjectURL(image)}
                            alt={`recipe-${index}`}
                            width="150"
                            style={{ border: '1px solid black', cursor: 'pointer' }}
                            onClick={() => setSelectedImage(URL.createObjectURL(image))}
                          />
                          <IconButton
                            sx={{
                              position: 'absolute',
                              top: 0,
                              right: 0,
                              backgroundColor: 'rgba(255,255,255,0.7)',
                              '&:hover': { backgroundColor: 'rgba(255,255,255,0.9)' }
                            }}
                            size="small"
                            onClick={() => {
                              const newImages = [...(field.value || [])];
                              newImages.splice(index, 1);
                              field.onChange(newImages);
                              setIsDirty(true);
                            }}
                          >
                            X
                          </IconButton>
                        </Box>
                      ))
                    ) : (
                      <Typography>No images selected</Typography>
                    )}
                  </Box>
                </Box>
              )}
            />
          ) : (
            recipe && recipe.images && recipe.images.length > 0 ? (
              <Box sx={{ display: 'flex', gap: 3, justifyContent: 'center', flexWrap: 'wrap', p: 1 }}>
                {recipe.images.map((image: File, index: number) => (
                  <img key={index} src={URL.createObjectURL(image)} alt={`recipe-${index}`} width="150" style={{ border: '1px solid black' }} onClick={() => setSelectedImage(URL.createObjectURL(image))} />
                ))}
              </Box>
            ) : (
              <Typography>No images stored for this recipe</Typography>
            )
          )}
        </Box>

        <Box sx={{ mt: 2 }}>
          <Typography variant="h5">Recipe URL</Typography>
          {isEditMode ? (
            <Controller
              name="url"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  fullWidth
                  label="Recipe URL"
                  error={!!errors.url}
                  helperText={errors.url?.message}
                />
              )}
            />
          ) : (
            recipe?.url ? (
              <a href={recipe.url} target="_blank" rel="noopener noreferrer">{recipe.url}</a>
            ) : (
              <Typography>No URL stored for this recipe</Typography>
            )
          )}
        </Box>

        <Box sx={{ mt: 2 }}>
          <Typography variant="h5">Notes</Typography>
          {isEditMode ? (
            <Controller
              name="notes"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  fullWidth
                  multiline
                  rows={4}
                  label="Notes"
                  error={!!errors.notes}
                  helperText={errors.notes?.message}
                  sx={{ resize: 'both' }}
                />
              )}
            />
          ) : (
            recipe?.notes ? (
              <Typography>{recipe.notes}</Typography>
            ) : (
              <Typography>No notes stored for this recipe</Typography>
            )
          )}
        </Box>

        {isEditMode && (
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
            <Button type="submit" variant="contained">Save</Button>
            <Button onClick={() => setDiscardConfirmOpen(true)} variant="outlined">Discard</Button>
          </Box>
        )}
      </form>

      <Dialog open={discardConfirmOpen} onClose={() => setDiscardConfirmOpen(false)}>
        <DialogTitle>Discard Changes?</DialogTitle>
        <DialogContent>
          <Typography>You have unsaved changes. Are you sure you want to discard them?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDiscardConfirmOpen(false)}>Cancel</Button>
          <Button onClick={handleConfirmDiscard} color="error">Discard</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!selectedImage} onClose={() => setSelectedImage(null)} maxWidth="md" fullWidth>
        <DialogContent>
          {selectedImage && <img src={selectedImage} alt="Enlarged Recipe" style={{ width: '100%', height: 'auto' }} />}
        </DialogContent>
      </Dialog>
    </Box>
  );
}