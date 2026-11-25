import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Box, Button, Checkbox, Divider, FormControl, InputAdornment, InputLabel, List,
  ListItem, ListItemButton, MenuItem, Paper, Select, TextField, ToggleButton,
  ToggleButtonGroup, Typography,
} from '@mui/material';
import Search from '@mui/icons-material/Search';
import Settings from '@mui/icons-material/Settings';
import StoreColorDot from '../components/StoreColorDot';
import StoreManagementDialog from '../components/StoreManagementDialog';
import { db, type IngredientStore } from '../db/db';
import { setStoreAssignment, type AssignmentChange } from '../util/storeAssignments';
import { capitalize } from '../util/string';

const membershipFilters = [
  { value: 'all', label: 'All' },
  { value: 'assigned', label: 'At this store' },
  { value: 'available', label: 'Not assigned' },
] as const;
type MembershipFilter = typeof membershipFilters[number]['value'];
type Notice = { message: string; severity: 'success' | 'info' };
type AssignmentFailure = { message: string; pairKey: string };
type ReversibleEdit = { change: AssignmentChange; storeName: string };

const focusOutline = {
  outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px',
};
const storeNameSx = { display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, overflowWrap: 'anywhere' };
const emptyAssignments: ReadonlySet<string> = new Set();

export default function ManageStoresPage() {
  const queryClient = useQueryClient();
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => db.stores.orderBy('name').toArray(), networkMode: 'always' });
  const mealsQuery = useQuery({ queryKey: ['meals'], queryFn: () => db.meals.toArray(), networkMode: 'always' });
  const customQuery = useQuery({ queryKey: ['customIngredients'], queryFn: () => db.customIngredients.toArray(), networkMode: 'always' });
  const assignmentsQuery = useQuery({ queryKey: ['ingredientStores'], queryFn: () => db.ingredientStores.toArray(), networkMode: 'always' });
  const loading = [storesQuery, mealsQuery, customQuery, assignmentsQuery].some(query => query.isPending);
  const loadError = [storesQuery, mealsQuery, customQuery, assignmentsQuery].some(query => query.isLoadingError);

  const [storeId, setStoreId] = useState<number>();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<MembershipFilter>('all');
  const [managementOpen, setManagementOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [failure, setFailure] = useState<AssignmentFailure | null>(null);
  const [latestEdit, setLatestEdit] = useState<ReversibleEdit | null>(null);
  const pending = useRef(new Set<string>());
  const [pendingPairs, setPendingPairs] = useState<ReadonlySet<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const activeFilterRef = useRef<HTMLButtonElement>(null);
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  const focusedCheckbox = useRef<HTMLInputElement | null>(null);
  const storeLabelId = useId();
  const ingredientHeadingId = useId();
  const storesHeadingId = useId();

  const stores = useMemo(() => (storesQuery.data ?? [])
    .flatMap(store => store.id === undefined ? [] : [{ ...store, id: store.id }])
    .sort((a, b) => a.name.localeCompare(b.name)), [storesQuery.data]);
  const selected = stores.find(store => store.id === storeId) ?? stores.at(0);
  const catalog = useMemo(() => {
    const names = new Set<string>();
    mealsQuery.data?.forEach(meal => meal.ingredients.forEach(ingredient => names.add(ingredient.name.toLowerCase())));
    customQuery.data?.forEach(ingredient => names.add(ingredient.name.toLowerCase()));
    return names;
  }, [mealsQuery.data, customQuery.data]);
  const assignmentsByStore = useMemo(() => {
    const assignments = new Map<number, Set<string>>();
    assignmentsQuery.data?.forEach(({ storeId, ingredientName }) => {
      const names = assignments.get(storeId) ?? new Set<string>();
      names.add(ingredientName);
      assignments.set(storeId, names);
    });
    return assignments;
  }, [assignmentsQuery.data]);
  const assigned = (selected && assignmentsByStore.get(selected.id)) ?? emptyAssignments;
  const needle = search.trim().toLowerCase();
  const ingredients = useMemo(() => [...new Set([...catalog, ...assigned])]
    .filter(name => name.toLowerCase().includes(needle)
      && (filter === 'all' || assigned.has(name) === (filter === 'assigned')))
    .sort((a, b) => a.localeCompare(b)), [assigned, catalog, filter, needle]);

  const selectedId = selected?.id;
  useEffect(() => setStoreId(selectedId), [selectedId]);

  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [selectedId, needle, filter]);

  useLayoutEffect(() => {
    const checkbox = focusedCheckbox.current;
    if (checkbox && !checkbox.isConnected) {
      if (document.activeElement === document.body) activeFilterRef.current?.focus();
      focusedCheckbox.current = null;
    }
  });

  const pairKey = (ingredientName: string, storeId: number) => JSON.stringify([ingredientName, storeId]);

  async function changeAssignment(
    ingredientName: string,
    storeId: number,
    checked: boolean,
    undo?: AssignmentChange,
  ) {
    const key = pairKey(ingredientName, storeId);
    if (pending.current.has(key)) return;
    pending.current.add(key);
    setPendingPairs(new Set(pending.current));
    const previousUndoButton = undoButtonRef.current;

    try {
      const change = await setStoreAssignment({ ingredientName, storeId }, checked, undo);
      if (undo) {
        if (document.activeElement === previousUndoButton) activeFilterRef.current?.focus();
        setLatestEdit(current => current?.change === undo ? null : current);
      }
      if (change) {
        queryClient.setQueryData<IngredientStore[]>(['ingredientStores'], (links = []) => {
          const otherLinks = links.filter(link => link.ingredientName !== ingredientName || link.storeId !== storeId);
          return change.assigned ? [...otherLinks, { id: change.id, ingredientName, storeId }] : otherLinks;
        });
        if (!undo) {
          const storeName = stores.find(store => store.id === storeId)?.name ?? 'store';
          setLatestEdit({ change, storeName });
        }
      }
      const status: Notice | null = !change
        ? { severity: 'info', message: 'This assignment has already changed.' }
        : undo ? { severity: 'success', message: 'Change undone.' } : null;
      setNotice(status);
      setFailure(current => current?.pairKey === key ? null : current);
      void queryClient.invalidateQueries({ queryKey: ['ingredientStores'] });
    } catch {
      setNotice(null);
      setFailure({
        message: `Could not save the assignment for ${capitalize(ingredientName)}. Try again.`,
        pairKey: key,
      });
    } finally {
      pending.current.delete(key);
      setPendingPairs(new Set(pending.current));
    }
  }

  const undoEdit = latestEdit && stores.some(store => store.id === latestEdit.change.storeId) ? latestEdit : null;
  const feedback = (
    <>
      {failure && (
        <Alert severity="error" onClose={() => setFailure(null)} sx={{ mt: 1.5, overflowWrap: 'anywhere' }}>
          {failure.message}
        </Alert>
      )}
      {notice && (
        <Alert
          severity={notice.severity}
          role="status"
          onClose={() => setNotice(null)}
          sx={{ mt: 1.5 }}
        >
          {notice.message}
        </Alert>
      )}
      {undoEdit && (
        <Alert
          severity="success"
          role="status"
          sx={{ mt: 1.5, overflowWrap: 'anywhere' }}
          action={(
            <Button
              ref={undoButtonRef}
              color="inherit"
              size="small"
              aria-disabled={pendingPairs.has(pairKey(undoEdit.change.ingredientName, undoEdit.change.storeId)) || undefined}
              onClick={() => {
                const { change } = undoEdit;
                void changeAssignment(change.ingredientName, change.storeId, !change.assigned, change);
              }}
              sx={{ '&:focus-visible': focusOutline }}
            >
              Undo
            </Button>
          )}
        >
          {undoEdit.change.assigned ? `Added to ${undoEdit.storeName}.` : `Removed from ${undoEdit.storeName}.`}
        </Alert>
      )}
    </>
  );

  return (
    <Box component="main" sx={{ pb: 4, textAlign: 'left' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2 }}>
        <Typography component="h1" variant="h5">Stores</Typography>
        <Button
          variant="outlined"
          startIcon={<Settings />}
          disabled={storesQuery.isPending || storesQuery.isLoadingError || assignmentsQuery.isPending || assignmentsQuery.isLoadingError}
          onClick={() => setManagementOpen(true)}
          sx={{ minHeight: 44, '&:focus-visible': focusOutline }}
        >
          Manage stores
        </Button>
      </Box>

      {loadError && <Alert severity="error">Could not load stores or ingredients. Try reloading the page.</Alert>}
      {!loadError && loading && <Typography role="status">Loading stores and ingredients…</Typography>}
      {!loadError && !loading && !selected && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography>Add a store to start assigning ingredients.</Typography>
        </Paper>
      )}
      {!loadError && !loading && selected && (
        <>
          <FormControl size="small" fullWidth sx={{ display: { xs: 'flex', sm: 'none' }, mb: 2 }}>
            <InputLabel id={storeLabelId}>Store</InputLabel>
            <Select
              labelId={storeLabelId}
              label="Store"
              value={selected.id}
              onChange={event => setStoreId(Number(event.target.value))}
              sx={{ minHeight: 44 }}
            >
              {stores.map(store => (
                <MenuItem key={store.id} value={store.id}>
                  <Box component="span" sx={storeNameSx}>
                    <StoreColorDot color={store.color} /><span>{store.name}</span>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Box sx={{ display: 'grid', gridTemplateColumns: { sm: 'minmax(168px, 30%) minmax(0, 1fr)' }, gap: 2, alignItems: 'start' }}>
            <Paper
              component="aside"
              variant="outlined"
              aria-labelledby={storesHeadingId}
              sx={{ display: { xs: 'none', sm: 'block' } }}
            >
              <Typography id={storesHeadingId} component="h2" sx={{ p: 2, fontWeight: 600 }}>Stores</Typography>
              <Divider />
              <List disablePadding>
                {stores.map(store => (
                  <ListItem key={store.id} disablePadding>
                    <ListItemButton
                      component="button"
                      type="button"
                      selected={selected.id === store.id}
                      aria-pressed={selected.id === store.id}
                      onClick={() => setStoreId(store.id)}
                      sx={{ minHeight: 48, gap: 1, justifyContent: 'space-between', '&.Mui-focusVisible': focusOutline }}
                    >
                      <Box component="span" sx={storeNameSx}>
                        <StoreColorDot color={store.color} /><span>{store.name}</span>
                      </Box>
                      <Typography component="span" variant="body2" color="text.secondary">
                        {assignmentsByStore.get(store.id)?.size ?? 0}
                      </Typography>
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            </Paper>
            <Box sx={{ minWidth: 0 }}>
              <Paper component="section" aria-labelledby={ingredientHeadingId} variant="outlined">
                <Box sx={{ p: 2 }}>
                  <Typography
                    id={ingredientHeadingId}
                    component="h2"
                    variant="h6"
                    sx={{ display: { xs: 'none', sm: 'block' }, overflowWrap: 'anywhere' }}
                  >
                    {selected.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {assigned.size} {assigned.size === 1 ? 'ingredient' : 'ingredients'} assigned
                  </Typography>
                  <TextField
                    fullWidth
                    type="search"
                    size="small"
                    label="Search ingredients"
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> } }}
                    sx={{ mt: 1.5 }}
                  />
                  <ToggleButtonGroup
                    aria-label="Filter by store membership"
                    value={filter}
                    exclusive
                    fullWidth
                    size="small"
                    onChange={(_, value: MembershipFilter | null) => { if (value) setFilter(value); }}
                    sx={{ mt: 1.5, '& .MuiToggleButton-root': { textTransform: 'none', flex: 1, minHeight: 44, lineHeight: 1.25 }, '& .Mui-focusVisible': focusOutline }}
                  >
                    {membershipFilters.map(option => (
                      <ToggleButton
                        key={option.value}
                        value={option.value}
                        ref={filter === option.value ? activeFilterRef : undefined}
                        color="primary"
                      >
                        {option.label}
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                </Box>
                <Divider />
                <Box
                  ref={listRef}
                  role="region"
                  aria-label="Ingredient checklist"
                  tabIndex={ingredients.length ? 0 : undefined}
                  sx={{
                    '--ingredient-row-height': '53px',
                    maxHeight: 'calc(5 * var(--ingredient-row-height))',
                    overflowY: 'auto',
                    overscrollBehaviorY: 'contain',
                    '&:focus-visible': focusOutline,
                  }}
                >
                  {ingredients.length ? (
                    <List disablePadding>
                      {ingredients.map((name, index) => (
                        <ListItem key={name} disablePadding divider={index < ingredients.length - 1}>
                          <Box
                            component="label"
                            sx={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
                              minHeight: 'calc(var(--ingredient-row-height) - 1px)', boxSizing: 'border-box', width: '100%',
                              pl: 2, pr: 1, py: 0.5, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' },
                              '&:has(input:focus-visible)': focusOutline,
                            }}
                          >
                            <Box component="span" sx={{ overflowWrap: 'anywhere' }}>
                              <Typography component="span">{capitalize(name)}</Typography>
                              {!catalog.has(name) && (
                                <Typography component="span" display="block" variant="caption" color="text.secondary">
                                  Saved assignment
                                </Typography>
                              )}
                            </Box>
                            <Checkbox
                              checked={assigned.has(name)}
                              slotProps={{ input: {
                                'aria-label': `${capitalize(name)} at ${selected.name}`,
                                'aria-disabled': pendingPairs.has(pairKey(name, selected.id)) || undefined,
                                onFocus: (event: React.FocusEvent<HTMLInputElement>) => {
                                  focusedCheckbox.current = event.currentTarget;
                                },
                                onBlur: (event: React.FocusEvent<HTMLInputElement>) => {
                                  if (event.relatedTarget && event.relatedTarget !== document.body) {
                                    focusedCheckbox.current = null;
                                  }
                                },
                              } }}
                              onChange={(_, checked) => void changeAssignment(name, selected.id, checked)}
                              sx={{ width: 44, height: 44, flexShrink: 0 }}
                            />
                          </Box>
                        </ListItem>
                      ))}
                    </List>
                  ) : (
                    <Typography color="text.secondary" sx={{ p: 2 }}>
                      {needle ? 'No ingredients match this search and filter.' : 'No ingredients match this filter.'}
                    </Typography>
                  )}
                </Box>
              </Paper>
              {feedback}
            </Box>
          </Box>
        </>
      )}

      <StoreManagementDialog
        open={managementOpen}
        onClose={() => setManagementOpen(false)}
        stores={stores}
        assignmentsByStore={assignmentsByStore}
      />
    </Box>
  );
}
