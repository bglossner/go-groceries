/** Legacy clients generate groceries_backup_<uuid>, with no path segments. */
export function isLegacyKey(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(value);
}
