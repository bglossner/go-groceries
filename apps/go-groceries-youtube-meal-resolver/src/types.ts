import type { Context } from "hono";

export type AppContext = Context<{ Bindings: Env }>;

export interface GenerateMealDataInput {
  url: string;
  availableTags?: string[];
  pass: string;
}
