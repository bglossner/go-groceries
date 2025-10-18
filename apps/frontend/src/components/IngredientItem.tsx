import React from 'react';
import { ListItem, ListItemText } from '@mui/material';
import { capitalize } from '../util/string';

const IngredientItem = React.forwardRef<HTMLLIElement, { name: string } & React.HTMLAttributes<HTMLLIElement>>(({ name, ...props }, ref) => {
  return (
    <ListItem sx={{ display: 'block', width: 'auto', maxWidth: 'max-content', paddingLeft: 0, paddingRight: 0 }} ref={ref} {...props}>
      <ListItemText primary={capitalize(name)} />
    </ListItem>
  );
});

export default IngredientItem;
