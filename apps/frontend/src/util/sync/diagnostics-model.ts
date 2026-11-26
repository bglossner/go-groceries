import { z } from 'zod';

export const logByteLimit = 128 * 1024;
export const logRunLimit = 5;
export const logStepLimit = 192;
const encoder = new TextEncoder();
export const logBytes = (value: string) => encoder.encode(value).length;

export const stepLabels = {
  wait: ['Wait for sync access', 'Local'],
  authorize: ['Check writer authorization', 'Local'],
  location: ['Check sync location and pending snapshot', 'Local'],
  latest: ['Check latest snapshot', 'snapshots/latest'],
  freeze: ['Prepare metadata and check local photos', 'Local'],
  skipped: ['Skip photo', 'Local'],
  previousSkips: ['Photos skipped during earlier preparation', 'Local'],
  validate: ['Validate frozen snapshot', 'Local'],
  prepare: ['Prepare images', 'images/prepare'],
  checkImage: ['Check local image', 'Local'],
  upload: ['Upload image', 'R2 staging PUT'],
  complete: ['Complete image', 'images/complete'],
  reuse: ['Reuse verified cloud images', 'Local'],
  reconcile: ['Save image verification', 'Local'],
  commit: ['Commit metadata', 'snapshots/commit'],
  publish: ['Publish latest snapshot', 'snapshots/publish'],
  finalize: ['Update local sync state', 'Local'],
} as const;

export type StepKind = keyof typeof stepLabels;
export type ImageOwner = { kind: PhotoKind; name?: string; additional?: number };
const photoKinds = ['meal', 'recipe', 'draft recipe', 'restaurant', 'menu item'] as const;
export type PhotoKind = typeof photoKinds[number];

// A whole title is kept or dropped. Removing fragments could turn a credential
// into display text that would pass a subsequent read or export check.
export function safePhotoName(value: unknown, writerPass?: string): string | undefined {
  if (typeof value !== 'string' || value.length > 160 || /[\p{Cc}\p{Cf}]/u.test(value)) return;
  if (writerPass && value.includes(writerPass)) return;
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  // Uppercase folds Greek final sigma without a word-boundary dependency.
  const folded = name.toUpperCase();
  const pass = writerPass?.normalize('NFKC').toUpperCase().trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80 || (pass && folded.includes(pass))) return;
  if (!/^[\p{L}\p{M}\p{N} '’(),&!+-]+$/u.test(name) ||
      /\b(?:bearer|token|signature|credential|password|passphrase|passcode|secret|api[- ]?key|private[- ]?key|writer[- ]?pass)\b/i.test(name) ||
      /\b(?:basic|digest|negotiate|ntlm)\s+[a-z0-9+-]/i.test(name) ||
      /\b(?:AKIA|ASIA|AIDA|AROA)[A-Z0-9]{16}\b/.test(folded) ||
      /[\p{L}\p{N}-]{24,}|\d{6,}/u.test(name)) return;
  return name;
}

const commonWorkerErrors: Partial<Record<number, readonly string[]>> = {
  400: ['Invalid v2 request or metadata', 'Invalid JSON body', 'JSON body required'],
  403: ['Invalid pass provided'],
  413: ['Body exceeds size limit'],
  502: ['Storage operation failed'],
  503: ['Shared pass is not configured'],
};
const endpointWorkerErrors: Partial<Record<StepKind, Partial<Record<number, readonly string[]>>>> = {
  prepare: { 409: ['Asset descriptor conflicts with stored object'], 503: ['Server capability secret is not configured'] },
  complete: {
    400: ['Invalid image container or dimensions', 'Uploaded size or SHA-256 does not match'],
    403: ['Invalid or expired capability', 'Upload capability required'],
    404: ['Object not found'],
    409: ['Asset descriptor conflicts with stored object', 'Immutable object or latest revision conflict'],
    413: ['Object exceeds size limit'],
    503: ['Server capability secret is not configured'],
  },
  latest: { 404: ['Object not found'], 413: ['Object exceeds size limit'] },
  commit: {
    404: ['Object not found'],
    409: ['Asset descriptor conflicts with stored object', 'Immutable object or latest revision conflict'],
    413: ['Snapshot exceeds size limit', 'Object exceeds size limit'],
  },
  publish: { 404: ['Object not found'], 409: ['Immutable object or latest revision conflict'], 413: ['Object exceeds size limit'] },
};

