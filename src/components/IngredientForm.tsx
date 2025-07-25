import React, { useEffect } from 'react';
import { useFieldArray, useFormContext, Controller, useWatch } from 'react-hook-form';
import { TextField, IconButton, Box, Typography } from '@mui/material';
import { RemoveCircleOutline } from '@mui/icons-material';
import type { Ingredient } from '../db/db';

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

  useEffect(() => {
    if (!watchedIngredients) {
      return;
    }

    const actualIngredients = getValues(name);

    // If the list is empty, add one empty row
    if (actualIngredients.length === 0) {
      append({ name: '', quantity: 1 });
      return;
    }

    const lastIngredient = actualIngredients[actualIngredients.length - 1];

    // If the last ingredient has a name (is not empty), and it's not already followed by an empty row, add a new empty row
    if (lastIngredient && lastIngredient.name.trim() !== '') {
      // Check if there's already an empty row at the end
      const hasEmptyRowAtEnd = actualIngredients.length > 0 && actualIngredients[actualIngredients.length - 1].name.trim() === '';
      if (!hasEmptyRowAtEnd) {
        append({ name: '', quantity: 1 });
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
            render={({ field }) => (
              <TextField
                {...field}
                margin="dense"
                label="Ingredient Name"
                type="text"
                fullWidth
              />
            )}
          />
          <Controller
            name={`${name}.${index}.quantity`}
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                margin="dense"
                label="Quantity"
                type="number"
                fullWidth
                onChange={(e) => field.onChange(e.target.value === '' ? undefined : parseInt(e.target.value, 10))}
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