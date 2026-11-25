import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Divider,
  InputAdornment, List, ListItem, ListItemButton, Paper, TextField,
  ToggleButton, ToggleButtonGroup, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import CheckBox from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlank from '@mui/icons-material/CheckBoxOutlineBlank';
import ChevronRight from '@mui/icons-material/ChevronRight';
import Checklist from '@mui/icons-material/Checklist';
import Search from '@mui/icons-material/Search';
import Settings from '@mui/icons-material/Settings';
import IngredientStorePicker from '../components/IngredientStorePicker';
import StoreManagementDialog from '../components/StoreManagementDialog';
import { db, type CustomIngredient, type IngredientStore } from '../db/db';
import { useIngredientHold } from '../hooks/useIngredientHold';
import { CustomIngredientInUse, deleteCustomIngredient } from '../util/customIngredients';
import { addIngredientsToStores, saveIngredientStores, StoreAssignmentsChangedError } from '../util/storeAssignments';
import { capitalize } from '../util/string';

const focusOutline = { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' };
const emptyStoreIds: ReadonlySet<number> = new Set();
type Filter = 'all' | 'unassigned';
type Selection = { name: string; changes: ReadonlyMap<number, boolean> };
type BulkAssignment = { names: ReadonlySet<string>; storeIds: ReadonlySet<number> };

function rowIsVisible(row: HTMLButtonElement, list: HTMLDivElement) {
  if (!row.isConnected) return false;
  const { top, bottom } = row.getBoundingClientRect();
  const bounds = list.getBoundingClientRect();
  return bottom > Math.max(0, bounds.top) && top < Math.min(window.innerHeight, bounds.bottom);
}

export default function ManageStoresPage() {
  const queryClient = useQueryClient();
  const phone = useMediaQuery(useTheme().breakpoints.down('md'));
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => db.stores.orderBy('name').toArray(), networkMode: 'always' });
  const mealsQuery = useQuery({ queryKey: ['meals'], queryFn: () => db.meals.toArray(), networkMode: 'always' });
  const customQuery = useQuery({ queryKey: ['customIngredients'], queryFn: () => db.customIngredients.toArray(), networkMode: 'always' });
  const assignmentsQuery = useQuery({ queryKey: ['ingredientStores'], queryFn: () => db.ingredientStores.toArray(), networkMode: 'always' });
  const loading = [storesQuery, mealsQuery, customQuery, assignmentsQuery].some(query => query.isPending);
  const loadError = [storesQuery, mealsQuery, customQuery, assignmentsQuery].some(query => query.isLoadingError);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selection, setSelection] = useState<Selection>();
  const [bulkNames, setBulkNames] = useState<ReadonlySet<string>>();
  const [bulkDraft, setBulkDraft] = useState<ReadonlySet<number>>();
  const [bulkResult, setBulkResult] = useState<string>();
  const isSelecting = bulkNames !== undefined;
  const bulkPickerOpen = bulkDraft !== undefined;
  const { startHold, cancelHold } = useIngredientHold();
  const [managementOpen, setManagementOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ phone: boolean }>();
  const [deletedName, setDeletedName] = useState<string>();
  const searchRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLButtonElement>(null);
  const addToStoresRef = useRef<HTMLButtonElement>(null);
  const selectionTrigger = useRef<HTMLButtonElement | 'select'>();
  const wasBulkPickerOpen = useRef(false);
  const bulkSaveInFlight = useRef(false);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const editorHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const focusedIngredient = useRef<HTMLButtonElement | null>(null);
  const wasEditing = useRef(false);
  const ingredientHeadingId = useId();
  const deleteTitleId = useId();
  const deleteDescriptionId = useId();

  const stores = useMemo(() => (storesQuery.data ?? [])
    .flatMap(store => store.id === undefined ? [] : [{ ...store, id: store.id }])
    .sort((a, b) => a.name.localeCompare(b.name)), [storesQuery.data]);
  const customNames = useMemo(() => new Set(customQuery.data?.map(row => row.name.toLowerCase())), [customQuery.data]);
  const mealNames = useMemo(() => new Set(mealsQuery.data?.flatMap(meal =>
    meal.ingredients.map(ingredient => ingredient.name.toLowerCase()),
  )), [mealsQuery.data]);
  const listsQuery = useQuery({
    queryKey: ['groceryLists'],
    queryFn: () => db.groceryLists.orderBy('createdAt').reverse().toArray(),
    networkMode: 'always',
    enabled: customNames.size > 0,
  });
  const catalog = useMemo(() => new Set([...customNames, ...mealNames]), [customNames, mealNames]);
  const selectedName = selection?.name;
  const inUse = selectedName !== undefined && (mealNames.has(selectedName) || listsQuery.data?.some(list =>
    list.customIngredients?.some(ingredient => ingredient.name.toLowerCase() === selectedName),
  ));
  const { storesByIngredient, assignmentCounts } = useMemo(() => {
    const ids = new Set(stores.map(store => store.id));
    const storesByIngredient = new Map<string, Set<number>>();
    const assignmentCounts = new Map<number, number>();
    assignmentsQuery.data?.forEach(({ storeId, ingredientName }) => {
      if (!ids.has(storeId)) return;
      const ingredientStores = storesByIngredient.get(ingredientName) ?? new Set<number>();
      ingredientStores.add(storeId);
      storesByIngredient.set(ingredientName, ingredientStores);
      assignmentCounts.set(storeId, (assignmentCounts.get(storeId) ?? 0) + 1);
    });
    return { storesByIngredient, assignmentCounts };
  }, [assignmentsQuery.data, stores]);
  const needle = search.trim().toLowerCase();
  const ingredients = useMemo(() => [...new Set([...catalog, ...storesByIngredient.keys()])]
    .filter(name => name.toLowerCase().includes(needle) && (filter === 'all' || !storesByIngredient.has(name)))
    .sort((a, b) => a.localeCompare(b)), [catalog, filter, needle, storesByIngredient]);
  const eligibleResults = ingredients.filter(name => catalog.has(name));
  const hiddenPicks = bulkNames ? bulkNames.size - eligibleResults.filter(name => bulkNames.has(name)).length : 0;
  const allResultsSelected = eligibleResults.every(name => bulkNames?.has(name));
  const bulkLinkedCounts = useMemo(() => {
    const counts = new Map<number, number>();
    if (bulkPickerOpen) {
      bulkNames?.forEach(name => {
        storesByIngredient.get(name)?.forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1));
      });
    }
    return counts;
  }, [bulkNames, bulkPickerOpen, storesByIngredient]);
  const selectedStoreIds = selection ? (storesByIngredient.get(selection.name) ?? emptyStoreIds) : emptyStoreIds;
  const selectedInCatalog = selection !== undefined && catalog.has(selection.name);
  const editableStores = selectedInCatalog ? stores : stores.filter(store => selectedStoreIds.has(store.id));

  const saveStores = useMutation({
    networkMode: 'always',
    mutationFn: ({ name, changes }: Selection) => saveIngredientStores(name, changes),
    onSuccess: (saved, { name, changes }) => {
      queryClient.setQueryData<IngredientStore[]>(['ingredientStores'], (current = []) => [
        ...current.filter(link => link.ingredientName !== name || !changes.has(link.storeId)),
        ...saved,
      ]);
      void queryClient.invalidateQueries({ queryKey: ['ingredientStores'] });
      const remainsAssigned = saved.length > 0 || [...selectedStoreIds].some(id => !changes.has(id));
      if ((filter === 'unassigned' && remainsAssigned) || (!catalog.has(name) && !remainsAssigned)) {
        returnFocus.current = null;
      }
      setSelection(undefined);
    },
    onError: refreshAssignmentsOnError,
  });

  const saveBulkStores = useMutation({
    networkMode: 'always',
    mutationFn: ({ names, storeIds }: BulkAssignment) => addIngredientsToStores(names, storeIds),
    onSuccess: ({ links, addedCount }, { names, storeIds }) => {
      queryClient.setQueryData<IngredientStore[]>(['ingredientStores'], (current = []) => [
        ...current.filter(link => !names.has(link.ingredientName) || !storeIds.has(link.storeId)),
        ...links,
      ]);
      void queryClient.invalidateQueries({ queryKey: ['ingredientStores'] });
      setBulkDraft(undefined);
      setBulkNames(undefined);
      setBulkResult(`Added ${addedCount} store ${addedCount === 1 ? 'link' : 'links'} for ${names.size} selected ${names.size === 1 ? 'ingredient' : 'ingredients'}.`);
    },
    onError: refreshAssignmentsOnError,
    onSettled: () => { bulkSaveInFlight.current = false; },
  });

  function refreshAssignmentsOnError(error: Error) {
    if (error instanceof StoreAssignmentsChangedError) {
      void queryClient.invalidateQueries({ queryKey: ['meals'] });
      void queryClient.invalidateQueries({ queryKey: ['customIngredients'] });
    }
    void queryClient.invalidateQueries({ queryKey: ['stores'] });
    void queryClient.invalidateQueries({ queryKey: ['ingredientStores'] });
  }

  const deleteIngredient = useMutation({
    networkMode: 'always',
    mutationFn: deleteCustomIngredient,
    onSuccess: (_, name) => {
      queryClient.setQueryData<CustomIngredient[]>(['customIngredients'], (current = []) =>
        current.filter(row => row.name.toLowerCase() !== name),
      );
      queryClient.setQueryData<IngredientStore[]>(['ingredientStores'], (current = []) =>
        current.filter(link => link.ingredientName.toLowerCase() !== name),
      );
      void queryClient.invalidateQueries({ queryKey: ['customIngredients'] });
      void queryClient.invalidateQueries({ queryKey: ['ingredientStores'] });
      returnFocus.current = null;
      setConfirmDelete(undefined);
      setSelection(undefined);
      setDeletedName(name);
    },
    onError: error => {
      if (error instanceof CustomIngredientInUse) {
        void queryClient.invalidateQueries({ queryKey: ['groceryLists'] });
        void queryClient.invalidateQueries({ queryKey: ['meals'] });
      }
    },
  });
  const deleteBlocked = inUse || (deleteIngredient.variables === selectedName && deleteIngredient.error instanceof CustomIngredientInUse);

  useLayoutEffect(() => {
    cancelHold();
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [cancelHold, needle, filter]);

  useLayoutEffect(() => {
    const trigger = selectionTrigger.current;
    if (!trigger) return;
    const list = listRef.current;
    if (isSelecting) {
      const target = trigger === 'select' && list
        ? Array.from(list.querySelectorAll<HTMLButtonElement>('[data-bulk-eligible]')).find(row => rowIsVisible(row, list))
        : trigger === 'select' ? undefined : trigger;
      (target ?? searchRef.current)?.focus({ preventScroll: true });
    } else {
      const target = trigger === 'select' ? selectRef.current : list && rowIsVisible(trigger, list) ? trigger : null;
      (target && !target.disabled ? target : searchRef.current)?.focus({ preventScroll: true });
      selectionTrigger.current = undefined;
    }
  }, [isSelecting]);

  useLayoutEffect(() => {
    if (!bulkPickerOpen && wasBulkPickerOpen.current && isSelecting) {
      (addToStoresRef.current ?? searchRef.current)?.focus({ preventScroll: true });
    }
    wasBulkPickerOpen.current = bulkPickerOpen;
  }, [bulkPickerOpen, isSelecting]);

  useLayoutEffect(() => {
    if (!selection && wasEditing.current) {
      const target = returnFocus.current?.isConnected ? returnFocus.current : searchRef.current;
      target?.focus();
      returnFocus.current = null;
    }
    wasEditing.current = Boolean(selection);
  }, [selection]);

  useLayoutEffect(() => {
    const row = focusedIngredient.current;
    if (row && !row.isConnected) {
      focusedIngredient.current = null;
      if (document.activeElement === document.body && !selection && !bulkPickerOpen) searchRef.current?.focus();
    }
  });

  function enterSelection(trigger: HTMLButtonElement | 'select', name?: string) {
    cancelHold();
    selectionTrigger.current = trigger;
    setBulkResult(undefined);
    setBulkNames(new Set(name === undefined ? [] : [name]));
  }

  function closeBulkPicker() {
    if (!bulkSaveInFlight.current) setBulkDraft(undefined);
  }

  function closePicker() {
    if (!saveStores.isPending && !confirmDelete) setSelection(undefined);
  }

  function closeDelete() {
    if (deleteIngredient.isPending) return;
    setConfirmDelete(undefined);
    requestAnimationFrame(() => (deleteTriggerRef.current ?? editorHeadingRef.current)?.focus());
  }

  return (
    <Box
      component="main"
      sx={{ pb: 4, textAlign: 'left' }}
      onKeyDown={event => {
        if (event.key !== 'Escape' || !isSelecting || managementOpen || selection) return;
        event.preventDefault();
        if (bulkPickerOpen) closeBulkPicker();
        else setBulkNames(undefined);
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2 }}>
        <Typography component="h1" variant="h5">Stores</Typography>
        <Button
          variant="outlined"
          startIcon={<Settings />}
          disabled={storesQuery.isPending || storesQuery.isLoadingError || assignmentsQuery.isPending || assignmentsQuery.isLoadingError || saveStores.isPending || bulkPickerOpen}
          onClick={event => {
            cancelHold();
            event.currentTarget.focus();
            setManagementOpen(true);
          }}
          sx={{ minHeight: 44, '&.Mui-focusVisible': focusOutline }}
        >
          Manage stores
        </Button>
      </Box>

      {deletedName && (
        <Alert severity="success" role="status" sx={{ mb: 2 }} onClose={() => setDeletedName(undefined)}>
          Deleted {capitalize(deletedName)}.
        </Alert>
      )}
      {bulkResult && (
        <Alert severity="success" role="status" sx={{ mb: 2 }} onClose={() => setBulkResult(undefined)}>
          {bulkResult}
        </Alert>
      )}
      <Box role="status" aria-live="polite" aria-atomic="true" sx={{
        position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap',
      }}>
        {bulkNames ? `${bulkNames.size} selected${hiddenPicks ? `, ${hiddenPicks} outside these results` : ''}` : ''}
      </Box>
      {loadError && <Alert severity="error">Could not load stores or ingredients. Try reloading the page.</Alert>}
      {!loadError && loading && <Typography role="status">Loading stores and ingredients…</Typography>}
      {!loadError && !loading && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { md: 'minmax(0, 1.25fr) minmax(0, 1fr)' }, gap: 2, alignItems: 'start' }}>
          <Paper component="section" aria-labelledby={ingredientHeadingId} variant="outlined" sx={{ minWidth: 0 }}>
            <Box sx={{ p: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, mt: -0.75, mb: 0.75 }}>
                <Typography id={ingredientHeadingId} component="h2" variant="h6">Ingredients</Typography>
                {!isSelecting && (
                  <Button
                    ref={selectRef}
                    size="small"
                    startIcon={<Checklist />}
                    disabled={Boolean(selection) || !eligibleResults.length}
                    onClick={() => enterSelection('select')}
                    sx={{ minHeight: 44, '&.Mui-focusVisible': focusOutline }}
                  >
                    Select
                  </Button>
                )}
              </Box>
              <TextField
                fullWidth
                type="search"
                size="small"
                label="Search ingredients"
                inputRef={searchRef}
                disabled={bulkPickerOpen}
                value={search}
                onChange={event => setSearch(event.target.value)}
                slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> } }}
              />
              <ToggleButtonGroup
                aria-label="Filter ingredients"
                value={filter}
                exclusive
                disabled={bulkPickerOpen}
                fullWidth
                size="small"
                onChange={(_, value: Filter | null) => { if (value) setFilter(value); }}
                sx={{ mt: 1.5, '& .MuiToggleButton-root': { textTransform: 'none', flex: 1, minHeight: 44 }, '& .Mui-focusVisible': focusOutline }}
              >
                <ToggleButton value="all" color="primary">All ingredients</ToggleButton>
                <ToggleButton value="unassigned" color="primary">Unassigned</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <Divider />
            {bulkNames && (
              <>
                <Box sx={{ bgcolor: 'action.selected', px: 1.5, pt: 0.75, '& .MuiButton-root': { minHeight: 44 }, '& .Mui-focusVisible': focusOutline }}>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 1 }}>
                    <Typography variant="subtitle2" sx={{ pl: 0.5 }}>{bulkNames.size} selected</Typography>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <Button size="small" disabled={bulkPickerOpen || Boolean(selection)} onClick={() => setBulkNames(undefined)}>Cancel</Button>
                      <Button
                        ref={addToStoresRef}
                        size="small"
                        variant="contained"
                        disableElevation
                        disabled={!bulkNames.size || bulkPickerOpen || Boolean(selection)}
                        aria-haspopup={phone ? 'dialog' : undefined}
                        onClick={() => {
                          saveBulkStores.reset();
                          setBulkDraft(new Set());
                        }}
                      >
                        Add to stores
                      </Button>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
                    <Button
                      size="small"
                      disabled={bulkPickerOpen || Boolean(selection)}
                      aria-disabled={allResultsSelected || undefined}
                      sx={{ '&[aria-disabled="true"]': { color: 'action.disabled', cursor: 'default' } }}
                      onClick={() => {
                        if (!allResultsSelected) setBulkNames(new Set([...bulkNames, ...eligibleResults]));
                      }}
                    >
                      Select all results
                    </Button>
                    {hiddenPicks > 0 && <Typography variant="caption" color="text.secondary">{hiddenPicks} outside these results</Typography>}
                  </Box>
                </Box>
                <Divider />
              </>
            )}
            <Box
              ref={listRef}
              role="region"
              aria-label="Ingredient directory"
              tabIndex={ingredients.length && !bulkPickerOpen ? 0 : undefined}
              sx={{
                '--ingredient-row-height': '61px', maxHeight: 'calc(5 * var(--ingredient-row-height))', overflowY: 'auto',
                overscrollBehaviorY: 'contain', '&:focus-visible': focusOutline,
              }}
            >
              {ingredients.length ? (
                <List disablePadding>
                  {ingredients.map((name, index) => {
                    const eligible = catalog.has(name);
                    const checking = isSelecting && eligible;
                    const checked = checking && Boolean(bulkNames?.has(name));
                    const selected = selection?.name === name;
                    const legacy = !eligible && catalog.has(name.toLowerCase());
                    const summaryId = `${ingredientHeadingId}-ingredient-${index}`;
                    const storeNames = stores.filter(store => storesByIngredient.get(name)?.has(store.id)).map(store => store.name);
                    return (
                      <ListItem key={name} disablePadding divider={index < ingredients.length - 1}>
                        <ListItemButton
                          component="button"
                          type="button"
                          data-bulk-eligible={eligible || undefined}
                          role={checking ? 'checkbox' : undefined}
                          selected={checked || selected}
                          aria-checked={checking ? checked : undefined}
                          aria-label={checking ? capitalize(name) : undefined}
                          aria-describedby={checking ? summaryId : undefined}
                          aria-current={selected || undefined}
                          aria-haspopup={phone && !checking ? 'dialog' : undefined}
                          disabled={bulkPickerOpen || (checking && Boolean(selection))}
                          aria-disabled={saveStores.isPending || undefined}
                          onFocus={event => { focusedIngredient.current = event.currentTarget; }}
                          onBlur={event => {
                            if (event.relatedTarget && event.relatedTarget !== document.body) focusedIngredient.current = null;
                          }}
                          onPointerDown={event => {
                            if (eligible && !isSelecting && !selection) startHold(event, row => enterSelection(row, name));
                          }}
                          onContextMenu={event => event.preventDefault()}
                          onClick={event => {
                            if (selected || saveStores.isPending) return;
                            cancelHold();
                            if (checking) {
                              setBulkNames(current => {
                                const next = new Set(current);
                                if (next.has(name)) next.delete(name);
                                else next.add(name);
                                return next;
                              });
                              return;
                            }
                            returnFocus.current = event.currentTarget;
                            setDeletedName(undefined);
                            setBulkResult(undefined);
                            saveStores.reset();
                            deleteIngredient.reset();
                            setSelection({ name, changes: new Map() });
                          }}
                          sx={{
                            minHeight: 'calc(var(--ingredient-row-height) - 1px)', justifyContent: 'space-between', gap: 1,
                            userSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'pan-y pinch-zoom',
                            '&.Mui-focusVisible': focusOutline,
                          }}
                        >
                          {checking && (checked ? <CheckBox color="primary" /> : <CheckBoxOutlineBlank color="action" />)}
                          <Box component="span" sx={{ display: 'block', flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                            <Typography component="span" display="block">{capitalize(name)}</Typography>
                            <Typography id={summaryId} component="span" display="block" variant="body2" color="text.secondary" noWrap>
                              {isSelecting && !eligible
                                ? `${legacy ? 'Legacy spelling' : 'Saved assignment'} · Single picker only`
                                : `${storeNames.length ? storeNames.join(', ') : 'No stores'}${eligible ? '' : legacy
                                  ? ' · Saved assignment under a legacy spelling' : ' · Saved assignment'}`}
                            </Typography>
                          </Box>
                          {!checking && <ChevronRight color="action" fontSize="small" />}
                        </ListItemButton>
                      </ListItem>
                    );
                  })}
                </List>
              ) : (
                <Typography color="text.secondary" sx={{ p: 2 }}>
                  {needle ? 'No ingredients match this search and filter.' : 'No ingredients match this filter.'}
                </Typography>
              )}
            </Box>
          </Paper>
          {bulkDraft && bulkNames ? (
            <IngredientStorePicker
              key="bulk-picker"
              mode="bulk"
              headingRef={editorHeadingRef}
              phone={phone}
              ingredientCount={bulkNames.size}
              stores={stores}
              linkedCounts={bulkLinkedCounts}
              draft={bulkDraft}
              saving={saveBulkStores.isPending}
              saveError={saveBulkStores.error instanceof StoreAssignmentsChangedError
                ? saveBulkStores.error.message
                : saveBulkStores.isError ? 'Could not add ingredients to stores. Try again.' : undefined}
              onToggle={(storeId, checked) => {
                const next = new Set(bulkDraft);
                if (checked) next.add(storeId);
                else next.delete(storeId);
                setBulkDraft(next);
              }}
              onSave={() => {
                if (bulkSaveInFlight.current || !bulkDraft.size) return;
                bulkSaveInFlight.current = true;
                saveBulkStores.mutate({ names: bulkNames, storeIds: bulkDraft });
              }}
              onClose={closeBulkPicker}
            />
          ) : selection ? (
            <IngredientStorePicker
              key={selection.name}
              headingRef={editorHeadingRef}
              name={capitalize(selection.name)}
              phone={confirmDelete?.phone ?? phone}
              inCatalog={selectedInCatalog}
              stores={editableStores}
              saved={selectedStoreIds}
              changes={selection.changes}
              saving={saveStores.isPending}
              saveError={saveStores.error instanceof StoreAssignmentsChangedError
                ? saveStores.error.message
                : saveStores.isError ? `Could not save stores for ${capitalize(selection.name)}. Try again.` : undefined}
              onToggle={(storeId, checked) => {
                const changes = new Map(selection.changes);
                if (checked === selectedStoreIds.has(storeId)) changes.delete(storeId);
                else changes.set(storeId, checked);
                setSelection({ ...selection, changes });
              }}
              onSave={() => {
                if (!saveStores.isPending && !confirmDelete && selection.changes.size) saveStores.mutate(selection);
              }}
              onClose={closePicker}
              deleteAction={customNames.has(selection.name) && (
                deleteBlocked || listsQuery.isError ? (
                  <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto' }}>
                    {deleteBlocked ? 'Used in a saved list or meal.' : 'Could not check whether this ingredient is in use.'}
                  </Typography>
                ) : listsQuery.isSuccess && (
                  <Button
                    color="error"
                    size={phone ? 'small' : 'medium'}
                    ref={deleteTriggerRef}
                    disabled={saveStores.isPending}
                    sx={{ mr: 'auto', minHeight: 44 }}
                    onClick={() => {
                      deleteIngredient.reset();
                      // Keep the picker portal stable while the confirmation owns focus.
                      setConfirmDelete({ phone });
                    }}
                  >
                    Delete ingredient
                  </Button>
                )
              )}
            />
          ) : !phone && !isSelecting && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography color="text.secondary">Select an ingredient to manage its stores.</Typography>
            </Paper>
          )}
        </Box>
      )}
      {selection && confirmDelete && (
        <Dialog
          open
          onClose={closeDelete}
          disableRestoreFocus
          slotProps={{ transition: { onEntered: () => {
            const cancel = deleteCancelRef.current;
            if (!cancel?.parentElement?.contains(document.activeElement)) cancel?.focus();
          } } }}
          aria-labelledby={deleteTitleId}
          aria-describedby={deleteDescriptionId}
          fullWidth
          maxWidth="xs"
        >
          <DialogTitle id={deleteTitleId} sx={{ overflowWrap: 'anywhere' }}>Delete {capitalize(selection.name)}?</DialogTitle>
          <DialogContent>
            <DialogContentText id={deleteDescriptionId}>Are you sure? This will be permanently delete the ingredient from the app</DialogContentText>
            {deleteIngredient.isError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {deleteIngredient.error instanceof CustomIngredientInUse ? deleteIngredient.error.message : 'Could not delete the ingredient. Try again.'}
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button ref={deleteCancelRef} onClick={closeDelete} disabled={deleteIngredient.isPending}>Cancel</Button>
            <Button
              color="error"
              variant="contained"
              aria-disabled={deleteIngredient.isPending || undefined}
              onClick={() => {
                if (!deleteIngredient.isPending) deleteIngredient.mutate(selection.name);
              }}
            >
              Delete
            </Button>
          </DialogActions>
        </Dialog>
      )}
      <StoreManagementDialog open={managementOpen} onClose={() => setManagementOpen(false)} stores={stores} assignmentCounts={assignmentCounts} />
    </Box>
  );
}
