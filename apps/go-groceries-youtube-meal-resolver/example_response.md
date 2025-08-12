      You're given JSON data about a YouTube video. Attempt to extra the following data:

      - Meal Name: This should be a concise name for the meal.

      - Ingredients and Quantity: Attempt to find a recipe or ingredient list in the data given and extract the ingredient name and quantity of it. Make the ingredient name concise ("Broccoli Crowns" -> "Broccoli"). For quantity, choose a numerical amount between 1 and 10 for the quantity of the ingredient from the recipe or ingredients list. If unsure of the quantity, fallback to 1 for the quantity. For any fractions, ceiling to a whole number.

      - Tags: These are descriptive labels. Return any possible applicable tags from this list: [dumplings, pasta, dinosaur]. This may be empty if no tags apply.

      - Recipe: This is text describing the recipe to make the meal. It should be as concise as possible but include all details, ingredients, and steps required to make the meal. This may be empty if no recipe can be found.

      The output of this should be JSON in the following format:
      {
        mealName: string;
        ingredients: {
          name: string;
          quantity: number;
        }[];
        tags: string[];
        recipe: string;
      }

      Where possible, ALL data given back should be in English.

      Here is the data:

      --
      Video title: I ❤️ dumplings!
      --

      --
      Video description:
      --

      --
      Video tags: []

      --
      Interesting Comments (comments separated by |---|):

      ["I loooove me a good dumpling!🥟🥹
ESPECIALLY SHENG JIAN BAO (生煎包) also known as Shanghai buns.☺️
RECIPE (4 servings, 90min prep time):
Dough:
-2/3 cup (160ml) lukewarm water
-1 Tsp instant yeast
-1 Tsp sugar
-1 Tbsp oil
MIX
-2 cups (250g) flour
-3 Tbsp corn starch
-a pinch of salt
Knead well and let the dough rest for 1h.
Divide in 26 pieces and roll them out on a floured working surface.
Filling:
-250g tempeh or tofu, crumbled
-2 scallions, chopped
-2 cloves garlic, chopped
-2 carrots, shredded
-a thumbsize piece of ginger, minced
-1 Tbsp soy sauce
-1 Tbsp sweet soy sauce
-2 Tsp white vinegar
Knead 2-3mins and add 1-2 Tsp to a dough circle.
Fold and seal. Heat up oil in a pan and fry until browned on medium heat.
Add water and let the buns steam covered for about 10mins.
Then they’re done.
Dipping sauce:
-3 Tvsp agave
-3 Tbsp white vinegar
-1 Tsp chili powder
Mix and serve with the dumplings.😋
-
Ich liiiiiebe Dumplings!🥟🥹
besonders SHENG JIAN BAO (生煎包), auch bekannt als Shanghai-buns.☺️
REZEPT (4 Portionen, 90 Minuten Zubereitungszeit):
Teig:
-160ml lauwarmes Wasser
-1 TL Trockenhefe
-1 TL Zucker
-1 EL Öl
MISCHEN
-250g Mehl
-3 EL Maisstärke
-eine Prise Salz
Gut durchkneten und den Teig 1 Stunde ruhen lassen.
In 26 Stücke teilen und auf einer bemehlten Arbeitsfläche ausrollen.
Füllung:
-250g Tempeh oder Tofu, zerbröselt
-2 Frühlingszwiebeln, gehackt
-2 Knoblauchzehen, gehackt
- ein daumengroßes Stück Ingwer, gehackt
-2 Möhren, geraspet
-1 EL Sojasauce
-1 EL süße Sojasauce
-2 TL weißer Essig
2–3 Minuten kneten und 1–2 TL zu einem Teigkreis hinzufügen.
Falten und verschließen. Öl in einer Pfanne erhitzen und bei mittlerer Hitze braten, bis sie gebräunt sind.
Wasser hinzufügen und lassen zugedeckt ca. 10min lang dämpfen.
Dann sind sie fertig.
Dip-Sauce:
-3 Tbsp Agave
-3 EL weißer Essig
-1 TL Chilipulver
Mischen und mit den dumplings servieren.😋
#easyveganmeals #easyveganrecipes #vegancooking #dumplings #veganrecipes"|---|
"I loooove me a good dumpling!🥟🥹
ESPECIALLY SHENG JIAN BAO (生煎包) also known as Shanghai buns.☺️
RECIPE (4 servings, 90min prep time):
Dough:
-2/3 cup (160ml) lukewarm water
-1 Tsp instant yeast
-1 Tsp sugar
-1 Tbsp oil
MIX
-2 cups (250g) flour
-3 Tbsp corn starch
-a pinch of salt
Knead well and let the dough rest for 1h.
Divide in 26 pieces and roll them out on a floured working surface.
Filling:
-250g tempeh or tofu, crumbled
-2 scallions, chopped
-2 cloves garlic, chopped
-2 carrots, shredded
-a thumbsize piece of ginger, minced
-1 Tbsp soy sauce
-1 Tbsp sweet soy sauce
-2 Tsp white vinegar
Knead 2-3mins and add 1-2 Tsp to a dough circle.
Fold and seal. Heat up oil in a pan and fry until browned on medium heat.
Add water and let the buns steam covered for about 10mins.
Then they’re done.
Dipping sauce:
-3 Tvsp agave
-3 Tbsp white vinegar
-1 Tsp chili powder
Mix and serve with the dumplings.😋
-
Ich liiiiiebe Dumplings!🥟🥹
besonders SHENG JIAN BAO (生煎包), auch bekannt als Shanghai-buns.☺️
REZEPT (4 Portionen, 90 Minuten Zubereitungszeit):
Teig:
-160ml lauwarmes Wasser
-1 TL Trockenhefe
-1 TL Zucker
-1 EL Öl
MISCHEN
-250g Mehl
-3 EL Maisstärke
-eine Prise Salz
Gut durchkneten und den Teig 1 Stunde ruhen lassen.
In 26 Stücke teilen und auf einer bemehlten Arbeitsfläche ausrollen.
Füllung:
-250g Tempeh oder Tofu, zerbröselt
-2 Frühlingszwiebeln, gehackt
-2 Knoblauchzehen, gehackt
- ein daumengroßes Stück Ingwer, gehackt
-2 Möhren, geraspet
-1 EL Sojasauce
-1 EL süße Sojasauce
-2 TL weißer Essig
2–3 Minuten kneten und 1–2 TL zu einem Teigkreis hinzufügen.
Falten und verschließen. Öl in einer Pfanne erhitzen und bei mittlerer Hitze braten, bis sie gebräunt sind.
Wasser hinzufügen und lassen zugedeckt ca. 10min lang dämpfen.
Dann sind sie fertig.
Dip-Sauce:
-3 Tbsp Agave
-3 EL weißer Essig
-1 TL Chilipulver
Mischen und mit den dumplings servieren.😋
#easyveganmeals #easyveganrecipes #vegancooking #dumplings #veganrecipes"]

Return ONLY JSON with no commentary.
