import { type MutableRefObject, type ReactNode, useCallback, useId } from 'react';
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, IconButton,
  List, ListItem, Paper, Typography,
} from '@mui/material';
import Close from '@mui/icons-material/Close';
import type { Store } from '../db/db';
import StoreColorDot from './StoreColorDot';

interface CommonProps {
  phone: boolean;
  stores: (Store & { id: number })[];
  saving: boolean;
  saveError?: string;
  onToggle: (storeId: number, checked: boolean) => void;
  onSave: () => void;
  onClose: () => void;
  headingRef: MutableRefObject<HTMLHeadingElement | null>;
}

type Props = CommonProps & (
  | { mode?: 'single'; name: string; inCatalog: boolean; saved: ReadonlySet<number>;
      changes: ReadonlyMap<number, boolean>; deleteAction?: ReactNode }
  | { mode: 'bulk'; ingredientCount: number; linkedCounts: ReadonlyMap<number, number>; draft: ReadonlySet<number> }
);

export default function IngredientStorePicker(props: Props) {
  const { phone, stores, saving, saveError, onToggle, onSave, onClose, headingRef } = props;
  const bulk = props.mode === 'bulk' ? props : undefined;
  const titleId = useId();
  const descriptionId = useId();
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => {
    headingRef.current = node;
    node?.focus({ preventScroll: true });
  }, [headingRef]);
  const hasChanges = props.mode === 'bulk' ? props.draft.size > 0 : props.changes.size > 0;
  const pendingLinks = bulk ? stores.reduce((total, store) => total + (bulk.draft.has(store.id)
    ? bulk.ingredientCount - (bulk.linkedCounts.get(store.id) ?? 0) : 0), 0) : 0;
  const actionSize = phone ? 'small' : 'medium';
  const content = (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', flexShrink: 0, gap: 1, p: 2 }}>
        <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <Typography component="h2" variant="h6" id={titleId} ref={focusHeading} tabIndex={-1}>
            {props.mode === 'bulk' ? 'Add to stores' : props.name}
          </Typography>
          <Typography id={descriptionId} variant="body2" color="text.secondary">
            {props.mode === 'bulk'
              ? `Choose stores for ${props.ingredientCount} selected ${props.ingredientCount === 1 ? 'ingredient' : 'ingredients'}.`
              : props.inCatalog ? 'Select every store that sells this ingredient.' : 'Review this ingredient’s saved assignments.'}
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
            {stores.map((store, index) => {
              const linked = bulk?.linkedCounts.get(store.id) ?? 0;
              const fullyLinked = linked === bulk?.ingredientCount;
              const disabled = saving || fullyLinked;
              const detailId = `${descriptionId}-store-${store.id}`;
              return (
                <ListItem key={store.id} disablePadding divider={index < stores.length - 1}>
                  <Box
                    component="label"
                    sx={{
                      display: 'flex', width: '100%', alignItems: 'center', gap: 1, minHeight: bulk ? 55 : 50, pl: 2, pr: 1,
                      cursor: disabled ? 'default' : 'pointer', '&:hover': { bgcolor: 'action.hover' },
                      '&:has(input:focus-visible)': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' },
                    }}
                  >
                    <StoreColorDot color={store.color} />
                    <Box component="span" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                      <Typography component="span" display="block">{store.name}</Typography>
                      {bulk && (
                        <Typography id={detailId} component="span" display="block" variant="body2" color="text.secondary">
                          {fullyLinked ? `All ${linked} already linked` : `${linked} of ${bulk.ingredientCount} already linked`}
                        </Typography>
                      )}
                    </Box>
                    <Checkbox
                      checked={props.mode === 'bulk' ? props.draft.has(store.id) : props.changes.get(store.id) ?? props.saved.has(store.id)}
                      onChange={(_, checked) => onToggle(store.id, checked)}
                      disabled={disabled}
                      slotProps={{ input: bulk ? { 'aria-label': store.name, 'aria-describedby': detailId } : undefined }}
                      sx={{ width: 44, height: 44, flexShrink: 0 }}
                    />
                  </Box>
                </ListItem>
              );
            })}
          </List>
        ) : (
          <Typography sx={{ p: 2 }} color="text.secondary">
            {props.mode === 'bulk' ? 'Add a store in Manage stores to assign these ingredients.'
              : props.inCatalog ? 'Add a store in Manage stores to assign this ingredient.' : 'No saved assignments.'}
          </Typography>
        )}
      </DialogContent>
      {bulk && (
        <Typography role="status" variant="body2" color="text.secondary" sx={{ px: 2, pt: 1.25 }}>
          {hasChanges ? `${pendingLinks} ${pendingLinks === 1 ? 'link' : 'links'} will be added.` : 'Existing assignments stay in place.'}
        </Typography>
      )}
      <DialogActions disableSpacing sx={{ flexWrap: 'wrap', gap: 1, p: 1.5, pb: 'max(env(safe-area-inset-bottom), 12px)' }}>
        {props.mode !== 'bulk' && props.deleteAction}
        <Button size={actionSize} disabled={saving} onClick={onClose} sx={{ minHeight: 44 }}>Cancel</Button>
        <Button size={actionSize} variant="contained" disableElevation disabled={!hasChanges} aria-disabled={saving || undefined} onClick={onSave} sx={{ minHeight: 44 }}>
          {bulk ? 'Add to stores' : 'Save stores'}
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
