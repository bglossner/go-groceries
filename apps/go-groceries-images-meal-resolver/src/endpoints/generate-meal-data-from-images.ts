import { AppContext, GenerateMealDataInput } from "../types";

export const generateMealData = async (c: AppContext) => {
  let body: GenerateMealDataInput;
  try {
    body = await c.req.json<GenerateMealDataInput>();
  } catch (err) {
    return c.json({ error: 'Invalid or missing JSON body' }, 400);
  }
};
