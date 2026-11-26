import {
  approvedSkipReason, approvedWorkerError, logByteLimit, logBytes, logRunLimit, logStepLimit, runSchema,
  type AttemptOutcome, type DiagnosticImage, type DiagnosticRun, type DiagnosticStep, type StepKind, type SyncTrigger,
} from './diagnostics-model';

const prefix = 'go-groceries:sync-log:v1:';
const generationKey = `${prefix}generation`;
const runPrefix = `${prefix}run:`;
const lockName = `${prefix}storage`;
const runKey = (generation: string, id: string) => `${runPrefix}${generation}:${id}`;

const pending = new Map<string, { run: DiagnosticRun; generation: string }>();
const temporary = new Map<string, DiagnosticRun>();
const changeEvent = `${prefix}change`;
let generation = '0';
let storedGeneration = '0';
let clearIsTemporary = false;
let storageUnavailable = false;
let flushQueued = false;

function notify() {
  window.dispatchEvent(new Event(changeEvent));
}

export function subscribeToSyncLog(listener: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key === null || event.key.startsWith(prefix)) listener();
  }
  window.addEventListener(changeEvent, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(changeEvent, listener);
    window.removeEventListener('storage', onStorage);
  };
}

function syncGeneration(storage: Storage) {
  const current = storage.getItem(generationKey) ?? '0';
  if (current !== storedGeneration) {
    storedGeneration = generation = current;
    clearIsTemporary = false;
    storageUnavailable = false;
    temporary.clear();
    for (const [id, entry] of pending) if (entry.generation !== current) pending.delete(id);
  }
}

function diagnosticKeys(storage: Storage) {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(runPrefix)) keys.push(key);
  }
  return keys;
}

function storedRuns(storage: Storage) {
  const runs = new Map<string, DiagnosticRun>();
  const keys = diagnosticKeys(storage);
  for (const key of keys) {
    if (!key.startsWith(`${runPrefix}${generation}:`)) continue;
    const raw = storage.getItem(key);
    if (!raw || raw.length > logByteLimit || logBytes(raw) > logByteLimit) continue;
    try {
      const run = runSchema.safeParse(JSON.parse(raw));
      if (run.success && key === runKey(generation, run.data.id)) runs.set(run.data.id, run.data);
    } catch { /* An unreadable record has no renderable fields. */ }
  }
  return { runs, keys };
}

// Keep the last step as the interruption checkpoint and prioritize failed steps.
function removableStep(steps: DiagnosticStep[]) {
  const routine = steps.findIndex((step, index) => index < steps.length - 1 &&
    (step.outcome === 'succeeded' || step.outcome === 'warning'));
  return routine === -1 ? 0 : routine;
}

function retain(runs: Iterable<DiagnosticRun>) {
  let remaining = logByteLimit - 2; // JSON array brackets
  const entries: { run: DiagnosticRun; raw: string }[] = [];
  const newest = [...runs].sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id)).slice(0, logRunLimit);
  for (let run of newest) {
    let raw = JSON.stringify(run);
    if (entries.length === 0 && logBytes(raw) > remaining) {
      run = { ...run, steps: [...run.steps] };
      while (run.steps.length > 1 && logBytes(raw) > remaining) {
        run.steps.splice(removableStep(run.steps), 1);
        run.omitted++;
        raw = JSON.stringify(run);
      }
    }
    const size = logBytes(raw) + (entries.length ? 1 : 0);
    if (size > remaining) break;
    remaining -= size;
    entries.push({ run, raw });
  }
  return entries;
}

function availableRuns() {
  try {
    const storage = window.localStorage;
    syncGeneration(storage);
    return storedRuns(storage);
  } catch {
    storageUnavailable = true;
    return { runs: new Map<string, DiagnosticRun>(), keys: [] };
  }
}

export function readSyncLog() {
  const { runs } = availableRuns();
  for (const [id, run] of temporary) runs.set(id, run);
  for (const { run, generation: from } of pending.values()) {
    if (from !== generation) continue;
    const safe = runSchema.safeParse(run);
    if (safe.success) runs.set(safe.data.id, safe.data);
  }
  return {
    runs: retain(runs.values()).map(entry => entry.run),
    temporary: storageUnavailable || clearIsTemporary || temporary.size > 0,
  };
}

