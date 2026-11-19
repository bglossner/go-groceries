import { z } from 'zod';
import type { ImageUploadInput } from '@go-groceries/frontend/image-assets';
import { ErrorWrapper } from '../types';
import { uploadInput, uuid } from './validation';

const expiry = z.number().int().positive();
const uploadCapability = z.object({ kind: z.literal('upload'), collectionId: uuid, uploadId: uuid,
  image: uploadInput, expiresAt: expiry }).strict();
const shareCapability = z.object({ kind: z.literal('share'), collectionId: uuid, snapshotId: uuid,
  expiresAt: expiry }).strict();
const capability = z.union([uploadCapability, shareCapability]);
export type Capability =
  | { kind: 'upload'; collectionId: string; uploadId: string; image: ImageUploadInput; expiresAt: number }
  | { kind: 'share'; collectionId: string; snapshotId: string; expiresAt: number };
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url');
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
type CapabilityEnv = Pick<Env, 'PASS' | 'CAPABILITY_SECRET'>;
async function signingKey(env: CapabilityEnv) {
  if (!env.CAPABILITY_SECRET || env.CAPABILITY_SECRET.length < 32 || env.CAPABILITY_SECRET === env.PASS) {
    throw new ErrorWrapper({ message: 'Server capability secret is not configured', statusCode: 503 });
  }
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.CAPABILITY_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
// Include the current PASS in the authenticated domain so rotating it invalidates capabilities.
// The key itself remains server-only: recipients get no offline writer-password oracle.
const authenticatedPayload = (payload: string, env: CapabilityEnv) =>
  new TextEncoder().encode(JSON.stringify(['go-groceries:v2:capabilities', env.PASS, payload]));
export async function signCapability(value: Capability, env: CapabilityEnv): Promise<string> {
  const payload = encode(new TextEncoder().encode(JSON.stringify(value)));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(env), authenticatedPayload(payload, env));
  return payload + '.' + encode(new Uint8Array(signature));
}
export async function verifyCapability(token: string, env: CapabilityEnv, now: number): Promise<Capability> {
  try {
    if (token.length > 2048) throw new Error('Token too long');
    const parts = token.split('.');
    if (parts.length !== 2) throw new Error('Malformed token');
    const [payload, signature] = parts as [string, string];
    if (!await crypto.subtle.verify('HMAC', await signingKey(env), decode(signature), authenticatedPayload(payload, env))) throw new Error('Bad signature');
    const result = capability.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(decode(payload))));
    if (result.expiresAt <= Math.floor(now / 1000)) throw new Error('Expired token');
    return result as Capability;
  } catch (error) {
    if (error instanceof ErrorWrapper) throw error;
    throw new ErrorWrapper({ message: 'Invalid or expired capability', statusCode: 403 });
  }
}
