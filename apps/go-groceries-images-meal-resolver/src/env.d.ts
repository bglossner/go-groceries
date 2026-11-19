interface Env {
  /** Comma-separated exact origins for v2 browser access; unset allows none. */
  CORS_ALLOWED_ORIGINS?: string;
  /** Server-only signing secret, provisioned by the operator; never the writer pass. */
  CAPABILITY_SECRET?: string;
}
