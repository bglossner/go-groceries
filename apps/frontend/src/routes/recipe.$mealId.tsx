import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { db, type Recipe, type Meal, type PendingRecipe } from '../db/db';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, TextField, Typography, Box, IconButton, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { Edit, ArrowBack } from '@mui/icons-material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState, useEffect, useRef } from 'react';
import { recipeSchema, type RecipeForm } from '../types/recipe';
import { convertFilesToImageBlobs, imageUrlResolver, mapMealRecipeImagesToRecipeImages } from '../util/images';

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
  const [imageUrlInput, setImageUrlInput] = useState('');
  const initialRecipeExists = useRef<boolean | null>(null);
  const recipeLookedUp = useRef(false);

  const { data: meal } = useQuery<Meal | undefined>({
    queryKey: ['meal', mealId],
    queryFn: () => db.meals.get(Number(mealId)),
  });

  const { data: pendingRecipe } = useQuery<PendingRecipe | null>({
    queryKey: ['pendingRecipe', meal?.pendingRecipeId],
    queryFn: async () => {
      if (!meal?.pendingRecipeId) return null;
      return (await db.pendingRecipes.get(meal.pendingRecipeId)) ?? null;
    },
    enabled: !!meal?.pendingRecipeId,
  });

  const { data: recipe, isLoading } = useQuery<Recipe | null>({
    queryKey: ['recipe', mealId],
    queryFn: async () => {
      const recipe = (await db.recipes.where('mealId').equals(Number(mealId)).first()) ?? null;
      return recipe;
    },
    enabled: !!mealId,
  });

  const { control, handleSubmit, reset, formState: { errors }, setValue, getValues } = useForm<RecipeForm>({
    resolver: zodResolver(recipeSchema),
    defaultValues: { url: '', notes: '', images: [] },
  });

  const handleImageUrlAdd = async () => {
    const trimmedUrl = imageUrlInput.trim();
    if (trimmedUrl) {
      const parseResult = await imageUrlResolver.safeParseAsync(trimmedUrl);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.issues[0].message;
        alert(errorMessage);
        return;
      }
      const currentImages = getValues('images') || [];
      setValue('images', [...currentImages, parseResult.data], { shouldDirty: true });
      setImageUrlInput('');
    }
  };

  useEffect(() => {
    if (initialRecipeExists.current !== null && recipeLookedUp.current) {
      return;
    }

    if (recipe) {
      reset({ url: recipe.url, notes: recipe.notes, images: recipe.images });
      initialRecipeExists.current = true;
      setIsEditMode(false);
    } else {
      reset({ url: '', notes: '', images: [] });
      setIsEditMode(true);
    }
    setIsDirty(false);
  }, [recipe, isLoading, reset]);

  useEffect(() => {
    setImageUrlInput('');
  }, [isEditMode]);

  const handleImportRecipe = () => {
    if (!pendingRecipe) return;
    reset({
      url: pendingRecipe.sourceUrl,
      notes: pendingRecipe.content,
      images: mapMealRecipeImagesToRecipeImages(pendingRecipe.images),
    });
    setIsDirty(true);
  };

  const mutation = useMutation({
    mutationFn: async (formData: RecipeForm) => {
      const recipeData: Omit<Recipe, 'id'> = {
        mealId: Number(mealId),
        url: formData.url || '',
        notes: formData.notes || '',
        images: (formData.images || []),
      };

      if (recipe?.id) {
        return db.recipes.put({ ...recipeData, id: recipe.id });
      } else {
        return db.recipes.add(recipeData);
      }
    },
    onSuccess: async () => {
      if (meal?.pendingRecipeId) {
        await db.pendingRecipes.delete(meal.pendingRecipeId);
        await db.meals.update(meal.id!, { pendingRecipeId: undefined });
        queryClient.invalidateQueries({ queryKey: ['meals'] });
      }
      queryClient.invalidateQueries({ queryKey: ['recipe', mealId] });
      setIsEditMode(false);
      setIsDirty(false);
    },
  });

  const onSubmit = (data: RecipeForm) => {
    mutation.mutate({
      ...data,
      url: data.url?.trim(),
      notes: data.notes?.trim(),
    });
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

  const convertPhotoTaken = async (files: File[]) => {
    try {
      return await convertFilesToImageBlobs(files);
    } catch (error: any) {
      console.error(error);
      alert(error);
      return [];
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
      {pendingRecipe && !recipe && (
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center', gap: 2, alignContent: 'center' }}>
          <Typography variant="h5" sx={{ m: 0 }}>Pending Recipe Available!</Typography>
          <Button onClick={handleImportRecipe} variant="contained" sx={{ ml: 1 }}>Import from YouTube</Button>
        </Box>
      )}

      <form onChange={() => setIsDirty(true)} onSubmit={handleSubmit(onSubmit)}>
        <Box sx={{ mt: 2 }}>
          <Typography variant="h5">Images</Typography>
          {isEditMode ? (
            <Controller
              name="images"
              control={control}
              render={({ field }) => (
                <Box>
                  <Box sx={{ display: 'flex', flexWrap: { xs: 'wrap', md: 'nowrap' }, gap: 3, justifyContent: 'center', alignItems: 'center' }}>
                    <Box sx={{ display: 'flex', gap: 3, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        type="file"
                        multiple
                        accept="image/*"
                        id="file-input"
                        style={{ display: 'none' }}
                        onChange={async (e) => {
                          const files = Array.from(e.target.files || []);
                          if (files.length === 0) return;
                          const convertedFiles = await convertPhotoTaken(files);
                          field.onChange([...(field.value || []), ...convertedFiles]);
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
                        onChange={async (e) => {
                          const files = Array.from(e.target.files || []);
                          if (files.length === 0) return;
                          const convertedFiles = await convertPhotoTaken(files);
                          field.onChange([...(field.value || []), ...convertedFiles]);
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
                    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', alignItems: 'center', mb: 2, flexGrow: 1 }}>
                      <TextField
                        label="Image URL"
                        variant="outlined"
                        size="small"
                        value={imageUrlInput}
                        onChange={(e) => setImageUrlInput(e.target.value)}
                        sx={{ flexGrow: 1 }}
                      />
                      <Button variant="outlined" onClick={handleImageUrlAdd}>Add URL</Button>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 3, justifyContent: 'center', flexWrap: 'wrap', p: 1 }}>
                    {(field.value && field.value.length > 0) ? (
                      field.value.map((image: File | string, index: number) => (
                        <Box key={index} sx={{ position: 'relative' }}>
                          <img
                            src={typeof image === 'string' ? image : URL.createObjectURL(image)}
                            alt={`recipe-${index}`}
                            width="150"
                            style={{ border: '1px solid black', cursor: 'pointer' }}
                            onClick={() => setSelectedImage(typeof image === 'string' ? image : URL.createObjectURL(image))}
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
                {recipe.images.map((image: File | string, index: number) => (
                  <img key={index} src={typeof image === 'string' ? image : URL.createObjectURL(image)} alt={`recipe-${index}`} width="150" style={{ border: '1px solid black' }} onClick={() => setSelectedImage(typeof image === 'string' ? image : URL.createObjectURL(image))} />
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
              <Typography component="pre" sx={{}}>{recipe.notes}</Typography>
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