export function approvedWorkerError(kind: StepKind, status: number, value: unknown) {
  const endpoint = endpointWorkerErrors[kind];
  if (!endpoint || typeof value !== 'string') return;
  return endpoint[status]?.find(message => message === value) ?? commonWorkerErrors[status]?.find(message => message === value);
}

const skippedReasons = [
  'The cached photo is invalid.',
  'The photo is too large to process safely.',
  'The cached photo failed its integrity check.',
  'Only JPEG, PNG and WebP photos can sync.',
  'Only JPEG, PNG and static WebP photos can sync.',
  'The photo container is invalid or unsupported.',
  'The photo could not be decoded.',
  'A cloud copy could not be saved within the image limits.',
  'The cached cloud copy failed its integrity check.',
  'Cloud storage rejected its container or dimensions.',
] as const;
export const approvedSkipReason = (value: unknown) => skippedReasons.find(reason => reason === value);

const count = z.number().int().min(0).max(2 ** 31 - 1);
const timestamp = z.number().int().min(0).max(8.64e15);
const imageType = z.enum(['image/jpeg', 'image/png', 'image/webp']);
export const declaredImageTypes = [...imageType.options, 'image/gif', 'image/bmp', 'image/avif',
  'image/heic', 'image/heif', 'image/svg+xml'] as const;
const imageSchema = z.object({
  index: count,
  total: count,
  declared: z.enum(declaredImageTypes).optional(),
  detected: imageType.optional(),
  bytes: count.optional(),
  width: count.optional(),
  height: count.optional(),
  owner: z.object({
    kind: z.enum(photoKinds),
    name: z.unknown().transform(value => safePhotoName(value)).optional(),
    additional: count.optional(),
  }).optional(),
});
const attemptSchema = z.object({
  startedAt: timestamp,
  elapsed: count.optional(),
  status: z.number().int().min(100).max(599).optional(),
  outcome: z.enum(['pending', 'response', 'network', 'timeout', 'invalid']),
  workerError: z.unknown().optional(),
});
const stepSchema = z.object({
  sequence: count,
  kind: z.enum(Object.keys(stepLabels) as [StepKind, ...StepKind[]]),
  startedAt: timestamp,
  elapsed: count.optional(),
  outcome: z.enum(['pending', 'succeeded', 'failed', 'warning']),
  attempts: z.array(attemptSchema).max(3),
  image: imageSchema.optional(),
  range: z.object({ first: count, last: count, total: count }).optional(),
  count: count.optional(),
  reason: z.enum(skippedReasons).optional(),
}).transform(step => ({
  ...step,
  attempts: step.attempts.map(attempt => ({
    ...attempt,
    workerError: approvedWorkerError(step.kind, attempt.status ?? 0, attempt.workerError),
  })),
}));

const trigger = z.enum(['setup', 'manual', 'scheduled', 'debounced']);
export type SyncTrigger = z.infer<typeof trigger>;
export const runSchema = z.object({
  version: z.literal(1),
  id: z.uuid(),
  startedAt: timestamp,
  endedAt: timestamp.optional(),
  trigger,
  outcome: z.enum(['unknown', 'succeeded', 'failed']),
  omitted: count,
  photoSkips: count.optional(),
  steps: z.array(stepSchema).max(logStepLimit),
});
export type DiagnosticRun = z.output<typeof runSchema>;
export function photoSkipCount(run: DiagnosticRun) {
  return run.photoSkips ?? run.steps.reduce((total, step) => total +
    (step.kind === 'skipped' ? 1 : step.kind === 'previousSkips' ? step.count ?? 0 : 0), 0);
}
export type DiagnosticStep = DiagnosticRun['steps'][number];
export type DiagnosticImage = NonNullable<DiagnosticStep['image']>;
export type DiagnosticAttempt = DiagnosticStep['attempts'][number];
export type AttemptOutcome = Exclude<DiagnosticAttempt['outcome'], 'pending'>;

export const triggerLabels: Record<SyncTrigger, string> = {
  setup: 'Initial setup', manual: 'Manual', scheduled: 'Scheduled', debounced: 'Automatic',
};
export const outcomeLabels: Record<DiagnosticRun['outcome'], string> = {
  unknown: 'Outcome unknown', succeeded: 'Succeeded', failed: 'Failed',
};

export function stepTitle(step: DiagnosticStep) {
  const label = stepLabels[step.kind][0];
  if (step.image) return `${label} ${step.image.index} of ${step.image.total}`;
  if (step.range) {
    const { first, last, total } = step.range;
    return `Prepare images ${first}–${last} of ${total}`;
  }
  if (step.kind === 'reuse') return `Reuse ${step.count} verified cloud ${step.count === 1 ? 'image' : 'images'}`;
  if (step.kind === 'previousSkips') return `${step.count} ${step.count === 1 ? 'photo' : 'photos'} skipped during earlier preparation`;
  return label;
}