function flush() {
  flushQueued = false;
  const { runs, keys } = availableRuns();
  const writingGeneration = generation;
  for (const [id, run] of temporary) runs.set(id, run);
  const dirty = new Set(temporary.keys());
  for (const [id, entry] of pending) {
    if (entry.generation !== generation) continue;
    const safe = runSchema.safeParse(entry.run);
    if (!safe.success) continue;
    runs.set(id, safe.data);
    dirty.add(id);
  }
  pending.clear();
  if (!dirty.size) return;
  const retained = retain(runs.values());
  try {
    const storage = window.localStorage;
    syncGeneration(storage);
    if (generation !== writingGeneration) return;
    if (clearIsTemporary) persistGeneration(storage, writingGeneration, keys);
    const currentKeys = retained.map(({ run }) => runKey(writingGeneration, run.id));
    const current = new Set(currentKeys);
    for (const key of keys) if (!current.has(key)) storage.removeItem(key);
    for (const [index, { run, raw }] of retained.entries()) {
      if (!dirty.has(run.id)) continue;
      const key = currentKeys[index];
      storage.setItem(key, raw);
      syncGeneration(storage);
      if (generation !== writingGeneration) {
        storage.removeItem(key);
        return;
      }
    }
    // Per-run keys prevent lost updates without Web Locks. Reconcile with a
    // fresh inventory after writing so crossed writes cannot leave both tabs'
    // distinct additions on disk past the retention limits.
    const latest = storedRuns(storage);
    const kept = new Set(retain(latest.runs.values()).map(({ run }) => runKey(writingGeneration, run.id)));
    syncGeneration(storage);
    if (generation !== writingGeneration) return;
    for (const key of latest.keys) if (!kept.has(key)) storage.removeItem(key);
    storageUnavailable = false;
    temporary.clear();
  } catch {
    storageUnavailable = true;
    temporary.clear();
    for (const { run } of retained) temporary.set(run.id, run);
  } finally {
    notify();
  }
}

// A timer coalesces adjacent checkpoints. Sync never awaits storage, its lock,
// or failure diagnostics. pagehide can flush the last queued checkpoint.
function scheduleFlush() {
  if (flushQueued) return;
  flushQueued = true;
  window.setTimeout(() => {
    if (!flushQueued) return;
    try {
      if (navigator.locks) void navigator.locks.request(lockName, flush).catch(() => safely(flush));
      else safely(flush);
    } catch { safely(flush); }
  }, 0);
}

let observingPage = false;
function observePage() {
  if (observingPage) return;
  window.addEventListener('pagehide', () => { if (flushQueued) safely(flush); });
  observingPage = true;
}

function persistGeneration(storage: Storage, next: string, keys: string[]) {
  const oldPrefix = `${runPrefix}${storedGeneration}:`;
  try { storage.setItem(generationKey, next); }
  catch {
    // At quota the first generation marker may need the space used by old runs.
    for (const key of keys) storage.removeItem(key);
    storage.setItem(generationKey, next);
  }
  storedGeneration = generation = next;
  clearIsTemporary = storageUnavailable = false;
  // Scan again for an old-generation write that landed just before the marker.
  const obsolete = new Set([...keys, ...diagnosticKeys(storage).filter(key => key.startsWith(oldPrefix))]);
  for (const key of obsolete) if (!key.startsWith(`${runPrefix}${next}:`)) storage.removeItem(key);
}

function clear() {
  const next = crypto.randomUUID();
  pending.clear();
  temporary.clear();
  try {
    const storage = window.localStorage;
    syncGeneration(storage);
    persistGeneration(storage, next, diagnosticKeys(storage));
  } catch {
    if (storedGeneration !== next) clearIsTemporary = true;
    generation = next;
    storageUnavailable = true;
  } finally {
    notify();
  }
}

export async function clearSyncLog() {
  try {
    if (navigator.locks) await navigator.locks.request(lockName, clear);
    else clear();
  } catch { safely(clear); }
}

