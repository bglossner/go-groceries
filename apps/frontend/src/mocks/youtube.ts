import type { MealGenerationDataResponse } from "../shareable/meals";

export const YOUTUBE_MOCK_DATA_1 = {
  "data": {
    "name": "Shanghai Buns",
    "ingredients": [
      {
        "name": "Water",
        "quantity": 1
      },
      {
        "name": "Yeast",
        "quantity": 1
      },
      {
        "name": "Sugar",
        "quantity": 1
      },
      {
        "name": "Oil",
        "quantity": 1
      },
      {
        "name": "Flour",
        "quantity": 1
      },
      {
        "name": "Corn Starch",
        "quantity": 1
      },
      {
        "name": "Salt",
        "quantity": 1
      },
      {
        "name": "Tempeh",
        "quantity": 1
      },
      {
        "name": "Scallions",
        "quantity": 1
      },
      {
        "name": "Garlic",
        "quantity": 1
      },
      {
        "name": "Carrots",
        "quantity": 1
      },
      {
        "name": "Ginger",
        "quantity": 1
      },
      {
        "name": "Soy Sauce",
        "quantity": 1
      },
      {
        "name": "Sweet Soy Sauce",
        "quantity": 1
      },
      {
        "name": "Vinegar",
        "quantity": 1
      },
      {
        "name": "Agave",
        "quantity": 1
      },
      {
        "name": "Chili Powder",
        "quantity": 1
      }
    ],
    "tags": [
      "dumplings"
    ],
    "recipe": {
      "url": "https://youtube.com/shorts/JfR0IsuS8cg?si=BR18ej4JWkjeWqWs",
      "notes": "- Dough: Mix 2/3 cup lukewarm water, 1 Tsp instant yeast, 1 Tsp sugar, and 1 Tbsp oil. Add 2 cups flour, 3 Tbsp corn starch, and a pinch of salt. Knead well and let rest for 1h.\n- Divide in 26 pieces and roll out on a floured surface.\n- Filling: Mix 250g tempeh or tofu, 2 scallions, 2 cloves garlic, 2 carrots, and a thumbsize piece of ginger. Add 1 Tbsp soy sauce, 1 Tbsp sweet soy sauce, and 2 Tsp vinegar.\n- Knead 2-3mins and add 1-2 Tsp to a dough circle. Fold and seal. Heat oil in a pan and fry until browned on medium heat. Add water and let steam covered for 10mins.\n- Dipping sauce: Mix 3 Tbsp agave, 3 Tbsp vinegar, and 1 Tsp chili powder."
    }
  },
  "modelUsed": "groq",
} as const satisfies MealGenerationDataResponse;
