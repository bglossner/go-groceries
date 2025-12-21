import React, { useMemo, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, List, ListItem, ListItemButton, ListItemText, Divider, Typography, TextField, Box } from '@mui/material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db, type Meal, type GroceryList } from '../db/db';

interface AddToGroceryListModalProps {
  open: boolean;
  onClose: () => void;
  meal: Meal | null;
}

const AddToGroceryListModal: React.FC<AddToGroceryListModalProps> = ({ open, onClose, meal }) => {
  const queryClient = useQueryClient();
  const [newListName, setNewListName] = useState('');

  const { data: groceryLists } = useQuery<GroceryList[]>({
    queryKey: ['groceryLists'],
    queryFn: () => db.groceryLists.orderBy('createdAt').reverse().toArray(),
  });

  const eligibleGroceryLists = useMemo(() => {
    if (!groceryLists || !meal) return [];
    return groceryLists.filter(list => !list.meals.includes(meal.id!));
  }, [groceryLists, meal]);

  const addToExistingListMutation = useMutation({
    mutationFn: async (groceryList: GroceryList) => {
      if (!meal) return;
      const updatedMeals = [...groceryList.meals, meal.id!];
      return db.groceryLists.put({ ...groceryList, meals: updatedMeals });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groceryLists'] });
      onClose();
    },
  });

  const createNewListMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!meal) return;
      const newGroceryList: Omit<GroceryList, 'id'> = {
        name: name || new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
        meals: [meal.id!],
        createdAt: new Date(),
      };
      return db.groceryLists.add(newGroceryList);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groceryLists'] });
      setNewListName('');
      onClose();
    },
  });

  const handleCreateNew = () => {
    createNewListMutation.mutate(newListName);
  };

  if (!meal) return null;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Add "{meal.name}" to a Grocery List</DialogTitle>
      <DialogContent>
        <Typography variant="h6">Select an existing list</Typography>
        <List sx={{ maxHeight: 200, overflow: 'auto' }}>
          {eligibleGroceryLists.map(list => (
            <React.Fragment key={list.id}>
              <ListItem disablePadding>
                <ListItemButton onClick={() => addToExistingListMutation.mutate(list)}>
                  <ListItemText primary={list.name} />
                </ListItemButton>
              </ListItem>
              <Divider />
            </React.Fragment>
          ))}
          {eligibleGroceryLists.length === 0 && (
            <ListItem>
              <ListItemText secondary="No available grocery lists. Create a new one." />
            </ListItem>
          )}
        </List>
        <Divider sx={{ my: 2 }} />
        <Typography variant="h6">Or create a new list</Typography>
        <Box sx={{ mt: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
          <TextField
            label="New Grocery List Name"
            variant="outlined"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            fullWidth
          />
          <Button
            variant="contained"
            onClick={handleCreateNew}
            disabled={createNewListMutation.isPending}
          >
            Create
          </Button>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
};

export default AddToGroceryListModal;
