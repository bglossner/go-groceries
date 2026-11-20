import { Next } from 'hono';
import { AppContext } from '../types';

function headers(c: AppContext): Record<string, string> {
  const result: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  if (!c.req.path.startsWith('/v2/')) result['Access-Control-Allow-Origin'] = '*';
  else {
    result['Vary'] = 'Origin';
    const origin = c.req.header('Origin');
    const allowed = (c.env.CORS_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
    if (origin && allowed.includes(origin) && /^https?:\/\//.test(origin)) result['Access-Control-Allow-Origin'] = origin;
    result['Cache-Control'] = 'private, no-store';
    result['Referrer-Policy'] = 'no-referrer';
  }
  return result;
}
export const corsEndpoint = (c: AppContext) => c.body(null, 204, headers(c));
export const corsHandlerMiddleware = async (c: AppContext, next: Next) => {
  await next();
  Object.entries(headers(c)).forEach(([key, value]) => c.res.headers.set(key, value));
};
