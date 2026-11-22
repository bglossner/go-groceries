import type { AppContext } from '../types';

type StorageOperation = 'HeadObject' | 'ListObjects' | 'GetObject' | 'PutObject' | 'DeleteObject' | 'PresignGetObject' | 'PresignPutObject' | 'FileRetrieval';
type ErrorDetails = {
  name?: unknown; Code?: unknown; code?: unknown; message?: unknown; cause?: unknown;
  $metadata?: { httpStatusCode?: unknown; requestId?: unknown; extendedRequestId?: unknown; cfId?: unknown };
};
const details = (value: unknown): ErrorDetails => typeof value === 'object' && value !== null ? value as ErrorDetails : {};

/** Emit only identifiers and known transport descriptions, never raw SDK errors or requests. */
export function logStorageError(c: AppContext, operation: StorageOperation, error: unknown): void {
  const sensitive = [c.env.PASS, c.env.R2_ACCESS_KEY_ID, c.env.R2_ACCESS_KEY_SECRET,
    c.env.R2_ACCOUNT_ID, c.env.R2_BUCKET_NAME, c.env.CAPABILITY_SECRET].filter(Boolean);
  const identifier = (value: unknown): string | undefined =>
    typeof value === 'string' && /^[A-Za-z0-9_./+=:-]{1,256}$/.test(value) &&
    !value.includes('://') && !sensitive.some(secret => value.includes(secret)) ? value : undefined;
  const networkMessage = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    // Messages can embed an endpoint, signature or credentials: retain only a fixed description.
    if (/certificate|self[- ]signed|unable to verify|unknown ca/i.test(value)) return 'TLS certificate validation failed';
    if (/tls|ssl|handshake/i.test(value)) return 'TLS connection failed';
    if (/ENOTFOUND|EAI_AGAIN|dns|getaddrinfo/i.test(value)) return 'DNS lookup failed';
    if (/ECONNREFUSED|connection refused/i.test(value)) return 'Connection refused';
    if (/ECONNRESET|connection reset/i.test(value)) return 'Connection reset';
    if (/timeout|timed out|ETIMEDOUT/i.test(value)) return 'Connection timed out';
    if (/network connection lost/i.test(value)) return 'Network connection lost';
    if (/fetch failed|failed to fetch/i.test(value)) return 'Fetch failed';
    if (/proxy|tunnel/i.test(value)) return 'Proxy connection failed';
    if (/internal error/i.test(value)) return 'Internal transport error';
    return 'Transport details omitted';
  };
  const failure = details(error);
  const metadata = failure.$metadata;
  const network = [];
  // Some fetch runtimes report transport failure directly; others wrap it in cause chains.
  if (typeof metadata?.httpStatusCode !== 'number') {
    let current: unknown = error;
    const visited = new Set<unknown>();
    for (let depth = 0; current && depth < 5 && !visited.has(current); depth++) {
      visited.add(current);
      const cause = details(current);
      network.push({ name: identifier(cause.name), code: identifier(cause.code), message: networkMessage(cause.message) });
      current = cause.cause;
    }
  }
  console.error(JSON.stringify({
    event: 'r2_storage_error', operation,
    errorName: identifier(failure.name), r2Code: identifier(failure.Code ?? failure.code),
    httpStatusCode: typeof metadata?.httpStatusCode === 'number' ? metadata.httpStatusCode : undefined,
    requestId: identifier(metadata?.requestId), extendedRequestId: identifier(metadata?.extendedRequestId), cfId: identifier(metadata?.cfId),
    ...(network.length ? { network } : {}),
  }));
}
