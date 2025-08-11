import { Next } from "hono";
import { AppContext } from "../types";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // or specific origin
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export const corsEndpoint = (c: AppContext) => {
  return c.body(null, 204, corsHeaders);
};

export const corsHandlerMiddleware = async (c: AppContext, next: Next) => {
  await next();
  Object.entries(corsHeaders).forEach(([k, v]) => c.res.headers.set(k, v));
};
