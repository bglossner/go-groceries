# Ingredient Store Management Design Document

## 1. Overview

This document outlines the architectural and design approach for implementing a store-based organization system for ingredients within the Groceries Helper application. This feature will allow users to associate ingredients with specific stores, and then view their grocery lists partitioned or filtered by those stores.

The implementation involves creating a new page for managing stores and ingredient associations, and updating the existing Grocery List page to support the new functionality.

## 2. Data Model Changes

To support storing store information and the relationship between ingredients and stores, two new tables will be added to the Dexie database (`src/db/db.ts`).

### 2.1. New Table: `stores`

This table will store the user-defined store names.

-   **Schema:**
    ```typescript
    export interface Store {
      id?: number;
      name: string;
    }
    ```
-   **Dexie Definition:** `stores: '++id, name'`

### 2.2. New Table: `ingredientStores`

This table will create a many-to-many relationship between ingredients and stores. We will use the ingredient name as the foreign key, as ingredients are identified by name throughout the app.

-   **Schema:**
    ```typescript
    export interface IngredientStore {
      id?: number;
      ingredientName: string; // Foreign key (maps to Ingredient.name)
      storeId: number;        // Foreign key (maps to Store.id)
    }
    ```
-   **Dexie Definition:** `ingredientStores: '++id, &[ingredientName+storeId], storeId'`

### 2.3. Database Schema Update

The `MySubClassedDexie` class in `src/db/db.ts` will be updated to include the new tables:

```typescript
export class MySubClassedDexie extends Dexie {
  // ... existing tables
  stores!: Table<Store>;
  ingredientStores!: Table<IngredientStore>;

  constructor() {
    super('groceriesHelper');
    this.version(10).stores({ // Increment the version number
      // ... existing stores definitions
      stores: '++id, name',
      ingredientStores: '++id, &[ingredientName+storeId], storeId',
    });
  }
}
```

### 2.4. Export/Import Strategy

The new `stores` and `ingredientStores` tables must be added to the `exportDB` and `importDB` calls in `src/routes/index.lazy.tsx` to ensure they are included in the database backup and restore functionality.

## 3. New Page: "Manage Stores"

A new page will be created to allow users to create stores and manage ingredient associations.

-   **Route:** `/manage-stores`
-   **File:** `src/routes/manage-stores.lazy.tsx` and `src/pages/ManageStores.tsx`

### 3.1. UI/UX Design

The page will be divided into three main sections:

1.  **Available Ingredients:** A list of all unique ingredients aggregated from all meals and custom ingredients. This list will be draggable.
2.  **Store Buckets:** A section displaying all created stores as "buckets" where ingredients can be dropped. Each bucket will also display the ingredients already associated with it.
3.  **Create Store:** A simple form with a text input and a "Create Store" button.

**Interaction:**

-   Users can drag an ingredient from the "Available Ingredients" list and drop it onto any "Store Bucket".
-   Dropping an ingredient on a store creates an association in the `ingredientStores` table.
-   An ingredient can be dropped into multiple store buckets.
-   Users can remove an ingredient from a store by clicking a "delete" icon next to the ingredient within the store bucket.

### 3.2. Component Breakdown

-   `ManageStoresPage.tsx`: The main container component.
-   `AvailableIngredientsList.tsx`: Fetches and displays the list of all available ingredients. Implements the draggable items.
-   `StoreBucket.tsx`: Represents a single store. Acts as a drop target and displays associated ingredients.
-   `CreateStoreForm.tsx`: A form for adding new stores.

### 3.3. Data Flow

1.  **Fetch Data:** The page will use `useQuery` from `@tanstack/react-query` to fetch all `meals`, `customIngredients`, `stores`, and `ingredientStores`.
2.  **Aggregate Ingredients:** A `useMemo` hook will process the `meals` and `customIngredients` to create a unique, alphabetized list of all available ingredient names.
3.  **Drag-and-Drop:** On a successful drop, a `useMutation` hook will be called to add a new entry to the `ingredientStores` table. The query for `ingredientStores` will be invalidated to reflect the change.
4.  **Store Creation:** A `useMutation` hook will add a new store to the `stores` table and invalidate the relevant query.

## 4. Grocery List Page Modifications

The existing Grocery List page (`src/pages/GroceryList.tsx`) will be updated to partition the aggregated ingredient list by store.

### 4.1. UI/UX Design

-   **Store Filter:** A set of toggle buttons or a dropdown menu will be added at the top of the "Aggregated Ingredients" view. Options will include "All" and each created store name.
-   **Partitioned View:**
    -   When "All" is selected, the list will be partitioned by store. Each store will have its own section with a header.
    -   Ingredients not associated with any store will appear under an "Uncategorized" section.
    -   Each store's ingredient list will be sorted alphabetically.
-   **Filtered View:** When a specific store is selected from the filter, only the ingredients for that store will be shown.
-   **Search:** The existing search bar will continue to filter the ingredients currently visible in the list (whether partitioned or filtered).

### 4.2. Logic Changes

1.  **Fetch Associations:** The component will fetch the `stores` and `ingredientStores` tables.
2.  **Group Ingredients:** When the "Aggregated Ingredients" dialog is opened, the ingredient list will be processed. A map or object will be created to group ingredients by `storeId`.
3.  **Render Partitions:** The UI will iterate over the grouped ingredients, rendering a separate list for each store.

## 5. Implementation Details

### Drag-and-Drop Library

Since no drag-and-drop library is currently in the project, we will add `@dnd-kit`. It is a modern, accessible, and performant library for React.

**Packages to install:**

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

## 6. Alternative Approaches

-   **Tag-Based System:** Instead of a dedicated "Store" entity, we could have used the existing `Tag` system. However, this could overload the purpose of tags and make the UX less clear. A dedicated "Store" feature is more explicit and user-friendly for this specific task.
-   **Inline Store Management:** Instead of a separate page, store management could have been integrated directly into the grocery list page. This was rejected to keep the grocery list page focused on its primary function and to avoid cluttering the UI.

## 7. Open Questions

-   Should there be a way to re-order the store partitions on the grocery list page? (Initial design will not include this, but it could be a future enhancement).
-   What should be the behavior for deleting a store that has ingredients associated with it? (The initial design will simply remove the store and the associations. The ingredients will then fall under "Uncategorized").