export function attemptStatus(attempt: DiagnosticAttempt) {
  if (attempt.status !== undefined) return `HTTP ${attempt.status}`;
  return attempt.outcome === 'pending' ? 'Awaiting response' : 'No response';
}

export function attemptMessage(attempt: DiagnosticAttempt) {
  if (attempt.workerError) return attempt.workerError;
  if (attempt.outcome === 'network') return 'The browser could not reach or read the response. A network or CORS failure is possible.';
  if (attempt.outcome === 'timeout') return 'The request timed out.';
  if (attempt.outcome === 'invalid') return 'The response could not be read or validated.';
  if (attempt.status && attempt.status >= 400) return `Request failed with HTTP ${attempt.status}.`;
}

export function stepStatus(step: DiagnosticStep) {
  const attempt = step.attempts.at(-1);
  if (attempt) return attemptStatus(attempt);
  return { pending: 'Started', succeeded: 'Passed', failed: 'Failed', warning: 'Warning' }[step.outcome];
}

export function stepMessage(step: DiagnosticStep) {
  if (step.kind === 'skipped') return step.reason ?? 'The photo did not pass local checks.';
  if (step.outcome !== 'failed') return;
  const attempt = step.attempts.at(-1);
  if (attempt && (attempt.outcome !== 'response' || (attempt.status && attempt.status >= 400))) return attemptMessage(attempt);
  if (attempt?.status) return 'The response failed a local validation check.';
  if (step.kind === 'authorize') return 'Check the writer pass in Settings.';
  if (step.kind === 'checkImage') return 'The photo was missing, or its descriptor or cached data did not pass validation.';
  return 'The local sync step could not finish.';
}

export function imageFields(image: DiagnosticImage, includeName: boolean): [string, string][] {
  const { owner } = image;
  return [
    ...(owner?.name && includeName ? [['Photo for', owner.name + (owner.additional ? ` (+${owner.additional} ${owner.additional === 1 ? 'reference' : 'references'})` : '')] as [string, string]] : []),
    ['Declared type', image.declared ?? 'Unknown'],
    ['Detected locally', image.detected ?? 'Unknown'],
    ['Size', image.bytes === undefined ? 'Unknown' : `${image.bytes.toLocaleString()} bytes`],
    ['Dimensions', image.width && image.height ? `${image.width} × ${image.height} px` : 'Unknown'],
  ];
}

export const elapsedLabel = (ms: number | undefined) => ms === undefined ? 'Unknown' : `${ms.toLocaleString()} ms`;

export function syncReport(input: DiagnosticRun, includeNames = false) {
  const parsed = runSchema.safeParse(input);
  if (!parsed.success) return '';
  const run = parsed.data;
  const lines = [`Go Groceries · Sync diagnostics`,
    `${outcomeLabels[run.outcome]} · ${triggerLabels[run.trigger]}`,
    `Started ${new Date(run.startedAt).toISOString()}`,
    `Ended ${run.endedAt === undefined ? 'Unknown' : new Date(run.endedAt).toISOString()}`];
  const skips = photoSkipCount(run);
  if (skips) lines.push(`Photo skips: ${skips}`);
  const rows = run.steps.map(step => [
    `${stepTitle(step)} | ${stepLabels[step.kind][1]} | ${stepStatus(step)} | ${elapsedLabel(step.elapsed)}`,
    stepMessage(step),
    ...step.attempts.map((attempt, i) =>
      `Attempt ${i + 1} · ${attemptStatus(attempt)} · ${elapsedLabel(attempt.elapsed)}${attemptMessage(attempt) ? ` · ${attemptMessage(attempt)}` : ''}`),
    ...(step.image ? imageFields(step.image, includeNames &&
      ['meal', 'recipe', 'draft recipe'].includes(step.image.owner?.kind ?? '')).map(([label, value]) => `${label} ${value}`) : []),
  ].filter(Boolean).join('\n'));
  let size = logBytes(lines.join('\n'));
  let omitted = run.omitted;
  // Keep space for the omission notice, and never cut off a step mid-line.
  for (const row of rows) {
    const bytes = logBytes(row) + 1;
    if (size + bytes > logByteLimit - 100) { omitted++; continue; }
    size += bytes;
    lines.push(row);
  }
  if (omitted) lines.push(`${omitted} steps omitted.`);
  return lines.join('\n');
}
