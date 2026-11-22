import { afterEach, expect, test, vi } from 'vitest';
import { beginSyncRun, clearSyncLog, logStep, readSyncLog } from '../src/util/sync/diagnostics.ts';
import { logByteLimit, logBytes, logRunLimit, logStepLimit, safePhotoName, syncReport } from '../src/util/sync/diagnostics-model.ts';
import { v2Post } from '../src/util/sync/api.ts';

const runPrefix = 'go-groceries:sync-log:v1:run:';
const stored = () => Object.keys(localStorage).filter(key => key.startsWith(runPrefix)).map(key => localStorage.getItem(key));
const flushed = () => new Promise(resolve => setTimeout(resolve, 20));
afterEach(async () => {
  vi.restoreAllMocks();
  await flushed();
  await clearSyncLog();
  localStorage.clear();
});

function recorder(trigger = 'manual') {
  const run = beginSyncRun(trigger);
  run.acquired();
  return run;
}

const image = name => ({ index: 1, total: 2, declared: 'image/png', detected: 'image/png', bytes: 133,
  width: 32, height: 48, owner: { kind: 'meal', name } });

test('credentials and signed URLs stay out of storage and all copy modes', async () => {
  const pass = 'stored writer abc';
  const share = `${'A'.repeat(120)}.${'s'.repeat(43)}`;
  const upload = `${'B'.repeat(163)}.${'u'.repeat(43)}`;
  const signed = 'https://objects.example.invalid/staging/photo?X-Amz-Signature=private-signature';
  const key = 'private/staging/abc';
  const run = recorder();
  const values = [pass, share, upload, signed, key, 'Basic dXNlcjpwYXNzMTIz', 'Basic QTpi', 'AKIAXYZZABCDEFFEDCBA'];
  expect(safePhotoName('Soup αβγδεζσpie', 'ΑΒΓΔΕΖΣ')).toBeUndefined();
  for (const value of values) {
    expect(safePhotoName(`Evening soup ${value}`, pass)).toBeUndefined();
    await logStep(run, 'complete', observe => {
      const finish = observe();
      finish('response', 400, value);
      finish('response', 400, { error: value, headers: { Authorization: value } });
    }, { image: image(safePhotoName(`Evening soup ${value}`, pass)) });
  }
  await logStep(run, 'complete', observe => {
    observe()('response', 400, 'Invalid image container or dimensions');
  }, { image: image(safePhotoName('Tomato toast', pass)) });
  await logStep(run, 'upload', () => undefined, { image: image(safePhotoName('Pasta bowl', pass)) });
  run.finish('failed');
  await vi.waitFor(() => expect(stored()).toHaveLength(1));
  const raw = stored()[0];
  expect(raw).toContain('Invalid image container or dimensions');
  const [entry] = readSyncLog().runs;
  const defaultReport = syncReport(entry);
  const named = syncReport(entry, true);
  expect(defaultReport).not.toContain('Tomato toast');
  expect(defaultReport).not.toContain('Pasta bowl');
  expect(named).toContain('Tomato toast');
  expect(named).toContain('Pasta bowl');
  for (const value of values) for (const text of [raw, defaultReport, named]) expect(text).not.toContain(value);

  const record = JSON.parse(raw);
  record.steps.at(-1).extra = signed;
  record.steps.at(-1).image.owner.name = signed;
  record.steps.at(-2).attempts[0].workerError = upload;
  const [keyName] = Object.keys(localStorage).filter(key => key.startsWith(runPrefix));
  localStorage.setItem(keyName, JSON.stringify(record));
  const [readBack] = readSyncLog().runs;
  expect(JSON.stringify(readBack)).not.toContain(signed);
  expect(syncReport(readBack, true)).not.toContain(upload);
});

