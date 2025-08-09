# Implement the ability to attach recipes to meals

Create a new page, `/recipe/${mealId}`. When visited, it should attempt to find the recipe associated with the meal passed by mealId. If no recipe is found, create a new recipe ("Create New Recipe for *Meal Name*").

If no mealId is provided, error by showing the user a message.

The recipe page should have a form with 3 sections:
- Images
- Recipe URL
- Notes

The form should work as readonly (non-editable) and writable. If it's a new recipe, make it editable by default. Once a recipe is saved or when it's viewed, it should be shown in the readonly version. Include an edit button at the top of the page to go to edit mode and when in readonly mode include Save and Discard buttons at the bottom of the form. If Discard is clicked, confirm with the user they want to discard the changes.

## Images

The Images section should allow the user to:
- Take picture(s) with their device of the recipe
- Upload image(s) from their device of the recipe

The user may upload only 10 images per recipe. Make the images displayable on the page when in both edit and readonly and in edit allow uploading/taking additional pictures.

When in readonly mode, show just the images uploaded or display `No images stored for this recipe`.

## Recipe URL

The recipe URL section should include one text field that takes a URL, up to 500 characters in length.

When the form is not editable, check if the URL is a valid URL and if it is show it as a clickable hyperlink.

## Notes

The notes section should allow putting in arbitrary paragraphs of text up to 10000 characters in length.

It is not required and should act as a free-form text area.

## On Save

When saving, save to a new table in IndexedDB, where the recipe is attached to the meal by meal ID from the URL. Store the images as files in the DB and the other fields as text. Ensure that importing and exporting the DB still works with these changes.

# Getting to the page

To get to the recipes page, include in the meal dropdown on the Meals page a button similar to "GO!" in the grocery list dropdown that says "Attach/View Recipe". When clicked, it should take them to `/recipe/${mealId}` to create a new recipe for the meal or view the existing one.

# Additional Asks

On the Recipe page, put a back button at the top that allows navigating back to the Meals page with the appropriate meal expanded. If there are unsaved changes in the form, confirm with the user they want to discard those changes and leave. That means we need to track if the form is dirty or not.
