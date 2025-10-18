import React from 'react';
import { Typography } from '@mui/material';
import { useSearch } from '@tanstack/react-router';
import { z } from 'zod';
import { GroceryListContainer } from '../components/GroceryListContainer';

const groceryListSearchSchema = z.object({
  groceryListId: z.number(),
});

const GoGroceryPage: React.FC = () => {
  const search = useSearch({ from: '/go-grocery' });

  const validatedSearch = groceryListSearchSchema.safeParse(search);

  if (!validatedSearch.success) {
    return <Typography>Invalid grocery list ID</Typography>;
  }

  return <GroceryListContainer groceryListId={validatedSearch.data.groceryListId} />;
};

export default GoGroceryPage;
