import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useEffect, useMemo, useState } from 'react';
import { Link, useBlocker, useNavigate } from '@tanstack/react-router';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import PushPinIcon from '@mui/icons-material/PushPin';
import EditIcon from '@mui/icons-material/Edit';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloseIcon from '@mui/icons-material/Close';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { useAdvancedRestaurantFields, useRestaurants } from '../hooks/useRestaurants';
import {
  archivePerson,
  compareName,
  deleteDish,
  deleteRestaurant,
  dietaryDisplay,
  dishScore,
  erasePerson,
  rankedDishes,
  ratingSummary,
  saveDish,
  savePerson,
  saveRestaurant,
  seedRestaurantTags,
  selectRestaurants,
  setPinned,
  type RestaurantFilters,
} from '../db/restaurants';
import type {
  OwnedImage,
  Person,
  Restaurant,
  RestaurantItem,
  RestaurantItemRating,
  RestaurantTag,
} from '../shareable/restaurants';
import {
  categories,
  dietaryFlags,
  itemSchema,
  normalizeLocation,
  restaurantSchema,
  spices,
} from '../types/restaurants';
import { cacheImage } from '../db/image-cache';
import { convertFilesToImageBlobs } from '../util/images';
import { IMAGE_LIMITS, IMAGE_MIME_TYPES, type ImageMimeType } from '../shareable/image-assets';
import { useToast } from '../hooks/useToast';
import StoredImage from '../components/StoredImage';

const fieldsGrid = { display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 };
const multiline = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const;
const emptyFilters: RestaurantFilters = {
  search: '',
  tags: [],
  threshold: false,
  minimum: 8,
  sort: 'name',
};
let retainedFilters = { ...emptyFilters };
const now = () => new Date().toISOString();
const newRestaurant = (): Restaurant => ({
  name: '',
  notes: '',
  tags: [],
  isPinned: false,
  countryKey: '',
  regionKey: '',
  cityKey: '',
  createdAt: now(),
  updatedAt: now(),
});
const newDish = (restaurantId: number): RestaurantItem => ({
  restaurantId,
  name: '',
  description: '',
  notes: '',
  images: [],
  dietaryFlags: [],
  createdAt: now(),
  updatedAt: now(),
});
const orderedTags = (tags: RestaurantTag[]) =>
  [...tags].sort(
    (a, b) =>
      ['cuisine', 'dietary', 'price', 'service', 'occasion', 'custom'].indexOf(a.group) -
        ['cuisine', 'dietary', 'price', 'service', 'occasion', 'custom'].indexOf(b.group) ||
      a.name.localeCompare(b.name)
  );
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const errorText = (error: unknown) =>
  error instanceof z.ZodError
    ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    : error instanceof Error
      ? error.message
      : 'Save failed';
