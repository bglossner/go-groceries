You are an expert system architecture engineer. DO NOT write any code. Currently, in FromYoutubeMealCreation.tsx, upon making the call to the YouTube backend API receives back both meal data AND a recipe. The meal data is used to fill in the meal form in Meals.tsx. The recipe is currently not used. Design at least 2 possibilities for attaching the recipe to the meal data where:
- The user may check a checkbox when providing the YouTube URL to automatically create the recipe when creating the meal or not.
- The user, when that checkbox is not checked, should be able to load in the recipe with some mechanism without another API call to the YouTube API if the YouTube API was used to create that meal.

Other factors to consider:
- There is already a recipe database with a foreign key to the meal (by meal ID)
- Current DB schemas can be found in the db.ts file

Consider the current setup of apps/frontend and the existing files/patterns to inform your designs.
