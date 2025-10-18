import { Paper, Typography, List } from '@mui/material';
import DraggableIngredient from './DraggableIngredient';
import { type Store, type IngredientStore } from '../db/db';

const AvailableIngredientsList = ({ ingredients, stores, ingredientStores }: { ingredients: string[], stores: Store[], ingredientStores: IngredientStore[] }) => {
  return (
    <Paper sx={{ p: 2, maxHeight: '60vh', overflow: 'auto' }}>
      <Typography variant="h6">Available Ingredients</Typography>
      <List sx={{ textAlign: 'left', display: 'flex', flexDirection: 'column' }}>
        {ingredients.map((ingredient) => (
          <DraggableIngredient key={ingredient} name={ingredient} stores={stores} ingredientStores={ingredientStores} />
        ))}
      </List>
    </Paper>
  );
};

export default AvailableIngredientsList;