function Pin({
  restaurant,
  onError,
}: {
  restaurant: Restaurant;
  onError: (message: string) => void;
}) {
  return (
    <IconButton
      aria-label={`${restaurant.isPinned ? 'Unpin' : 'Pin'} ${restaurant.name}`}
      color={restaurant.isPinned ? 'primary' : 'default'}
      onClick={() =>
        void setPinned(restaurant.id!, !restaurant.isPinned).catch((e) => onError(errorText(e)))
      }
    >
      <PushPinIcon />
    </IconButton>
  );
}
function Basis({
  people,
  value,
  onChange,
}: {
  people: Person[];
  value?: number;
  onChange: (id?: number) => void;
}) {
  const [includeArchived, setIncludeArchived] = useState(false);
  return (
    <Box>
      <TextField
        select
        fullWidth
        size="small"
        label="Rating basis"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
      >
        <MenuItem value="">Household</MenuItem>
        {people
          .filter((p) => p.status === 'active' || includeArchived || p.id === value)
          .map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name}
              {p.status === 'archived' ? ' (Archived)' : ''}
            </MenuItem>
          ))}
      </TextField>
      {people.some((p) => p.status === 'archived') && (
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
          }
          label="Include archived"
        />
      )}
    </Box>
  );
}
function Photo({
  image,
  name,
  onClick,
  width = '90px',
}: {
  image: OwnedImage;
  name: string;
  onClick: () => void;
  width?: string;
}) {
  return (
    <Button
      aria-label={`Enlarge ${name} photo`}
      onClick={onClick}
      sx={{ minWidth: 0, p: 0, alignSelf: 'start' }}
    >
      <StoredImage
        loading="lazy"
        image={image}
        alt={`${name} photo`}
        width={width}
        style={{ objectFit: 'cover', maxHeight: 120, borderRadius: 4 }}
      />
    </Button>
  );
}
function Enlarged({
  image,
  onClose,
  name,
}: {
  image: OwnedImage | null;
  onClose: () => void;
  name: string;
}) {
  return (
    <Dialog open={!!image} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {name}
        <IconButton aria-label="Close photo" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {image && (
          <StoredImage image={image} alt={`${name} enlarged photo`} style={{ maxWidth: '100%' }} />
        )}
      </DialogContent>
    </Dialog>
  );
}
function DirtyGuard({ dirty }: { dirty: boolean }) {
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: dirty,
    withResolver: true,
  });
  return (
    <Dialog open={blocker.status === 'blocked'} onClose={() => blocker.reset?.()}>
      <DialogTitle>Discard unsaved changes?</DialogTitle>
      <DialogActions>
        <Button onClick={() => blocker.reset?.()}>Keep editing</Button>
        <Button onClick={() => blocker.proceed?.()}>Discard</Button>
      </DialogActions>
    </Dialog>
  );
}
function EditorActions({
  saving,
  onDiscard,
  label,
}: {
  saving: boolean;
  onDiscard: () => void;
  label: string;
}) {
  return (
    <Paper
      elevation={3}
      sx={{
        position: 'fixed',
        left: 0,
        right: 0,
        borderTop: 1,
        borderColor: 'divider',
        bottom: 0,
        mt: 2,
        p: 1,
        display: 'flex',
        gap: 1,
        justifyContent: 'flex-end',
        zIndex: 2,
      }}
    >
      <Button disabled={saving} onClick={onDiscard}>
        Discard
      </Button>
      <Button variant="contained" type="submit" disabled={saving}>
        {label}
      </Button>
    </Paper>
  );
}
function Tags({ tags, ids }: { tags: RestaurantTag[]; ids: number[] }) {
  const names = ids
    .map((id) => tags.find((t) => t.id === id)?.name)
    .filter((v): v is string => !!v);
  return (
    <Stack direction="row" gap={0.5} flexWrap="wrap">
      {names
        .filter(
          (name) =>
            !(
              (names.includes('Only vegan') &&
                ['Only vegetarian', 'Vegan options', 'Vegetarian options'].includes(name)) ||
              (names.includes('Only vegetarian') && name === 'Vegetarian options') ||
              (names.includes('Vegan options') && name === 'Vegetarian options')
            )
        )
        .map((name) => (
          <Chip key={name} size="small" variant="outlined" label={name} />
        ))}
    </Stack>
  );
}
function RestaurantEditor({
  initial,
  restaurants,
  tags,
  onDone,
}: {
  initial: Restaurant;
  restaurants: Restaurant[];
  tags: RestaurantTag[];
  onDone: (id?: number) => void;
}) {
  const form = useForm<Restaurant>({
    defaultValues: structuredClone(initial),
    shouldUnregister: false,
  });
  const draft = form.watch();
  const [tagNames, setTagNames] = useState(
    initial.tags.map((id) => tags.find((t) => t.id === id)?.name ?? '')
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [discard, setDiscard] = useState(false);
  const { showSuccessToast } = useToast();
  const dirty =
    form.formState.isDirty ||
    JSON.stringify(tagNames) !==
      JSON.stringify(initial.tags.map((id) => tags.find((t) => t.id === id)?.name ?? ''));
  const change = <K extends keyof Restaurant>(field: K, value: Restaurant[K]) =>
    form.setValue(field, value as never, { shouldDirty: true });
  const text = (
    field: 'name' | 'notes' | 'address' | 'googleMapsUrl',
    label: string,
    lines = 1
  ) => (
    <TextField
      fullWidth
      label={label}
      required={field === 'name'}
      value={draft[field] ?? ''}
      onChange={(e) =>
        change(field, e.target.value || (field === 'name' || field === 'notes' ? '' : undefined))
      }
      multiline={lines > 1}
      minRows={lines}
    />
  );
  const suggestions = (field: 'country' | 'region' | 'city') =>
    [
      ...new Set(
        restaurants
          .filter((r) => field === 'country' || r.countryKey === normalizeLocation(draft.country))
          .filter((r) => field !== 'city' || r.regionKey === normalizeLocation(draft.region))
          .map((r) => r[field])
          .filter((v): v is string => !!v)
      ),
    ].sort();
  const save = form.handleSubmit(async (value) => {
    setSaving(true);
    setError('');
    try {
      const row = {
        ...value,
        name: value.name.trim(),
        country: value.country?.trim() || undefined,
        region: value.region?.trim() || undefined,
        city: value.city?.trim() || undefined,
        countryKey: normalizeLocation(value.country),
        regionKey: normalizeLocation(value.region),
        cityKey: normalizeLocation(value.city),
      };
      restaurantSchema.parse(row);
      const id = await saveRestaurant(row, tagNames);
      form.reset(row);
      showSuccessToast('Restaurant saved');
      onDone(id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  });
  return (
    <Box component="form" onSubmit={save} sx={{ textAlign: 'left', pb: 10 }}>
      <DirtyGuard dirty={dirty && !saving} />
      <Typography variant="h5" sx={{ mb: 2 }}>
        {initial.id ? 'Edit restaurant' : 'Create restaurant'}
      </Typography>
      {error && (
        <Alert severity="error" role="alert" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {restaurants.some(
        (r) =>
          r.id !== initial.id && r.name.trim().toLowerCase() === draft.name.trim().toLowerCase()
      ) && (
        <Alert severity="warning">
          A restaurant with this name already exists. Different branches can share a name.
        </Alert>
      )}
      <Stack gap={2}>
        {text('name', 'Restaurant name')}
        <Autocomplete
          multiple
          freeSolo
          options={orderedTags(tags).map((t) => t.name)}
          groupBy={(name) => titleCase(tags.find((t) => t.name === name)?.group ?? 'custom')}
          value={tagNames}
          onChange={(_, values) => setTagNames(values)}
          renderInput={(p) => (
            <TextField
              {...p}
              label="Restaurant tags"
              helperText="Choose at most one price tag. Only vegan also matches Only vegetarian and vegan/vegetarian options."
            />
          )}
        />
        {text('notes', 'General notes', 3)}
        <Box sx={fieldsGrid}>
          {(['country', 'region', 'city'] as const).map((field) => (
            <Autocomplete
              key={field}
              freeSolo
              options={suggestions(field)}
              inputValue={draft[field] ?? ''}
              onInputChange={(_, value) => change(field, value || undefined)}
              renderInput={(p) => (
                <TextField
                  {...p}
                  label={field === 'region' ? 'State / region' : titleCase(field)}
                />
              )}
            />
          ))}
          {text('address', 'Address', 2)}
          {(['latitude', 'longitude'] as const).map((field) => (
            <TextField
              key={field}
              label={titleCase(field)}
              type="number"
              value={draft[field] ?? ''}
              onChange={(e) =>
                change(field, e.target.value === '' ? undefined : Number(e.target.value))
              }
              slotProps={{ htmlInput: { step: 'any' } }}
            />
          ))}
          {text('googleMapsUrl', 'Google Maps link')}
        </Box>
        <Typography variant="caption">
          Country changes retain the draft state and city for review. Both coordinates are required
          together; no map lookup runs.
        </Typography>
      </Stack>
      <EditorActions
        saving={saving}
        onDiscard={() => (dirty ? setDiscard(true) : onDone())}
        label="Save restaurant"
      />
      <Dialog open={discard} onClose={() => setDiscard(false)}>
        <DialogTitle>Discard unsaved changes?</DialogTitle>
        <DialogActions>
          <Button onClick={() => setDiscard(false)}>Keep editing</Button>
          <Button onClick={() => onDone()}>Discard changes</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
export function DishEditor({
  initial,
  opinions,
  people,
  restaurantName,
  startTab = 0,
  onDone,
}: {
  initial: RestaurantItem;
  opinions: RestaurantItemRating[];
  people: Person[];
  restaurantName: string;
  startTab?: number;
  onDone: () => void;
}) {
  const form = useForm<RestaurantItem>({
    defaultValues: structuredClone(initial),
    shouldUnregister: false,
  });
  const draft = form.watch();
  const [ratings, setRatings] = useState(() => structuredClone(opinions));
  const [tab, setTab] = useState(startTab);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [enlarged, setEnlarged] = useState<OwnedImage | null>(null);
  const [personName, setPersonName] = useState<string | null>(null);
  const [personError, setPersonError] = useState('');
  const advanced = useAdvancedRestaurantFields();
  const { showSuccessToast } = useToast();
  const dirty = form.formState.isDirty || JSON.stringify(ratings) !== JSON.stringify(opinions);
  const change = <K extends keyof RestaurantItem>(field: K, value: RestaurantItem[K]) =>
    form.setValue(field, value as never, { shouldDirty: true });
  const text = (
    field:
      | 'name'
      | 'description'
      | 'notes'
      | 'modifiers'
      | 'priceAmount'
      | 'currency'
      | 'portion'
      | 'lastOrderedDate',
    label: string,
    lines = 1
  ) => (
    <TextField
      fullWidth
      label={label}
      required={field === 'name'}
      type={field === 'lastOrderedDate' ? 'date' : 'text'}
      value={draft[field] ?? ''}
      onChange={(e) =>
        change(
          field,
          e.target.value || (['name', 'description', 'notes'].includes(field) ? '' : undefined)
        )
      }
      multiline={lines > 1}
      minRows={lines}
      slotProps={field === 'lastOrderedDate' ? { inputLabel: { shrink: true } } : undefined}
    />
  );
  const setImages = (images: OwnedImage[], cover?: number) => {
    change('images', images);
    change('coverImageIndex', images.length ? (cover ?? 0) : undefined);
  };
  const upload = async (files: File[]) => {
    setPreparing(true);
    setError('');
    try {
      if (draft.images.length + files.length > 10) throw new Error('At most 10 photos');
      const refs: OwnedImage[] = [];
      for (const file of files) {
        if (!IMAGE_MIME_TYPES.includes(file.type as ImageMimeType))
          throw new Error('Use JPEG, PNG or WebP photos');
        const [compressed] = await convertFilesToImageBlobs([file]);
        if (!compressed.size || compressed.size > IMAGE_LIMITS.byteLength)
          throw new Error('Photo exceeds 4 MiB');
        const bitmap = await createImageBitmap(compressed);
        try {
          if (
            bitmap.width > IMAGE_LIMITS.dimension ||
            bitmap.height > IMAGE_LIMITS.dimension ||
            bitmap.width * bitmap.height > IMAGE_LIMITS.pixels
          )
            throw new Error('Photo dimensions exceed supported limits');
        } finally {
          bitmap.close();
        }
        refs.push(await cacheImage(compressed));
      }
      const current = form.getValues();
      if (current.images.length + refs.length > 10) throw new Error('At most 10 photos');
      setImages([...current.images, ...refs], current.coverImageIndex);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPreparing(false);
    }
  };
  const save = form.handleSubmit(async (value) => {
    setSaving(true);
    setError('');
    try {
      const row = { ...value, name: value.name.trim() };
      itemSchema.parse(row);
      await saveDish(row, ratings);
      form.reset(row);
      showSuccessToast('Dish saved');
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  });
  const opinion = (index: number, changes: Partial<RestaurantItemRating>) =>
    setRatings((rows) => rows.map((r, i) => (i === index ? { ...r, ...changes } : r)));
  return (
    <Box component="form" onSubmit={save} sx={{ textAlign: 'left', pb: 10 }}>
      <DirtyGuard dirty={dirty && !saving} />
      <Typography variant="h5">{initial.id ? 'Edit dish' : 'Add dish'}</Typography>
      <Typography color="text.secondary">{restaurantName}</Typography>
      <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ mb: 3 }}>
        <Tab label="Details" />
        <Tab label="Opinions" />
      </Tabs>
      {error && (
        <Alert severity="error" role="alert" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {tab === 0 && (
        <Box sx={fieldsGrid}>
          <Stack gap={2}>
            {text('name', 'Dish name')}
            {text('description', 'Description', 3)}
            <Typography>Photos · {draft.images.length} of 10</Typography>
            <Stack direction="row" gap={1} flexWrap="wrap">
              {draft.images.map((image, index) => (
                <Box key={index}>
                  <Photo
                    image={image}
                    name={draft.name || 'Dish'}
                    onClick={() => setEnlarged(image)}
                    width="112px"
                  />
                  <Typography variant="caption" display="block">
                    {index === (draft.coverImageIndex ?? 0) ? 'Cover' : `Photo ${index + 1}`}
                  </Typography>
                  <IconButton
                    size="small"
                    aria-label={`Remove photo ${index + 1}`}
                    onClick={() => {
                      const cover = draft.coverImageIndex ?? 0;
                      setImages(
                        draft.images.filter((_, i) => i !== index),
                        cover === index
                          ? index % (draft.images.length - 1 || 1)
                          : cover > index
                            ? cover - 1
                            : cover
                      );
                    }}
                  >
                    <CloseIcon />
                  </IconButton>
                  <Button
                    size="small"
                    onClick={() => change('coverImageIndex', index)}
                    aria-label={`Use photo ${index + 1} as cover`}
                  >
                    Cover
                  </Button>
                  <Button
                    size="small"
                    disabled={index === 0}
                    aria-label={`Move photo ${index + 1} earlier`}
                    onClick={() => {
                      const images = [...draft.images];
                      [images[index - 1], images[index]] = [images[index], images[index - 1]];
                      const cover = draft.coverImageIndex ?? 0;
                      setImages(
                        images,
                        cover === index ? index - 1 : cover === index - 1 ? index : cover
                      );
                    }}
                  >
                    Earlier
                  </Button>
                </Box>
              ))}
            </Stack>
            <Stack direction="row" gap={1}>
              <Button component="label" disabled={preparing}>
                Upload
                <input
                  aria-label="Upload dish photos"
                  type="file"
                  hidden
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    void upload(Array.from(e.target.files ?? []));
                    e.target.value = '';
                  }}
                />
              </Button>
              <Button component="label" disabled={preparing}>
                Camera
                <input
                  aria-label="Camera dish photo"
                  type="file"
                  hidden
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    void upload(Array.from(e.target.files ?? []));
                    e.target.value = '';
                  }}
                />
              </Button>
            </Stack>
            {preparing && <Typography role="status">Preparing photos…</Typography>}
            {text('notes', 'Personal notes', 3)}
          </Stack>
          <Stack gap={2}>
            {text('modifiers', 'Ordering modifiers', 3)}
            <TextField
              fullWidth
              select
              label="Category"
              value={draft.category ?? 'unknown'}
              onChange={(e) => change('category', e.target.value as RestaurantItem['category'])}
            >
              {categories.map((v) => (
                <MenuItem key={v} value={v}>
                  {titleCase(v)}
                </MenuItem>
              ))}
            </TextField>
            <Typography>Dietary observations</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              {dietaryFlags.map((flag) => (
                <FormControlLabel
                  key={flag}
                  control={
                    <Checkbox
                      checked={draft.dietaryFlags.includes(flag)}
                      onChange={(e) =>
                        change(
                          'dietaryFlags',
                          e.target.checked
                            ? [...draft.dietaryFlags, flag]
                            : draft.dietaryFlags.filter((f) => f !== flag)
                        )
                      }
                    />
                  }
                  label={titleCase(flag)}
                />
              ))}
            </Box>
            <Typography variant="caption">
              Vegan implies Vegetarian. These are observations, not allergy assurances.
            </Typography>
            {text('lastOrderedDate', 'Last ordered')}
            {advanced && (
              <>
                <Typography>Additional ordering details</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                  {text('priceAmount', 'Price')}
                  {text('currency', 'Currency')}
                </Box>
                {text('portion', 'Size / portion')}
                <TextField
                  fullWidth
                  select
                  label="Spice"
                  value={draft.spiceLevel ?? 'unknown'}
                  onChange={(e) =>
                    change('spiceLevel', e.target.value as RestaurantItem['spiceLevel'])
                  }
                >
                  {spices.map((v) => (
                    <MenuItem key={v} value={v}>
                      {titleCase(v)}
                    </MenuItem>
                  ))}
                </TextField>
              </>
            )}
          </Stack>
        </Box>
      )}
      {tab === 1 && (
        <Stack gap={2}>
          <Typography color="text.secondary">
            One current opinion per person. Scores use half points from 1 to 10.
          </Typography>
          {ratings.map((r, index) => (
            <Paper key={index} variant="outlined" sx={{ p: 1.5 }}>
              <Stack gap={1}>
                <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 1 }}>
                  <TextField
                    select
                    fullWidth
                    label="Person"
                    value={r.personId || ''}
                    onChange={(e) => opinion(index, { personId: Number(e.target.value) })}
                  >
                    <MenuItem value="">Choose person</MenuItem>
                    {people
                      .filter((p) => p.status === 'active' || p.id === r.personId)
                      .map((p) => (
                        <MenuItem key={p.id} value={p.id}>
                          {p.name}
                          {p.status === 'archived' ? ' (Archived)' : ''}
                        </MenuItem>
                      ))}
                  </TextField>
                  <TextField
                    label="Score / 10"
                    type="number"
                    value={Number.isFinite(r.score) ? r.score : ''}
                    onChange={(e) =>
                      opinion(index, {
                        score: e.target.value === '' ? NaN : Number(e.target.value),
                      })
                    }
                    slotProps={{ htmlInput: { min: 1, max: 10, step: 0.5 } }}
                  />
                </Box>
                <TextField
                  label="Comment"
                  multiline
                  value={r.comment ?? ''}
                  onChange={(e) => opinion(index, { comment: e.target.value })}
                />
                <TextField
                  select
                  label="Would order again"
                  value={r.wouldOrderAgain ?? 'undecided'}
                  onChange={(e) =>
                    opinion(index, {
                      wouldOrderAgain: e.target.value as RestaurantItemRating['wouldOrderAgain'],
                    })
                  }
                >
                  {['yes', 'no', 'undecided'].map((v) => (
                    <MenuItem key={v} value={v}>
                      {titleCase(v)}
                    </MenuItem>
                  ))}
                </TextField>
                <Button
                  color="error"
                  onClick={() => setRatings((rows) => rows.filter((_, i) => i !== index))}
                >
                  Remove rating
                </Button>
              </Stack>
            </Paper>
          ))}
          <Stack direction="row" gap={1}>
            <Button
              variant="outlined"
              onClick={() =>
                setRatings((rows) => [
                  ...rows,
                  {
                    itemId: initial.id ?? 1,
                    personId: 0,
                    score: NaN,
                    createdAt: now(),
                    updatedAt: now(),
                  },
                ])
              }
            >
              Add rating
            </Button>
            <Button
              variant="outlined"
              onClick={() => {
                setPersonError('');
                setPersonName('');
              }}
            >
              Add person
            </Button>
          </Stack>
        </Stack>
      )}
      <EditorActions
        saving={saving || preparing}
        onDiscard={() => (dirty ? setDiscard(true) : onDone())}
        label="Save dish"
      />
      <Dialog open={discard} onClose={() => setDiscard(false)}>
        <DialogTitle>Discard unsaved changes?</DialogTitle>
        <DialogActions>
          <Button onClick={() => setDiscard(false)}>Keep editing</Button>
          <Button onClick={onDone}>Discard changes</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={personName !== null} onClose={() => setPersonName(null)}>
        <DialogTitle>Add person</DialogTitle>
        <DialogContent>
          {personError && (
            <Alert severity="error" role="alert">
              {personError}
            </Alert>
          )}
          {people.some(
            (p) => p.status === 'archived' && p.normalizedName === personName?.trim().toLowerCase()
          ) && (
            <Alert severity="info">
              This name is archived. Restore the same person to reuse existing ratings.
            </Alert>
          )}
          <TextField
            autoFocus
            label="Person name"
            value={personName ?? ''}
            onChange={(e) => setPersonName(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPersonName(null)}>Cancel</Button>
          <Button
            onClick={async () => {
              try {
                await savePerson(personName ?? '');
                setPersonName(null);
              } catch (e) {
                setPersonError(errorText(e));
              }
            }}
          >
            Save person
          </Button>
          {people.some(
            (p) => p.status === 'archived' && p.normalizedName === personName?.trim().toLowerCase()
          ) && (
            <Button
              onClick={async () => {
                try {
                  await savePerson(personName ?? '', undefined, true);
                  setPersonName(null);
                } catch (e) {
                  setPersonError(errorText(e));
                }
              }}
            >
              Restore person
            </Button>
          )}
        </DialogActions>
      </Dialog>
      <Enlarged image={enlarged} onClose={() => setEnlarged(null)} name={draft.name || 'Dish'} />
    </Box>
  );
}
function People({
  people,
  ratings,
  onClose,
}: {
  people: Person[];
  ratings: RestaurantItemRating[];
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<number>();
  const act = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setError('');
      setName('');
      setEditing(undefined);
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Dialog open onClose={onClose} fullWidth>
      <DialogTitle>Manage people</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error">{error}</Alert>}
        <Stack gap={2}>
          {people.map((p) => (
            <Paper key={p.id} variant="outlined" sx={{ p: 1 }}>
              <Typography>
                {p.name}
                {p.status === 'archived' ? ' · Archived' : ''} ·{' '}
                {ratings.filter((r) => r.personId === p.id).length} ratings
              </Typography>
              <Stack direction="row" flexWrap="wrap">
                <Button
                  onClick={() => {
                    setEditing(p.id);
                    setName(p.name);
                  }}
                >
                  Rename
                </Button>
                <Button
                  onClick={() => void act(() => archivePerson(p.id!, p.status !== 'archived'))}
                >
                  {p.status === 'archived' ? 'Restore' : 'Archive'}
                </Button>
                <Button
                  color="error"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Erase ${p.name} and ${ratings.filter((r) => r.personId === p.id).length} ratings? Earlier exports and published snapshots cannot be erased.`
                      )
                    )
                      void act(() => erasePerson(p.id!));
                  }}
                >
                  Erase person and ratings
                </Button>
              </Stack>
            </Paper>
          ))}
          <TextField label="Person name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button onClick={() => void act(() => savePerson(name, editing))}>
            {editing ? 'Save name' : 'Add person'}
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
export default function Restaurants({ restaurantId }: { restaurantId?: number }) {
  const navigate = useNavigate();
  const query = useRestaurants();
  const advanced = useAdvancedRestaurantFields();
  const { showErrorToast } = useToast();
  const [filters, setFilters] = useState<RestaurantFilters>(() => retainedFilters);
  const [drawer, setDrawer] = useState(false);
  const [restaurantDraft, setRestaurantDraft] = useState<Restaurant | null>(null);
  const [dishDraft, setDishDraft] = useState<{
    item: RestaurantItem;
    tab: number;
    ratings: RestaurantItemRating[];
  } | null>(null);
  const [tab, setTab] = useState(0);
  const [order, setOrder] = useState('category');
  const [basis, setBasis] = useState<number>();
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; action: () => Promise<void> } | null>(
    null
  );
  const [enlarged, setEnlarged] = useState<OwnedImage | null>(null);
  useEffect(() => {
    void seedRestaurantTags().catch((e) => showErrorToast(errorText(e)));
  }, [showErrorToast]);
  useEffect(() => {
    retainedFilters = filters;
  }, [filters]);
  const data = query.data;
  useEffect(() => {
    if (data && filters.personId && !data.people.some((p) => p.id === filters.personId))
      setFilters((f) => ({ ...f, personId: undefined, threshold: false }));
    if (data && basis && !data.people.some((p) => p.id === basis)) setBasis(undefined);
  }, [data, filters.personId, basis]);
  const restaurant = data?.restaurants.find((r) => r.id === restaurantId);
  const selected = useMemo(
    () =>
      data
        ? selectRestaurants(
            data.restaurants,
            data.restaurantItems,
            data.restaurantItemRatings,
            data.restaurantTags,
            filters
          )
        : [],
    [data, filters]
  );
  if (query.error) return <Alert severity="error">{errorText(query.error)}</Alert>;
  if (query.isLoading || !data) return <Typography role="status">Loading restaurants…</Typography>;
  const setPerson = (personId?: number) =>
    setFilters((f) => ({
      ...f,
      personId,
      threshold: personId ? (f.personId ? f.threshold : false) : false,
    }));
  const clear = () => setFilters({ ...emptyFilters });
  const finishRestaurant = async (id?: number) => {
    setRestaurantDraft(null);
    if (id && !restaurantId)
      await navigate({ to: '/restaurant/$restaurantId', params: { restaurantId: String(id) } });
  };
  if (restaurantDraft)
    return (
      <RestaurantEditor
        key={restaurantDraft.id ?? 'new'}
        initial={restaurantDraft}
        restaurants={data.restaurants}
        tags={data.restaurantTags}
        onDone={(id) => void finishRestaurant(id)}
      />
    );
  if (dishDraft)
    return (
      <DishEditor
        key={dishDraft.item.id ?? 'new'}
        initial={dishDraft.item}
        opinions={dishDraft.ratings}
        people={data.people}
        restaurantName={restaurant?.name ?? ''}
        startTab={dishDraft.tab}
        onDone={() => setDishDraft(null)}
      />
    );
  const dishes = data.restaurantItems.filter((d) => d.restaurantId === restaurantId);
  const shown =
    order === 'rated'
      ? rankedDishes(dishes, data.restaurantItemRatings, basis)
      : [...dishes].sort(
          (a, b) =>
            categories.indexOf(a.category ?? 'unknown') -
              categories.indexOf(b.category ?? 'unknown') || compareName(a, b)
        );
  const editDish = (item: RestaurantItem, tab = 0) =>
    setDishDraft({
      item: structuredClone(item),
      tab,
      ratings: data.restaurantItemRatings.filter((r) => r.itemId === item.id),
    });
  const location = (r: Restaurant) =>
    [r.country, r.region, r.city].filter(Boolean).join(' → ') || 'Location not saved';
  const geography = (field: 'country' | 'region' | 'city') => {
    const rows = data.restaurants
      .filter((r) => field === 'country' || r.countryKey === filters.country)
      .filter((r) => field !== 'city' || r.regionKey === filters.region);
    const choices = new Map(
      rows.map((r) => [
        r[`${field}Key`],
        r[field] ??
          (field === 'country'
            ? 'Unknown country'
            : field === 'region'
              ? 'No state/region'
              : 'Unknown city'),
      ])
    );
    return (
      <TextField
        select
        fullWidth
        label={field === 'region' ? 'State / region' : titleCase(field)}
        value={filters[field] === undefined ? 'all' : `key:${filters[field]}`}
        disabled={
          field === 'region'
            ? filters.country === undefined || filters.country === ''
            : field === 'city'
              ? filters.region === undefined || filters.country === ''
              : false
        }
        onChange={(e) => {
          const value = e.target.value === 'all' ? undefined : e.target.value.slice(4);
          setFilters((f) => ({
            ...f,
            [field]: value,
            ...(field === 'country'
              ? { region: undefined, city: undefined }
              : field === 'region'
                ? { city: undefined }
                : {}),
          }));
        }}
      >
        <MenuItem value="all">All</MenuItem>
        {[...choices]
          .sort((a, b) => a[1].localeCompare(b[1]))
          .map(([key, label]) => (
            <MenuItem key={key} value={`key:${key}`}>
              {label}
            </MenuItem>
          ))}
      </TextField>
    );
  };
  return (
    <Box sx={{ textAlign: 'left', pb: 3 }}>
      {restaurantId !== undefined && !restaurant ? (
        <>
          <Typography variant="h5">Restaurant not found</Typography>
          <Button component={Link} to="/restaurants">
            Back to Restaurants
          </Button>
        </>
      ) : restaurant ? (
        <>
          <Stack direction="row" alignItems="center" gap={1}>
            <IconButton component={Link} to="/restaurants" aria-label="Back to Restaurants">
              <ArrowBackIcon />
            </IconButton>
            <Typography variant="h5" sx={{ flex: 1, overflowWrap: 'anywhere' }}>
              {restaurant.name}
            </Typography>
            <Pin restaurant={restaurant} onError={showErrorToast} />
          </Stack>
          <Tags tags={data.restaurantTags} ids={restaurant.tags} />
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {location(restaurant)}
          </Typography>
          {restaurant.address && <Typography sx={multiline}>{restaurant.address}</Typography>}
          <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1}>
            {restaurant.latitude !== undefined && (
              <>
                <Typography>
                  {restaurant.latitude}, {restaurant.longitude}
                </Typography>
                <Button
                  aria-label="Copy coordinates"
                  startIcon={<ContentCopyIcon />}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(`${restaurant.latitude}, ${restaurant.longitude}`)
                      .catch(() => showErrorToast('Coordinates could not be copied'))
                  }
                >
                  Copy
                </Button>
              </>
            )}
            {restaurant.googleMapsUrl && (
              <Button
                component="a"
                href={restaurant.googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                Google Maps
              </Button>
            )}
          </Stack>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            sx={{ my: 2, borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab label="Dishes" />
            <Tab label="About" />
          </Tabs>
          {tab === 1 ? (
            <Stack gap={2}>
              <Typography variant="h6">Notes</Typography>
              <Typography sx={multiline}>{restaurant.notes || 'No notes yet'}</Typography>
              <Typography>
                Restaurant tags describe offerings, not allergy assurances. Vegan options never
                makes every dish vegan.
              </Typography>
              <Stack direction="row" flexWrap="wrap" gap={1}>
                <Button
                  variant="outlined"
                  startIcon={<EditIcon />}
                  onClick={() => setRestaurantDraft(structuredClone(restaurant))}
                >
                  Edit restaurant
                </Button>
                <Button
                  color="error"
                  onClick={() =>
                    setConfirm({
                      title: `Delete ${restaurant.name}, ${dishes.length} dishes and ${data.restaurantItemRatings.filter((r) => dishes.some((d) => d.id === r.itemId)).length} ratings?`,
                      action: async () => {
                        await deleteRestaurant(restaurant.id!);
                      },
                    })
                  }
                >
                  Delete restaurant
                </Button>
              </Stack>
              <Button sx={{ alignSelf: 'start' }} onClick={() => setPeopleOpen(true)}>
                Manage people
              </Button>
            </Stack>
          ) : (
            <>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ mb: 1 }}
              >
                <Typography variant="h6">Dishes</Typography>
                <Button variant="contained" onClick={() => editDish(newDish(restaurant.id!))}>
                  Add dish
                </Button>
              </Stack>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 2 }}>
                <TextField
                  size="small"
                  select
                  label="Dish order"
                  value={order}
                  onChange={(e) => setOrder(e.target.value)}
                >
                  <MenuItem value="category">Category/name</MenuItem>
                  <MenuItem value="rated">Best rated</MenuItem>
                </TextField>
                <Basis people={data.people} value={basis} onChange={setBasis} />
              </Box>
              {!shown.length && <Typography>No dishes yet. Add the first dish.</Typography>}
              {shown.map((dish, index) => {
                const ratings = data.restaurantItemRatings.filter((r) => r.itemId === dish.id);
                const summary = ratingSummary(ratings);
                const score = dishScore(ratings, basis);
                const cover = dish.images[dish.coverImageIndex ?? 0];
                return (
                  <Box key={dish.id}>
                    {order === 'category' &&
                      (index === 0 ||
                        (shown[index - 1].category ?? 'unknown') !==
                          (dish.category ?? 'unknown')) && (
                        <Typography sx={{ mt: 2, mb: 0.5 }}>
                          {titleCase(dish.category ?? 'unknown')}
                        </Typography>
                      )}
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 1.5,
                        mb: 1.5,
                        contentVisibility: 'auto',
                        containIntrinsicSize: 'auto 240px',
                      }}
                    >
                      <Stack direction="row" gap={1.5} alignItems="flex-start">
                        {cover && (
                          <Photo
                            image={cover}
                            name={dish.name}
                            onClick={() => setEnlarged(cover)}
                          />
                        )}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography>{dish.name}</Typography>
                          {dish.description && (
                            <Typography sx={multiline}>{dish.description}</Typography>
                          )}
                          {dish.modifiers && (
                            <Typography sx={{ ...multiline, mt: 0.5 }}>{dish.modifiers}</Typography>
                          )}
                        </Box>
                        <IconButton
                          size="small"
                          aria-label={`Edit ${dish.name}`}
                          onClick={() => editDish(dish)}
                        >
                          <EditIcon />
                        </IconButton>
                      </Stack>
                      <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ my: 1 }}>
                        {dietaryDisplay(dish.dietaryFlags).map((flag) => (
                          <Chip key={flag} size="small" label={titleCase(flag)} />
                        ))}
                      </Stack>
                      {ratings.map((r) => {
                        const p = data.people.find((p) => p.id === r.personId);
                        return (
                          <Box key={r.id}>
                            <Typography>
                              {p?.name}
                              {p?.status === 'archived' ? ' (Archived)' : ''} {r.score}/10
                              {r.wouldOrderAgain && r.wouldOrderAgain !== 'undecided'
                                ? ` · Would order again: ${titleCase(r.wouldOrderAgain)}`
                                : ''}
                            </Typography>
                            {r.comment && (
                              <Typography variant="body2" sx={multiline}>
                                {r.comment}
                              </Typography>
                            )}
                          </Box>
                        );
                      })}
                      <Typography color={!summary.count ? 'text.secondary' : undefined}>
                        {summary.count
                          ? `Mean ${summary.mean!.toFixed(1)}/10 · ${summary.count} ${summary.count === 1 ? 'person' : 'people'}`
                          : 'Not rated'}
                        {basis && score !== undefined
                          ? ` · ${data.people.find((p) => p.id === basis)?.name} ${score}/10`
                          : ''}
                      </Typography>
                      {dish.lastOrderedDate && (
                        <Typography variant="caption" display="block">
                          Last ordered {dish.lastOrderedDate}
                        </Typography>
                      )}
                      {advanced && (
                        <Typography>
                          {[
                            dish.priceAmount !== undefined
                              ? `${dish.currency} ${dish.priceAmount}`
                              : undefined,
                            dish.portion,
                            dish.spiceLevel && dish.spiceLevel !== 'unknown'
                              ? titleCase(dish.spiceLevel)
                              : undefined,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Typography>
                      )}
                      {dish.images.length > 1 && (
                        <Stack direction="row" gap={1} flexWrap="wrap">
                          {dish.images
                            .filter((_, index) => index !== (dish.coverImageIndex ?? 0))
                            .map((image, index) => (
                              <Photo
                                key={index}
                                image={image}
                                name={dish.name}
                                onClick={() => setEnlarged(image)}
                              />
                            ))}
                        </Stack>
                      )}
                      {dish.notes && (
                        <Typography variant="body2" sx={multiline}>
                          {dish.notes}
                        </Typography>
                      )}
                      <Button size="small" onClick={() => editDish(dish, 1)}>
                        Edit opinions
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        onClick={() =>
                          setConfirm({
                            title: `Delete ${dish.name} and ${ratings.length} ratings?`,
                            action: () => deleteDish(dish.id!),
                          })
                        }
                      >
                        Delete dish
                      </Button>
                    </Paper>
                  </Box>
                );
              })}
            </>
          )}
        </>
      ) : (
        <>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="h5">Restaurants</Typography>
            <Button variant="contained" onClick={() => setRestaurantDraft(newRestaurant())}>
              Create
            </Button>
          </Stack>
          <TextField
            fullWidth
            label="Find restaurant, dish or place"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            sx={{ mb: 1.5 }}
          />
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
            <TextField
              size="small"
              select
              label="Sort"
              value={filters.sort}
              onChange={(e) =>
                setFilters((f) => ({ ...f, sort: e.target.value as RestaurantFilters['sort'] }))
              }
            >
              <MenuItem value="name">Name</MenuItem>
              <MenuItem value="rated">Best rated</MenuItem>
            </TextField>
            <Basis people={data.people} value={filters.personId} onChange={setPerson} />
          </Box>
          <Stack direction="row" justifyContent="space-between" sx={{ my: 1.5 }}>
            <Button variant="outlined" onClick={() => setDrawer(true)}>
              Filters
            </Button>
            <Button onClick={clear}>Clear filters</Button>
          </Stack>
          <Tags tags={data.restaurantTags} ids={filters.tags} />
          <Typography variant="caption">
            {selected.length} restaurants · matching pins first
          </Typography>
          <Stack gap={1.5} sx={{ mt: 1 }}>
            {selected.map(({ restaurant: r, dishes, best, score, count }) => (
              <Paper key={r.id} variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction="row" alignItems="center">
                  <Typography
                    component={Link}
                    to="/restaurant/$restaurantId"
                    params={{ restaurantId: String(r.id) }}
                    sx={{
                      color: 'text.primary',
                      textDecoration: 'none',
                      fontSize: 20,
                      flex: 1,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {r.name}
                  </Typography>
                  <Pin restaurant={r} onError={showErrorToast} />
                </Stack>
                <Typography color="text.secondary" variant="body2">
                  {[r.city, r.country].filter(Boolean).join(' · ') || 'Location not saved'} ·{' '}
                  {dishes.length} dishes
                </Typography>
                <Box sx={{ my: 1 }}>
                  <Tags tags={data.restaurantTags} ids={r.tags} />
                </Box>
                <Typography variant="body2">
                  {score !== undefined ? `Best dish: ${best?.name}` : 'Not rated'}
                </Typography>
                {score !== undefined && (
                  <Typography variant="body2">
                    {filters.personId
                      ? data.people.find((p) => p.id === filters.personId)?.name
                      : 'Mean'}{' '}
                    {score.toFixed(1)}/10 · {count} people
                  </Typography>
                )}
              </Paper>
            ))}
          </Stack>
          {!selected.length && (
            <Alert severity="info" sx={{ mt: 2 }}>
              No matching restaurants. Clear filters or create a restaurant.
            </Alert>
          )}
          <Drawer anchor="right" open={drawer} onClose={() => setDrawer(false)}>
            <Box
              sx={{
                width: { xs: '100vw', sm: 380 },
                boxSizing: 'border-box',
                maxWidth: '100vw',
                p: 2,
              }}
            >
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="h5">Find restaurants</Typography>
                <IconButton aria-label="Close filters" onClick={() => setDrawer(false)}>
                  <CloseIcon />
                </IconButton>
              </Stack>
              <Stack gap={2} sx={{ mt: 3 }}>
                <Autocomplete
                  multiple
                  options={orderedTags(data.restaurantTags)}
                  getOptionLabel={(t) => t.name}
                  groupBy={(t) => titleCase(t.group)}
                  value={data.restaurantTags.filter((t) => filters.tags.includes(t.id!))}
                  onChange={(_, values) =>
                    setFilters((f) => ({ ...f, tags: values.map((t) => t.id!) }))
                  }
                  renderInput={(p) => (
                    <TextField
                      {...p}
                      label="Tags · match all"
                      helperText="Only vegan also matches Only vegetarian and vegan/vegetarian options."
                    />
                  )}
                />
                {geography('country')}
                {geography('region')}
                {geography('city')}
                <Typography variant="caption">
                  Changing a parent resets locations below it. Unknown country includes unsaved
                  locations.
                </Typography>
                <Basis people={data.people} value={filters.personId} onChange={setPerson} />
                <FormControlLabel
                  control={
                    <Switch
                      checked={filters.threshold}
                      disabled={!filters.personId}
                      onChange={(e) => setFilters((f) => ({ ...f, threshold: e.target.checked }))}
                    />
                  }
                  label="Minimum person score"
                />
                <TextField
                  label="Minimum score / 10"
                  type="number"
                  disabled={!filters.threshold || !filters.personId}
                  value={filters.minimum}
                  slotProps={{ htmlInput: { min: 1, max: 10, step: 0.5 } }}
                  onChange={(e) => {
                    const minimum = Number(e.target.value);
                    if (minimum >= 1 && minimum <= 10 && (minimum * 2) % 1 === 0)
                      setFilters((f) => ({ ...f, minimum }));
                  }}
                />
                <Typography variant="caption">
                  Off until enabled. Household clears it; returning to a person leaves it Off.
                </Typography>
                <Stack direction="row" justifyContent="flex-end">
                  <Button onClick={clear}>Clear filters</Button>
                  <Button variant="contained" onClick={() => setDrawer(false)}>
                    Show results
                  </Button>
                </Stack>
              </Stack>
            </Box>
          </Drawer>
        </>
      )}
      {peopleOpen && (
        <People
          people={data.people}
          ratings={data.restaurantItemRatings}
          onClose={() => setPeopleOpen(false)}
        />
      )}
      <Dialog open={!!confirm} onClose={() => setConfirm(null)}>
        <DialogTitle>{confirm?.title}</DialogTitle>
        <DialogContent>
          People, reusable tags and shared image bytes are retained. Earlier exports and snapshots
          stay unchanged.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button
            color="error"
            onClick={async () => {
              try {
                await confirm?.action();
                setConfirm(null);
              } catch (e) {
                showErrorToast(errorText(e));
              }
            }}
          >
            Confirm delete
          </Button>
        </DialogActions>
      </Dialog>
      <Enlarged image={enlarged} onClose={() => setEnlarged(null)} name="Dish" />
    </Box>
  );
}