// These guards are also used for diagnostics-only work at the call sites.
export function safely<T>(action: () => T): T | undefined {
  try { return action(); } catch { return undefined; }
}

export type ObserveAttempt = () => (outcome: AttemptOutcome, status?: number, workerError?: unknown) => void;
const duration = (from: number) => Math.max(0, Math.round(performance.now() - from));
type StepFields = Pick<DiagnosticStep, 'image' | 'range' | 'count' | 'reason'>;

function createRecorder(trigger: SyncTrigger) {
  safely(() => syncGeneration(window.localStorage));
  observePage();
  const run: DiagnosticRun = { version: 1, id: crypto.randomUUID(), trigger, startedAt: Date.now(),
    outcome: 'unknown', omitted: 0, steps: [] };
  const runGeneration = generation;
  let sequence = 0;
  function checkpoint() {
    if (generation !== runGeneration) return;
    pending.set(run.id, { generation: runGeneration, run });
    if (pending.size > logRunLimit) {
      const oldest = pending.keys().next().value;
      if (oldest) pending.delete(oldest);
    }
    scheduleFlush();
  }

  function start(kind: StepKind, fields: StepFields = {}) {
    const began = performance.now();
    const step: DiagnosticStep = { ...fields, kind, sequence: sequence++, startedAt: Date.now(), outcome: 'pending', attempts: [] };
    run.steps.push(step);
    if (run.steps.length > logStepLimit) {
      run.steps.splice(removableStep(run.steps), 1);
      run.omitted++;
    }
    checkpoint();
    const attempt: ObserveAttempt = () => {
      const started = performance.now();
      const receipt: DiagnosticStep['attempts'][number] = { startedAt: Date.now(), outcome: 'pending', workerError: undefined };
      step.attempts.push(receipt);
      safely(checkpoint);
      return (outcome, status, workerError) => {
        if (receipt.outcome === 'pending' || outcome === 'invalid') {
          receipt.outcome = outcome;
          receipt.elapsed = duration(started);
          if (status && Number.isInteger(status) && status >= 100 && status <= 599) receipt.status = status;
        }
        receipt.workerError = approvedWorkerError(kind, receipt.status ?? 0, workerError);
        safely(checkpoint);
      };
    };
    return {
      attempt,
      finish(outcome: DiagnosticStep['outcome']) {
        step.outcome = outcome;
        step.elapsed = duration(began);
        checkpoint();
      },
    };
  }

  const wait = start('wait');
  return {
    start,
    refresh: () => safely(checkpoint),
    acquired: () => safely(() => wait.finish('succeeded')),
    warning: (kind: 'skipped' | 'previousSkips', data: { image?: DiagnosticImage; count?: number; reason?: unknown }) => {
      safely(() => {
        run.photoSkips = (run.photoSkips ?? 0) + (kind === 'skipped' ? 1 : data.count ?? 0);
        start(kind, { image: data.image, count: data.count, reason: approvedSkipReason(data.reason) }).finish('warning');
      });
    },
    reuse: (count: number) => safely(() => start('reuse', { count }).finish('succeeded')),
    finish(outcome: 'succeeded' | 'failed') {
      safely(() => {
        if (run.steps.length === 1) wait.finish(outcome);
        run.endedAt = Date.now();
        run.outcome = outcome;
        checkpoint();
      });
    },
  };
}

export type SyncRecorder = ReturnType<typeof createRecorder>;
export const beginSyncRun = (trigger: SyncTrigger) => safely(() => createRecorder(trigger));

export async function logStep<T>(recorder: SyncRecorder | undefined, kind: StepKind,
  action: (observe?: ObserveAttempt) => T | Promise<T>, fields?: StepFields): Promise<T> {
  const step = safely(() => recorder?.start(kind, fields));
  try {
    const result = await action(step?.attempt);
    safely(() => step?.finish('succeeded'));
    return result;
  } catch (error) {
    safely(() => step?.finish('failed'));
    throw error;
  }
}

export const startAttempt = (observe?: ObserveAttempt) => safely(() => observe?.());
export const networkOutcome = (error: unknown) => error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'network';
