import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, test, vi } from 'vitest';
import Restaurants, { DishEditor } from '../src/pages/Restaurants.tsx';
import { ToastProvider } from '../src/contexts/ToastProvider.tsx';
import { db } from '../src/db/db.ts';
import { saveRestaurant, saveDish, savePerson, archivePerson } from '../src/db/restaurants.ts';
import { cacheImage } from '../src/db/image-cache.ts';
import { cleanDatabase, image } from './helpers.mjs';
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }) => React.createElement('span', null, children),
  useBlocker: () => ({ status: 'idle' }),
  useNavigate: () => vi.fn(),
}));
cleanDatabase();
let root, client;
const time = '2020-01-01T00:00:00.000Z';
const button = (name) =>
  [...document.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === name || b.getAttribute('aria-label') === name
  );
async function click(e) {
  expect(e).toBeTruthy();
  await act(async () => e.click());
}
async function input(e, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, value);
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const field = (label) => {
  const el = [...document.querySelectorAll('label')].find(
    (e) => e.textContent.replace('*', '').trim() === label
  );
  return el && document.getElementById(el.htmlFor);
};
async function mount(props, Component = DishEditor) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  document.body.append(div);
  root = createRoot(div);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () =>
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(ToastProvider, null, React.createElement(Component, props))
      )
    )
  );
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
  client?.clear();
  document.body.innerHTML = '';
});
async function fixture(images = []) {
  const rid = await saveRestaurant({
    name: 'Kumo',
    tags: [],
    notes: '',
    isPinned: false,
    countryKey: '',
    regionKey: '',
    cityKey: '',
    createdAt: time,
    updatedAt: time,
  });
  const id = await saveDish(
    {
      restaurantId: rid,
      name: 'Ramen',
      description: '',
      notes: '',
      images,
      coverImageIndex: images.length ? 1 : undefined,
      dietaryFlags: [],
      priceAmount: '10',
      currency: 'GBP',
      createdAt: time,
      updatedAt: time,
    },
    []
  );
  return db.restaurantItems.get(id);
}
test('review R2/R3: validation is inside modal and archived name restores stable ID without losing dish draft', async () => {
  const id = await savePerson('Ben');
  await archivePerson(id, true);
  const initial = await fixture();
  const people = await db.people.toArray();
  await mount({ initial, opinions: [], people, restaurantName: 'Kumo', onDone: vi.fn() });
  await input(field('Dish name'), 'Dirty ramen');
  await click(button('Opinions'));
  await click(button('Add person'));
  await click(button('Save person'));
  await vi.waitFor(() =>
    expect(document.querySelector('[role=dialog] [role=alert]')).not.toBeNull()
  );
  await input(field('Person name'), ' BEN ');
  await click(button('Restore person'));
  await vi.waitFor(async () => expect((await db.people.get(id)).status).toBe('active'));
  await click(button('Details'));
  expect(field('Dish name').value).toBe('Dirty ramen');
  expect(await db.people.count()).toBe(1);
});
test('review R4: deleting middle cover chooses successor and final removal unsets cover', async () => {
  const refs = await Promise.all(
    [1, 2, 3].map(async (i) =>
      cacheImage(new File([image(), String(i)], `photo${i}.png`, { type: 'image/png' }))
    )
  );
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:synthetic'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const initial = await fixture(refs);
  await mount({ initial, opinions: [], people: [], restaurantName: 'Kumo', onDone: vi.fn() });
  await click(button('Remove photo 2'));
  await click(button('Save dish'));
  await vi.waitFor(async () => {
    const saved = await db.restaurantItems.get(initial.id);
    expect(saved.coverImageIndex).toBe(1);
    expect(saved.images[saved.coverImageIndex]).toEqual(refs[2]);
  });
  await click(button('Remove photo 2'));
  await click(button('Remove photo 1'));
  await click(button('Save dish'));
  await vi.waitFor(async () => {
    const saved = await db.restaurantItems.get(initial.id);
    expect(saved.images).toEqual([]);
    expect(saved.coverImageIndex).toBeUndefined();
  });
});
test('R12: saved 10 -> draft12 -> hide -> Save stores12, explicit Discard leaves10', async () => {
  await db.settings.put({ id: 'showAdvancedRestaurantFields', value: 'true' });
  const initial = await fixture();
  const done = vi.fn();
  await mount({ initial, opinions: [], people: [], restaurantName: 'Kumo', onDone: done });
  await vi.waitFor(() => expect(field('Price')).toBeTruthy());
  await input(field('Price'), '12');
  await act(async () => db.settings.put({ id: 'showAdvancedRestaurantFields', value: 'false' }));
  await vi.waitFor(() => expect(field('Price')).toBeUndefined());
  await click(button('Save dish'));
  await vi.waitFor(async () =>
    expect((await db.restaurantItems.get(initial.id)).priceAmount).toBe('12')
  );
  await act(async () => root.unmount());
  root = undefined;
  client.clear();
  document.body.innerHTML = '';
  await db.restaurantItems.update(initial.id, { priceAmount: '10' });
  await db.settings.put({ id: 'showAdvancedRestaurantFields', value: 'true' });
  await mount({
    initial: await db.restaurantItems.get(initial.id),
    opinions: [],
    people: [],
    restaurantName: 'Kumo',
    onDone: done,
  });
  await vi.waitFor(() => expect(field('Price')).toBeTruthy());
  await input(field('Price'), '12');
  await act(async () => db.settings.put({ id: 'showAdvancedRestaurantFields', value: 'false' }));
  await click(button('Discard'));
  await click(button('Discard changes'));
  expect((await db.restaurantItems.get(initial.id)).priceAmount).toBe('10');
});

test('review R5: star location is an exact drill-down value at every level', async () => {
  const base = {
    name: 'Star place',
    tags: [],
    notes: '',
    isPinned: false,
    countryKey: '',
    regionKey: '',
    cityKey: '',
    createdAt: time,
    updatedAt: time,
  };
  await saveRestaurant({ ...base, country: '*', region: '*', city: '*' });
  await saveRestaurant({ ...base, name: 'Other place', country: 'Canada' });
  await mount({}, Restaurants);
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain('2 restaurants · matching pins first')
  );
  await click(button('Filters'));
  for (const label of ['Country', 'State / region', 'City']) {
    await act(async () =>
      field(label).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    );
    await vi.waitFor(() =>
      expect(
        [...document.querySelectorAll('[role=option]')].some((el) => el.textContent === '*')
      ).toBe(true)
    );
    await click(
      [...document.querySelectorAll('[role=option]')].find((el) => el.textContent === '*')
    );
  }
  await click(button('Show results'));
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain('1 restaurants · matching pins first')
  );
  expect(document.body.textContent).not.toContain('Other place');
});

test('review R11: omitted and explicit Unknown categories form one group', async () => {
  const initial = await fixture();
  for (const [name, category] of [
    ['A', undefined],
    ['B', 'unknown'],
    ['C', undefined],
  ])
    await saveDish({ ...initial, id: undefined, name, category }, []);
  await mount({ restaurantId: initial.restaurantId }, Restaurants);
  await vi.waitFor(() => expect(document.body.textContent).toContain('C'));
  expect(
    [...document.querySelectorAll('p')].filter((el) => el.textContent === 'Unknown')
  ).toHaveLength(1);
});
