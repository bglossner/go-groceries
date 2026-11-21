# Sync To diagnostics requirements

A phone user can open Settings → Syncing after a v2 Sync To attempt, identify where it stopped, and copy a report for troubleshooting. The same log covers initial setup, Sync Now and automatic uploads. The synthetic failure in the mockup illustrates one plausible failure sequence.

## What to capture

- One record per v2 Sync To attempt. Include start/end timestamps, how it started, and outcome. Keep the last attempted step for interrupted runs and label the outcome unknown when it cannot be established. Retries inside an attempt stay with that run. A new user or scheduled attempt gets a new run.
- Record local checks, each image prepare batch, each staging PUT and image completion, snapshot commit and snapshot publish. Give each step a short label, fixed endpoint category, outcome, and HTTP status when the browser received it. A network or CORS block has no HTTP status and may look identical to other fetch failures. Show the Worker’s `error` message only when it matches an approved static message. Show safe local text for other failures.
- For image steps, include ordinal and total, safe meal or recipe names from the frozen snapshot, declared image type, detected type when available, bytes and pixel dimensions when known. Keep optional fields as **Unknown** when unavailable. A batch failure applies to the batch until the response or local checks identify a specific image.

## Privacy and storage

- Exclude writer passes, share tokens, upload or other capability tokens, signed URLs, full request URLs, raw headers and bodies, exceptions, stack traces, object keys, local filenames, hashes, IDs from sync requests, and image bytes. Capture only explicit fields and refuse unknown Worker messages. Sanitize names before storage and export. Omit a name when it may expose credential material.
- Store a versioned `localStorage` log on this browser profile and origin, outside Dexie, sync, imports, backups and analytics. Keep the newest five runs within 128 KiB serialized UTF-8. Evict oldest runs first. For an oversized individual run, retain its summary, failed or last step, and signal how many routine steps were omitted. Log collection and storage failures must leave the sync result intact. Use an in-memory fallback and show when history is temporary.
- Provide **Copy report** from the diagnostic view, producing bounded plain text. Exclude meal and recipe names by default. Let the user explicitly include safe names and provide selectable text if the browser blocks clipboard access. Provide **Clear log** with confirmation, scoped to diagnostics on this origin. Show an empty state after clearing.

## Open questions

- Should copied reports include safe meal and recipe names by default? Default to explicit inclusion because titles may be personal.
- How much history is useful after repeated automatic retries? Start with five runs and 128 KiB, including successful runs that can serve as a comparison.