test('one logical API step records HTTP retries, no response, and the final reply', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ error: 'Storage operation failed' }, { status: 502 }))
    .mockRejectedValueOnce(new TypeError('private-signed-url'))
    .mockResolvedValueOnce(Response.json({}));
  const previousFetch = globalThis.fetch;
  vi.stubGlobal('fetch', fetch);
  try {
    const run = recorder('scheduled');
    await logStep(run, 'prepare', observe => v2Post('images/prepare', {}, { pass: 'sample' }, true, observe));
    run.finish('succeeded');
    await flushed();
    const [entry] = readSyncLog().runs;
    expect(entry.trigger).toBe('scheduled');
    const [step] = entry.steps.filter(step => step.kind === 'prepare');
    expect(step.attempts).toMatchObject([
      { status: 502, workerError: 'Storage operation failed', outcome: 'response' },
      { outcome: 'network' },
      { status: 200, outcome: 'response' },
    ]);
    expect(step.attempts[1].status).toBeUndefined();
    expect(syncReport(entry)).toContain('No response');
    expect(syncReport(entry)).not.toContain('private-signed-url');
  } finally { vi.stubGlobal('fetch', previousFetch); }
});

test('keeps newest five runs, preserves the last checkpoint, then clears active and stored runs', async () => {
  localStorage.setItem('unrelated', 'unchanged');
  for (let i = 0; i < 7; i++) {
    const run = recorder();
    run.finish('succeeded');
    await flushed();
  }
  expect(stored()).toHaveLength(logRunLimit);
  const active = recorder('debounced');
  const step = active.start('upload', { image: image('Evening soup') });
  step.attempt();
  await flushed();
  const [checkpoint] = readSyncLog().runs;
  expect(checkpoint.outcome).toBe('unknown');
  expect(checkpoint.endedAt).toBeUndefined();
  expect(checkpoint.steps.at(-1)).toMatchObject({ kind: 'upload', outcome: 'pending' });
  await clearSyncLog();
  step.finish('failed');
  active.finish('failed');
  await flushed();
  expect(stored()).toHaveLength(0);
  expect(readSyncLog().runs).toHaveLength(0);
  expect(localStorage.getItem('unrelated')).toBe('unchanged');
  const fresh = recorder('setup');
  fresh.finish('succeeded');
  await flushed();
  expect(stored()).toHaveLength(1);
});

test('coalesces large runs within the byte and step limits and protects their failure', async () => {
  const large = recorder();
  const name = '湯 '.repeat(40).trim();
  for (let i = 0; i < logStepLimit + 40; i++) {
    await logStep(large, 'complete', observe => {
      for (let attempt = 0; attempt < 3; attempt++) {
        observe()('response', 400, 'Invalid image container or dimensions');
      }
    }, { image: image(name) });
  }
  const failure = large.start('publish');
  failure.attempt()('response', 409, 'Immutable object or latest revision conflict');
  failure.finish('failed');
  large.finish('failed');
  await flushed();
  const [entry] = readSyncLog().runs;
  expect(logBytes(`[${stored().join(',')}]`)).toBeLessThanOrEqual(logByteLimit);
  expect(entry.steps.length).toBeLessThanOrEqual(logStepLimit);
  expect(entry.omitted).toBeGreaterThan(40);
  expect(entry.steps.at(-1)).toMatchObject({ kind: 'publish', outcome: 'failed' });
  const report = syncReport(entry, true);
  expect(logBytes(report)).toBeLessThanOrEqual(logByteLimit);
  expect(report).toContain('Immutable object or latest revision conflict');
});

test('blocked storage leaves the outcome available as temporary history', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota', 'QuotaExceededError'); });
  const run = recorder();
  expect(await logStep(run, 'freeze', async () => 'unchanged')).toBe('unchanged');
  run.finish('succeeded');
  await flushed();
  expect(readSyncLog()).toMatchObject({ temporary: true, runs: [{ outcome: 'succeeded' }] });
  await clearSyncLog();
  expect(readSyncLog()).toMatchObject({ temporary: true, runs: [] });
});


