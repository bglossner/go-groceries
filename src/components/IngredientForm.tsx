import React, { useEffect } from 'react';
import { useFieldArray, useFormContext, Controller, useWatch, useFormState } from 'react-hook-form';
import { TextField, IconButton, Box, Typography } from '@mui/material';
import { RemoveCircleOutline } from '@mui/icons-material';
import type { Ingredient } from '../db/db';

const capitalize = (s: string) => s.replace(/\b\w/g, l => l.toUpperCase());

interface IngredientFormProps {
  name: string;
  label: string;
}

const IngredientForm: React.FC<IngredientFormProps> = ({ name, label }) => {
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

    // If the list is empty, add one empty row
    if (actualIngredients.length === 0) {
      append({ name: '', quantity: undefined });
      return;
    }

    const lastIngredient = actualIngredients[actualIngredients.length - 1];

    // If the last ingredient has a name (is not empty), and it's not already followed by an empty row, add a new empty row
    if (lastIngredient && lastIngredient.name.trim() !== '') {
      // Check if there's already an empty row at the end
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
              <TextField
                {...field}
                margin="dense"
                label="Ingredient Name"
                type="text"
                fullWidth
                value={capitalize(field.value || '')}
                onChange={(e) => field.onChange(e.target.value)}
                onBlur={(e) => {
                  field.onChange(e.target.value.trim());
                  field.onBlur();
                }}
                error={!!error || !!ingredientsFormState.errors[name]}
                helperText={error?.message || ingredientsFormState.errors[name]?.message as string}
              />
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
                fullWidth
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