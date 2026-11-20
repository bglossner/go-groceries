import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import Dexie from 'dexie';
import {afterEach, expect, test, vi} from 'vitest';
import {db} from '../src/db/db.ts';
import {GroceryListContainer} from '../src/components/GroceryListContainer.tsx';
import GroceryListPage from '../src/pages/GroceryList.tsx';
import {mealFormSchema} from '../src/types/meals.ts';
import {forceDateMigration} from '../src/util/db/migration.ts';
import {cleanDatabase, meal, date} from './helpers.mjs';
vi.mock('@tanstack/react-router', () => ({Link: ({children}) => React.createElement('span',null,children)}));
cleanDatabase();
let root,client;
async function mount(component, props = {}) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  client = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});
  await act(async () => root.render(React.createElement(QueryClientProvider,{client},React.createElement(component,props))));
}
afterEach(async () => { if (root) await act(async () => root.unmount()); root = undefined;client?.clear();document.body.innerHTML = ''; });
const button = name => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === name || b.getAttribute('aria-label') === name);
async function click(element) {expect(element).toBeDefined();await act(async () => element.click());}
async function input(element,value) {
  expect(element).toBeTruthy();
  await act(async () => {Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));});
}
async function wait(assertion) {await vi.waitFor(async () => {await act(async () => {});assertion();},{timeout:3000,interval:20});}
test('meal form validates ingredients, trims name and retains selected tags', () => {
  const result = mealFormSchema.parse({name:'  Soup  ',ingredients:[{name:'carrot',quantity:2},{name:'',quantity:1}],tags:[{id:1,name:'vegan'}]});
  expect(result.name).toBe('Soup');expect(result.ingredients).toHaveLength(1);expect(result.tags).toEqual([{id:1,name:'vegan'}]);
  expect(mealFormSchema.safeParse({name:'',ingredients:[]}).success).toBe(false);
});
test('Date hooks store ISO strings and expose Date instances on all dated tables', async () => {
  await db.meals.put(meal());await db.groceryLists.put({id:1,name:'List',meals:[],createdAt:date});
  await db.pendingRecipes.put({id:'pending',sourceUrl:'',createdAt:date});
  await db.syncs.put({id:1,type:'from',filename:'old',uploadType:'manual',createdAt:date,lastSyncedAt:date,expiresAt:date});
  const raw = new Dexie(db.name);await raw.open();
  try {
    for (const [table,key] of [['meals',1],['groceryLists',1],['pendingRecipes','pending'],['syncs',1]]) {
      expect((await raw.table(table).get(key)).createdAt).toBe(date.toISOString());expect((await db.table(table).get(key)).createdAt).toBeInstanceOf(Date);
    }
  } finally {raw.close();}
});
test('force date migration normalizes Date and numeric legacy keys', async () => {
  const raw = new Dexie(db.name);await raw.open();
  try {await raw.table('groceryLists').bulkPut([{id:1,name:'Date',meals:[],createdAt:date},{id:2,name:'Number',meals:[],createdAt:date.getTime()}]);
    await forceDateMigration();expect((await raw.table('groceryLists').toArray()).map(x=>x.createdAt)).toEqual([date.toISOString(),date.toISOString()]);
  } finally {raw.close();}
});
async function seedGrocery() {
  await db.meals.bulkPut([meal(1,'Soup'),{...meal(2,'Salad'),ingredients:[{name:'CARROT',quantity:3},{name:'rice'}]}]);
  await db.groceryLists.put({id:1,name:'Weekly',meals:[1,2],customIngredients:[{name:'carrot',quantity:1},{name:'soap',quantity:2}],createdAt:date});
  await db.groceryListStates.put({id:1,groceryListId:1,checkedIngredients:[]});
  await db.stores.bulkPut([{id:1,name:'Market',color:'#112233'},{id:2,name:'Corner',color:'#445566'}]);
  await db.ingredientStores.bulkPut([{id:1,ingredientName:'carrot',storeId:1},{id:2,ingredientName:'carrot',storeId:2}]);
}
test('grocery aggregation is case-insensitive, adds quantities and keeps source labels', async () => {
  await seedGrocery();await mount(GroceryListContainer,{groceryListId:1});
  await wait(() => expect(document.body.textContent).toContain('Carrot: 6'));
  expect(document.body.textContent).toContain('Rice: 1');expect(document.body.textContent).toContain('Soup: 2, Salad: 3, Custom: 1');
});
test('store partitioning shares checklist state across duplicate store appearances', async () => {
  await seedGrocery();await mount(GroceryListContainer,{groceryListId:1});await wait(() => expect(document.body.textContent).toContain('Carrot: 6'));
  await click(button('partition by store'));await wait(() => expect(document.body.textContent).toContain('Uncategorized'));
  const carrotRows = [...document.querySelectorAll('li')].filter(li => li.textContent.includes('Carrot: 6'));
  expect(carrotRows).toHaveLength(2);await click(carrotRows[0].querySelector('input[type=checkbox]'));
  await vi.waitFor(async () => expect((await db.groceryListStates.get(1)).checkedIngredients).toEqual(['carrot']));
  await wait(() => expect([...document.querySelectorAll('li')].filter(li => li.textContent.includes('Carrot: 6')).every(li => li.querySelector('input').checked)).toBe(true));
});
test('checklist persists, sorts checked last and reset clears state after confirmation', async () => {
  await seedGrocery();await mount(GroceryListContainer,{groceryListId:1});await wait(() => expect(document.body.textContent).toContain('Carrot: 6'));
  await click(document.querySelector('li input[type=checkbox]'));await vi.waitFor(async () => expect((await db.groceryListStates.get(1)).checkedIngredients).toEqual(['carrot']));
  await wait(() => {
    const rows = [...document.querySelectorAll('li')];
    expect(rows).toHaveLength(3);
    expect(rows.map(row=>row.querySelector('input[type=checkbox]').checked)).toEqual([false,false,true]);
    expect(rows.at(-1).textContent).toContain('Carrot: 6');
  });
  await wait(() => expect(button('Reset')).toBeDefined());await click(button('Reset'));await click(button('Discard'));await vi.waitFor(async () => expect((await db.groceryListStates.get(1)).checkedIngredients).toEqual([]));
});
test('grocery form creation normalizes custom ingredients and increments usage once', async () => {
  await mount(GroceryListPage);await click(button('Create New Grocery List'));
  await input(document.querySelector('input[name=name]'),'Weekly');
  await input(document.querySelector('input[role=combobox]'),'Soap');
  await click(button('Create'));
  await vi.waitFor(async () => expect(await db.groceryLists.count()).toBe(1));
  const list = await db.groceryLists.toCollection().first();expect(list.name).toBe('Weekly');expect(list.customIngredients).toEqual([{name:'soap',quantity:1}]);
  expect((await db.customIngredients.toCollection().first()).usageCount).toBe(1);
});

test('editing a list to remove a custom ingredient decrements its usage count', async () => {
  await db.groceryLists.put({id:1,name:'Weekly',meals:[],customIngredients:[{name:'soap',quantity:1}],createdAt:date});
  await db.customIngredients.put({id:1,name:'soap',usageCount:2});
  await mount(GroceryListPage);await wait(()=>expect(document.querySelector('[data-testid=EditIcon]')).not.toBeNull());
  await click(document.querySelector('[data-testid=EditIcon]').closest('button'));
  await click(document.querySelector('[data-testid=RemoveCircleOutlineIcon]').closest('button'));
  await click(button('Save'));
  await vi.waitFor(async()=>expect((await db.customIngredients.get(1)).usageCount).toBe(1));
  expect((await db.groceryLists.get(1)).customIngredients).toEqual([]);
});
