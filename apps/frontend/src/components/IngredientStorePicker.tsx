import { type MutableRefObject, type ReactNode, useCallback, useId } from 'react';
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, IconButton,
  List, ListItem, Paper, Typography,
} from '@mui/material';
import Close from '@mui/icons-material/Close';
import type { Store } from '../db/db';
import StoreColorDot from './StoreColorDot';

interface Props {
  name: string;
  phone: boolean;
  inCatalog: boolean;
  stores: (Store & { id: number })[];
  saved: ReadonlySet<number>;
  changes: ReadonlyMap<number, boolean>;
  saving: boolean;
  saveError?: string;
  onToggle: (storeId: number, checked: boolean) => void;
  onSave: () => void;
  onClose: () => void;
  deleteAction?: ReactNode;
  headingRef: MutableRefObject<HTMLHeadingElement | null>;
}

export default function IngredientStorePicker({
  name, phone, inCatalog, stores, saved, changes, saving, saveError, onToggle, onSave, onClose, deleteAction, headingRef,
}: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => {
    headingRef.current = node;
    node?.focus({ preventScroll: true });
  }, [headingRef]);
  const hasChanges = changes.size > 0;
  const actionSize = phone ? 'small' : 'medium';
  const content = (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', flexShrink: 0, gap: 1, p: 2 }}>
        <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <Typography component="h2" variant="h6" id={titleId} ref={focusHeading} tabIndex={-1}>
            {name}
          </Typography>
          <Typography id={descriptionId} variant="body2" color="text.secondary">
            {inCatalog ? 'Select every store that sells this ingredient.' : 'Review this ingredient’s saved assignments.'}
          </Typography>
        </Box>
        <IconButton aria-label="Close store picker" onClick={onClose} disabled={saving} sx={{ alignSelf: 'start', mt: -0.5, mr: -0.5, width: 44, height: 44 }}>
          <Close />
        </IconButton>
      </Box>
      <DialogContent dividers sx={{ p: 0, maxHeight: phone ? undefined : '50dvh' }}>
        {saveError && <Alert severity="error">{saveError}</Alert>}
        {stores.length ? (
          <List disablePadding>
            {stores.map((store, index) => (
              <ListItem key={store.id} disablePadding divider={index < stores.length - 1}>
                <Box
                  component="label"
                  sx={{
                    display: 'flex', width: '100%', alignItems: 'center', gap: 1, minHeight: 50, pl: 2, pr: 1,
                    cursor: saving ? 'default' : 'pointer', '&:hover': { bgcolor: 'action.hover' },
                    '&:has(input:focus-visible)': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' },
                  }}
                >
                  <StoreColorDot color={store.color} />
                  <Typography component="span" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{store.name}</Typography>
                  <Checkbox
                    checked={changes.get(store.id) ?? saved.has(store.id)}
                    onChange={(_, checked) => onToggle(store.id, checked)}
                    disabled={saving}
                    sx={{ width: 44, height: 44, flexShrink: 0 }}
                  />
                </Box>
              </ListItem>
            ))}
          </List>
        ) : (
          <Typography sx={{ p: 2 }} color="text.secondary">
            {inCatalog ? 'Add a store in Manage stores to assign this ingredient.' : 'No saved assignments.'}
          </Typography>
        )}
      </DialogContent>
      <DialogActions disableSpacing sx={{ flexWrap: 'wrap', gap: 1, p: 1.5, pb: 'max(env(safe-area-inset-bottom), 12px)' }}>
        {deleteAction}
        <Button size={actionSize} disabled={saving} onClick={onClose} sx={{ minHeight: 44 }}>Cancel</Button>
        <Button size={actionSize} variant="contained" disableElevation disabled={!hasChanges} aria-disabled={saving || undefined} onClick={onSave} sx={{ minHeight: 44 }}>
          Save stores
        </Button>
      </DialogActions>
    </>
  );

  return phone ? (
    <Dialog
      open
      disableRestoreFocus
      onClose={onClose}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      slotProps={{
        container: { sx: { alignItems: 'flex-end' } },
        paper: { sx: { width: '100%', maxWidth: '100%', m: 0, maxHeight: '85dvh', borderRadius: '12px 12px 0 0' } },
      }}
    >
      {content}
    </Dialog>
  ) : (
    <Paper component="section" aria-labelledby={titleId} variant="outlined" sx={{ minWidth: 0 }}>
      {content}
    </Paper>
  );
}