test('Clear frees diagnostic space for the first generation marker at quota', async () => {
  const marker = 'go-groceries:sync-log:v1:generation';
  localStorage.removeItem(marker);
  localStorage.setItem('unrelated', 'preserved');
  const run = recorder();
  run.finish('succeeded');
  await flushed();
  expect(stored()).toHaveLength(1);
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key === marker && stored().length) throw new DOMException('Full', 'QuotaExceededError');
    return setItem.call(this, key, value);
  });
  await clearSyncLog();
  expect(stored()).toHaveLength(0);
  expect(localStorage.getItem(marker)).toBeTruthy();
  expect(localStorage.getItem('unrelated')).toBe('preserved');
  expect(readSyncLog()).toMatchObject({ temporary: false, runs: [] });
});

test('received HTTP status survives a checkpoint and a later body decode failure', async () => {
  let body;
  const stream = new ReadableStream({ start(controller) { body = controller; } });
  const previousFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async () => new Response(stream, { status: 200 }));
  try {
    const run = recorder();
    const request = logStep(run, 'commit', observe => v2Post('snapshots/commit', {}, { pass: 'sample' }, false, observe));
    await vi.waitFor(() => {
      const checkpoint = JSON.parse(stored()[0] ?? '{}');
      expect(checkpoint.steps?.at(-1)).toMatchObject({ outcome: 'pending', attempts: [{ status: 200 }] });
    });
    body.enqueue(new TextEncoder().encode('not-json'));
    body.close();
    await expect(request).rejects.toThrow('Cloud sync is unavailable');
    run.finish('failed');
    expect(readSyncLog().runs[0].steps.at(-1)).toMatchObject({ outcome: 'failed', attempts: [{ status: 200, outcome: 'invalid' }] });
  } finally { vi.stubGlobal('fetch', previousFetch); }
});

test('reconciles the disk limit after a concurrent unlocked write', async () => {
  for (let i = 0; i < 4; i++) {
    const run = recorder();
    run.finish('succeeded');
    await flushed();
  }
  const setItem = Storage.prototype.setItem;
  const other = { ...JSON.parse(stored().at(-1)), id: crypto.randomUUID(), startedAt: Date.now() + 10 };
  const generation = localStorage.getItem('go-groceries:sync-log:v1:generation') ?? '0';
  const otherKey = `${runPrefix}${generation}:${other.id}`;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key.startsWith(runPrefix)) setItem.call(this, otherKey, JSON.stringify(other));
    return setItem.call(this, key, value);
  });
  const run = recorder();
  run.finish('succeeded');
  await flushed();
  expect(stored()).toHaveLength(5);
  expect(localStorage.getItem(otherKey)).toBeTruthy();
  expect(readSyncLog().runs[0].id).toBe(other.id);
});


test('many nested skip warnings preserve the open preflight step if it later fails', async () => {
  const run = recorder();
  const preflight = run.start('freeze');
  for (let i = 0; i < logStepLimit + 10; i++) {
    run.warning('skipped', { image: image('Soup'), reason: 'The photo could not be decoded.' });
  }
  preflight.finish('failed');
  run.finish('failed');
  await flushed();
  const [entry] = readSyncLog().runs;
  expect(entry.steps).toContainEqual(expect.objectContaining({ kind: 'freeze', outcome: 'failed' }));
  expect(entry.omitted).toBeGreaterThan(0);
});


test('Clear sweeps a run written just before the generation changes', async () => {
  const run = recorder();
  run.finish('succeeded');
  await flushed();
  const existing = JSON.parse(stored()[0]);
  const marker = 'go-groceries:sync-log:v1:generation';
  const late = { ...existing, id: crypto.randomUUID() };
  const lateKey = `${runPrefix}${localStorage.getItem(marker) ?? '0'}:${late.id}`;
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key === marker) setItem.call(this, lateKey, JSON.stringify(late));
    return setItem.call(this, key, value);
  });
  await clearSyncLog();
  expect(stored()).toHaveLength(0);
});
