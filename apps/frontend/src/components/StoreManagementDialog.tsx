import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  List, ListItem, MenuItem, Select, TextField, Typography,
} from '@mui/material';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import { db, type IngredientStore, type Store } from '../db/db';
import { STORE_COLORS } from '../util/colors';
import StoreColorDot from './StoreColorDot';

type SavedStore = Store & { id: number };
type StoreEdit =
  | { action: 'create'; name: string }
  | { action: 'change color'; storeId: number; color: string }
  | { action: 'delete'; storeId: number; name: string; confirmedCount: number };

class StoreDeleteDetailsChanged extends Error {}

interface Props {
  open: boolean;
  onClose: () => void;
  stores: SavedStore[];
  assignmentCounts: ReadonlyMap<number, number>;
}

export default function StoreManagementDialog({ open, onClose, stores, assignmentCounts }: Props) {
  const titleId = useId();
  const deleteDescriptionId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const deleteButtons = useRef(new Map<number, HTMLButtonElement>());
  const returnFocusId = useRef<number>();
  const [name, setName] = useState('');
  const [deleteTargetId, setDeleteTargetId] = useState<number>();
  const deleteTarget = stores.find(store => store.id === deleteTargetId);
  const queryClient = useQueryClient();
  const editStore = useMutation({
    networkMode: 'always',
    mutationFn: async (edit: StoreEdit): Promise<SavedStore | undefined> => {
      switch (edit.action) {
        case 'create': {
          const id = await db.stores.add({ name: edit.name });
          return { id, name: edit.name };
        }
        case 'change color':
          return db.transaction('rw', db.stores, async () => {
            const store = await db.stores.get(edit.storeId);
            const sameColor = await db.stores.filter(store =>
              store.id !== edit.storeId && store.color?.toUpperCase() === edit.color,
            ).first();
            if (!store || sameColor) {
              throw new Error('Store or color no longer available');
            }
            await db.stores.update(edit.storeId, { color: edit.color });
            return { ...store, id: edit.storeId, color: edit.color };
          });
        case 'delete':
          await db.transaction('rw', db.stores, db.ingredientStores, async () => {
            const store = await db.stores.get(edit.storeId);
            const links = db.ingredientStores.where('storeId').equals(edit.storeId);
            if (store?.name !== edit.name || await links.count() !== edit.confirmedCount) {
              throw new StoreDeleteDetailsChanged();
            }
            await links.delete();
            await db.stores.delete(edit.storeId);
          });
          break;
      }
    },
    onSuccess: (savedStore, edit) => {
      if (savedStore) {
        queryClient.setQueryData<Store[]>(['stores'], (current = []) => [
          ...current.filter(store => store.id !== savedStore.id), savedStore,
        ]);
      }
      if (edit.action === 'create') setName('');
      if (edit.action === 'delete') {
        queryClient.setQueryData<Store[]>(['stores'], (current = []) => current.filter(store => store.id !== edit.storeId));
        queryClient.setQueryData<IngredientStore[]>(['ingredientStores'], (links = []) =>
          links.filter(link => link.storeId !== edit.storeId),
        );
        setDeleteTargetId(undefined);
        void queryClient.invalidateQueries({ queryKey: ['ingredientStores'] });
      }
      void queryClient.invalidateQueries({ queryKey: ['stores'] });
    },
    onError: async error => {
      if (error instanceof StoreDeleteDetailsChanged) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['stores'] }),
          queryClient.invalidateQueries({ queryKey: ['ingredientStores'] }),
        ]);
      }
    },
  });
  const usedColors = new Set(stores.map(store => store.color?.toUpperCase()));
  const deleteCount = deleteTarget ? (assignmentCounts.get(deleteTarget.id) ?? 0) : 0;

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = returnFocusId.current === undefined ? undefined : deleteButtons.current.get(returnFocusId.current);
    (trigger ?? titleRef.current)?.focus();
    returnFocusId.current = undefined;
  }, [open, deleteTarget?.id]);

  function backOrClose() {
    if (editStore.isPending) return;
    editStore.reset();
    if (deleteTarget) {
      returnFocusId.current = deleteTarget.id;
      setDeleteTargetId(undefined);
      return;
    }
    setDeleteTargetId(undefined);
    setName('');
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={backOrClose}
      aria-labelledby={titleId}
      aria-describedby={deleteTarget ? deleteDescriptionId : undefined}
      fullWidth
      maxWidth="xs"
    >
      <DialogTitle id={titleId} tabIndex={-1} ref={titleRef}>
        {deleteTarget ? 'Delete store?' : 'Manage stores'}
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {editStore.isError && (
          <Alert severity="error" sx={{ m: 2 }}>
            {editStore.error instanceof StoreDeleteDetailsChanged
              ? 'Store details changed. Review them before deleting.'
              : editStore.variables.action === 'change color'
                ? 'Could not change the store color. Try again.'
                : `Could not ${editStore.variables.action} the store. Try again.`}
          </Alert>
        )}
        {deleteTarget ? (
          <Typography id={deleteDescriptionId} sx={{ p: 2, overflowWrap: 'anywhere' }}>
            Delete {deleteTarget.name} and its {deleteCount} ingredient {deleteCount === 1 ? 'assignment' : 'assignments'}?
          </Typography>
        ) : (
          <>
            <Box
              component="form"
              onSubmit={event => {
                event.preventDefault();
                if (name.trim() && !editStore.isPending) {
                  editStore.mutate({ action: 'create', name: name.trim() });
                }
              }}
              sx={{ display: 'flex', gap: 1, p: 2 }}
            >
              <TextField
                label="Store name"
                size="small"
                fullWidth
                value={name}
                disabled={editStore.isPending}
                onChange={event => setName(event.target.value)}
              />
              <Button type="submit" variant="contained" disabled={!name.trim() || editStore.isPending}>
                Add
              </Button>
            </Box>
            <List disablePadding>
              {stores.map(store => {
                const currentColor = store.color?.toUpperCase() ?? '';
                const colors = new Set(
                  Object.keys(STORE_COLORS).filter(color => !usedColors.has(color) || color === currentColor),
                );
                if (currentColor) colors.add(currentColor);
                return (
                  <ListItem
                    key={store.id}
                    sx={{ borderTop: '1px solid', borderColor: 'divider', gap: 1, py: 1 }}
                  >
                    <StoreColorDot color={store.color} />
                    <Typography sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{store.name}</Typography>
                    <Select
                      size="small"
                      displayEmpty
                      value={currentColor}
                      inputProps={{ 'aria-label': `Color for ${store.name}` }}
                      disabled={editStore.isPending}
                      renderValue={color => (STORE_COLORS[color] ?? (color || 'No color'))}
                      onChange={event => editStore.mutate({
                        action: 'change color', storeId: store.id, color: event.target.value,
                      })}
                      sx={{ maxWidth: '45%' }}
                    >
                      {!currentColor && <MenuItem disabled value="">No color</MenuItem>}
                      {[...colors].sort().map(color => (
                        <MenuItem key={color} value={color} sx={{ gap: 1 }}>
                          <StoreColorDot color={color} />{STORE_COLORS[color] ?? color}
                        </MenuItem>
                      ))}
                    </Select>
                    <IconButton
                      aria-label={`Delete ${store.name}`}
                      ref={node => {
                        if (node) deleteButtons.current.set(store.id, node);
                        else deleteButtons.current.delete(store.id);
                      }}
                      disabled={editStore.isPending}
                      onClick={() => {
                        editStore.reset();
                        setDeleteTargetId(store.id);
                      }}
                    >
                      <DeleteOutline />
                    </IconButton>
                  </ListItem>
                );
              })}
            </List>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button disabled={editStore.isPending} onClick={backOrClose}>{deleteTarget ? 'Cancel' : 'Done'}</Button>
        {deleteTarget && (
          <Button
            color="error"
            disabled={editStore.isPending}
            onClick={() => editStore.mutate({
              action: 'delete', storeId: deleteTarget.id, name: deleteTarget.name, confirmedCount: deleteCount,
            })}
          >
            Delete
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
