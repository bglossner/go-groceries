import React, { useEffect } from 'react';
import { useFieldArray, useFormContext, Controller, useWatch, useFormState } from 'react-hook-form';
import { TextField, IconButton, Box, Typography, Autocomplete, createFilterOptions } from '@mui/material';
import { RemoveCircleOutline } from '@mui/icons-material';
import type { CustomIngredient } from '../db/db';
import type { Ingredient } from '../types/ingredients';

const capitalize = (s: string) => s.replace(/\b\w/g, l => l.toUpperCase());

interface IngredientFormProps {
  name: string;
  label: string;
  customIngredients?: CustomIngredient[];
  enableAutocomplete?: boolean;
}

const ingredientFormAutocompleteOptions = createFilterOptions<Ingredient['name']>({ limit: 10 });

const IngredientForm: React.FC<IngredientFormProps> = ({ name, label, customIngredients = [], enableAutocomplete = false }) => {
  const { control, getValues } = useFormContext();
  const { fields, append, remove } = useFieldArray({
    control,
    name: name,
  });

  const watchedIngredients: Ingredient[] = useWatch({ control, name });
  const ingredientsFormState = useFormState({ control, name });

  useEffect(() => {
    if (!watchedIngredients) {
      return;
    }

    const actualIngredients = getValues(name);

    if (actualIngredients.length === 0) {
      append({ name: '', quantity: undefined });
      return;
    }

    const lastIngredient = actualIngredients[actualIngredients.length - 1];

    if (lastIngredient && lastIngredient.name && lastIngredient.name.trim() !== '') {
      const hasEmptyRowAtEnd = actualIngredients.length > 0 && actualIngredients[actualIngredients.length - 1].name.trim() === '';
      if (!hasEmptyRowAtEnd) {
        append({ name: '', quantity: undefined });
      }
    }
  }, [watchedIngredients, append]);

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="h6">{label}</Typography>
      {fields.map((item, index) => (
        <Box key={item.id} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
          <Controller
            name={`${name}.${index}.name`}
            control={control}
            render={({ field, fieldState: { error } }) => (
              enableAutocomplete ? (
                <Autocomplete
                  {...field}
                  options={customIngredients
                    .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
                    .filter(ci => !watchedIngredients.some(wi => wi.name?.toLowerCase() === ci.name.toLowerCase()))
                    .map((ing) => capitalize(ing.name))}
                  filterOptions={ingredientFormAutocompleteOptions}
                  freeSolo
                  onChange={(_event, newValue) => {
                    field.onChange(newValue);
                  }}
                  onInputChange={(_event, newInputValue) => {
                    field.onChange(newInputValue);
                  }}
                  sx={{ minWidth: '50%', flexBasis: 0 }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      margin="dense"
                      label="Ingredient Name"
                      type="text"
                      error={!!error || !!ingredientsFormState.errors[name]}
                      helperText={error?.message || ingredientsFormState.errors[name]?.message as string}
                    />
                  )}
                />
              ) : (
                <TextField
                  {...field}
                  margin="dense"
                  label="Ingredient Name"
                  type="text"
                  sx={{ minWidth: '50%', }}
                  value={capitalize(field.value || '')}
                  onChange={(e) => field.onChange(e.target.value)}
                  onBlur={(e) => {
                    field.onChange(e.target.value.trim());
                    field.onBlur();
                  }}
                  error={!!error || !!ingredientsFormState.errors[name]}
                  helperText={error?.message || ingredientsFormState.errors[name]?.message as string}
                />
              )
            )}
          />
          <Controller
            name={`${name}.${index}.quantity`}
            control={control}
            render={({ field, fieldState: { error } }) => (
              <TextField
                {...field}
                margin="dense"
                label="Quantity"
                type="number"
                // sx={{ flexGrow: 1, flexBasis: 0 }}
                onChange={(e) => { field.onChange(e.target.value === '' ? '' : parseInt(e.target.value, 10)) }}
                error={!!error}
                helperText={error?.message}
              />
            )}
          />
          <IconButton onClick={() => remove(index)} color="error">
            <RemoveCircleOutline />
          </IconButton>
        </Box>
      ))}
    </Box>
  );
};

export default IngredientForm;
