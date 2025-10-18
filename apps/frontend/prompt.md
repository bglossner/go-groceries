You are an expert system architecture engineer. DO NOT write any code.

## Context

Ingredients are shown in the grocery list in alphabetical order. However, when users are on the grocery list, they may want to check off ingredients based on the store they are at instead of having to search in the page (scrolling) or with the search bar.

## Task

Create a way to allow users to select an option on the grocery list page to partition the grocery list by store. The user should also be able to filter the ingredients on the grocery list page by store as well. Create a UX to support that.

**The grocery list page should still show each partition in alphabetical order AND the search bar should still filter all of the ingredients shown for each store.**

Based on the above, the user will not some way to associated a given ingredient with store(s). Create a new page navigatable from the "Grocery List" page that allows users to:
- Create a new store
- Associate given ingredients with a store

Make the association UX a drag and drop system. The user should be able to "drag and drop" the ingredient into the store "bucket". It should be possible to associate the same ingredient to different stores. The available ingredients should be an aggregation of those from every meal as well as custom ingredients defined in the grocery lists.

If creating new table(s), make sure to include it in the export/import strategy in the `index.lazy.ts` file.
