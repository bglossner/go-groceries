import { GenerateMealDataYoutubeRequestInput } from "@go-groceries/frontend/meals";
import type { Context } from "hono";

export type AppContext = Context<{ Bindings: Env }>;

export type GenerateMealDataInput = GenerateMealDataYoutubeRequestInput;
