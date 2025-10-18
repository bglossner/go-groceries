import { useState, useMemo } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { db, type Store } from '../db/db';
import { useSortable } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { Paper, Typography, List, Box, IconButton, Dialog, DialogActions, DialogContent, DialogTitle, Button, FormControl, Select, MenuItem } from '@mui/material';
import { Delete } from '@mui/icons-material';
import DraggableIngredient from './DraggableIngredient';
import { AVAILABLE_COLORS } from '../util/colors';

const StoreBucket = ({ store, ingredients }: { store: Store, ingredients: string[] }) => {
  const { setNodeRef: setSortableNodeRef } = useSortable({ id: store.id! });
  const { setNodeRef: setDroppableNodeRef, isOver } = useDroppable({ id: store.id! });
  const queryClient = useQueryClient();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const { data: allStores } = useQuery({ queryKey: ['stores'], queryFn: () => db.stores.toArray() });

  const usedColors = useMemo(() => new Set(allStores?.map(s => s.color).filter(Boolean) as string[]), [allStores]);
  const availableColors = useMemo(() => {
    const colors = AVAILABLE_COLORS.filter(color => !usedColors.has(color));
    if (store.color && !colors.includes(store.color)) {
      colors.push(store.color);
    }
    return colors.sort();
  }, [usedColors, store.color]);

  const deleteStoreMutation = useMutation({
    mutationFn: async (storeId: number) => {
      await db.ingredientStores.where('storeId').equals(storeId).delete();
      await db.stores.delete(storeId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stores'] });
      queryClient.invalidateQueries({ queryKey: ['ingredientStores'] });
      setDeleteConfirmOpen(false);
    }
  });

  const updateStoreColorMutation = useMutation({
    mutationFn: async (data: { storeId: number, color: string }) => {
      const s = await db.stores.get(data.storeId);
      if (s) {
        await db.stores.update(data.storeId, { color: data.color });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stores'] });
    },
  });

  const handleDelete = () => {
    deleteStoreMutation.mutate(store.id!);
  };

  const handleColorChange = (newColor: string) => {
    if (store.id && newColor) {
      updateStoreColorMutation.mutate({ storeId: store.id, color: newColor });
    }
  };

  const combinedRef = (node: HTMLDivElement) => {
    setSortableNodeRef(node);
    setDroppableNodeRef(node);
  };

  return (
    <Paper
      ref={combinedRef}
      sx={{
        p: 2,
        mb: 2,
        border: isOver ? '2px solid' : '1px solid',
        borderColor: isOver ? 'primary.main' : 'grey.300',
        backgroundColor: isOver ? 'primary.light' : 'background.paper',
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          {store.color && (
            <Box sx={{ width: 20, height: 20, borderRadius: '50%', backgroundColor: store.color, mr: 1, border: '1px solid grey' }} />
          )}
          <Typography variant="h6">{store.name}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <FormControl variant="standard" sx={{ m: 1, width: 40 }}>
            <Select
              value={store.color || ''}
              onChange={(e) => handleColorChange(e.target.value as string)}
              disableUnderline
              renderValue={(value) => (
                <Box sx={{ width: 20, height: 20, borderRadius: '50%', backgroundColor: value, border: '1px solid grey' }} />
              )}
            >
              {availableColors.map((color) => (
                <MenuItem key={color} value={color}>
                  <Box sx={{ width: 20, height: 20, borderRadius: '50%', backgroundColor: color, border: '1px solid grey' }} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <IconButton onClick={() => setDeleteConfirmOpen(true)}><Delete /></IconButton>
        </Box>
      </Box>
      <List sx={{ display: 'flex', flexDirection: 'row', gap: 2 }}>
        {ingredients.map((name) => (
          <DraggableIngredient key={`${name}-${store.id}`} name={name} storeId={store.id!} />
        ))}
      </List>
      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
        <DialogTitle>Confirm Deletion</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete the store "{store.name}"? This will remove all associated ingredients from this store.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
          <Button onClick={handleDelete} color="error">Delete</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};



export default StoreBucket;
