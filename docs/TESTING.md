# Regression testing

Run from the repository root with Node 22 and the locked dependencies:

```sh
npm ci
npm test
npm run test:e2e
npm run test:types
npm run lint --workspace @go-groceries/frontend
npm run build
```

`npm test` runs Vitest through Turbo in all four packages, without a browser or service. Tests run directly from source, including the shared HTTP contracts. Each package also has its own `npm test`; a focused example is:

```sh
npm test --workspace @go-groceries/frontend -- tests/database.test.mjs -t 'backup frozen-snapshot'
```

`npm run test:types` runs the root build, then forces all four package compiler checks. Turbo builds dependency exports before their consumers, so plain `npm run build` also works from a clean checkout. This guards the Worker type-isolation regression that a successful Wrangler build alone does not detect. Each command prints its own exit code and stops on failure.

## Coverage

| Suite | Permanent checks |
| --- | --- |
| Shared backend | Error identity/status/message; model default, lazy loading, reuse, allowlist, registration and failed-load retry. |
| Images Worker | Actual Hono `app.fetch`, fake Env, in-memory S3 commands and real SDK signing/serialization. Legacy authentication, key restrictions, 404/502 mapping and safe logs; v2 format/size/hash validation, streaming limits, immutable promotion, retry/dedup, signed lifetimes, snapshot validation, conditional latest publication, share scope/expiry/pass rotation and CORS. The ordered 23-check protocol lifecycle is one test; its transitions share state within that test. |
| YouTube Worker | Actual handler, mocked YouTube/Groq SDK clients. URL formats, request rejection, comment pagination/filtering, prompt and response shape, thumbnails, SDK reuse, response cache/bypass, model choice/fallback and generic upstream errors. |
| Frontend build | Compiles build-node into a fresh temporary output directory and checks every declared package export. Stale build files cannot hide an incorrect inferred TypeScript source root. |
| Frontend database | Real Dexie on fake IndexedDB: v14 -> v15, exact bytes, checkpoints/resumption, legacy repair and ambiguity/race controls, image dedup/verification, File metadata, portable round trip, invalid-import retention, frozen backup with a queued writer, meal/recipe/pending creation and DOM download. The already committed image-migration browser harness also runs in this suite. |
| Frontend sync | Real frontend functions and actual Images Worker with in-memory storage: upload/complete/commit/publish ordering, repeat dedup, pending publication recovery, staged diffs and replacement, hydration/expiry renewal/corruption/retry, pass-free shares, scope/session rejection, v1 import, legacy status messages and bounded JSON/retry behavior. |
| Frontend core DOM | Real React and query components: ingredient aggregation, source labels, store partitioning, shared checklist persistence/reset, custom usage creation/decrement, meal tags/validation and date hooks/migration. |
| Browser | Meal/list regression workflows plus restaurant cards/tabs at 390 and 1180px, local Worker/R2 round trips, old backup cancellation, full hidden draft retention, 360px drawer/fixed editor-bar checks and the 500/5,000/10,000/500 stress probe. A second owned static-server phase builds pwa-test, awaits service-worker control/precache and tests offline deep-route CRUD/ratings/photos/settings and uncached-photo eviction at 360px. Existing workflows: create meal and recipe image/thumbnail, create grocery list with store partitioning/checklist; UI export/import with identical metadata and byte hashes; UI sync up/down against the local Worker/R2 stub with visible hydrated thumbnails. |

The five earlier residual bugs are `test.todo` entries: named-store search, list deletion usage counts, mixed date-key ordering, stale import success, and the missing PWA reload toast. They remain unchanged. Browser coverage is Chromium at phone, 360px and desktop widths; camera hardware and production service accounts are outside this suite.

## Browser setup and isolation

On a normal Linux machine or WSL, install Chromium once with `npm exec playwright -- install chromium`, then run `npm run test:e2e`. On Linux the launcher creates separate recorded process groups for Vite, the Worker stub, the test runners, the PWA build and its static server. Vite regression mode binds loopback through configuration without a --host flag. After UI tests pass, Vite is verified and stopped before the built PWA server reuses its port. It refuses occupied ports 18926/18927, binds both servers to 127.0.0.1, checks command/start identity before teardown, and uses fresh browser contexts. Interruptions use the same bounded cleanup path, with a second identity check before escalation. Every spawned group is tracked immediately, including when its leader exits during identity capture. If a leader exits before descendant identities are recorded and its group does not drain, the launcher reports incomplete cleanup and leaves unverifiable processes untouched. Browser requests outside those two origins are aborted; the compressor's optional CDN Worker request is blocked and its bundled fallback runs; sockets outside unit mocks are forbidden. No `.dev.vars`, R2 credentials or existing browser profiles are loaded.

Set `REGRESSION_ARTIFACT_DIR` to retain screenshots, traces, a synthetic backup and process records somewhere specific. It defaults to a new temporary directory. Playwright results use their own subdirectory; browser home/cache/temp state uses a separate short temporary path for Chromium Unix sockets.

On the AL2 host (glibc 2.26), the stock nvm Node 22 binary fails. Use the already installed compatible mise Node and the Chromium used by the earlier regression pass:

```sh
PATH=/local/home/glossner/.local/share/mise/installs/node/22.18.0/bin:$PATH \
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/glossner/.cache/ms-playwright/chromium-1194/chrome-linux/chrome \
npm run test:e2e
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE` accepts a local executable path, including a wrapper that forwards arguments. If a future browser needs newer glibc, a staging-only loader wrapper like the earlier `wrangler-al2-workaround` can scope its libraries to that process; no host or dotfile changes are needed. The stub runs the Hono app in Node, so these tests do not require workerd or the Wrangler workaround.

## Adding tests

Put Vitest files in a package's `tests/` directory with `.test.ts` or `.test.mjs`. Use the real exported behavior and synthetic fixtures. `tests/helpers.mjs` clears the frontend's in-memory database around each test. Mock external SDK clients or storage transport, never the feature being checked. Do not add credentials, real URLs or fixed sleeps to fixtures. Restore spies in `finally` when a failed assertion can leave a barrier active.

Put browser flows in `apps/frontend/tests/e2e/*.spec.mjs`. Use visible controls, fresh contexts, the request guard and awaited DB/DOM postconditions. Create stores or other supporting data in the test-owned context when they are fixtures rather than the action under test. Browser runs have no retries, so timing failures stay visible.

For defect regressions, prove the test fails with the corresponding fix removed in a separate scratch copy, then passes on the branch. The thumbnail proof restores the pre-repair image resolver/migration. The backup proof restores the validator/export transaction wrapping. The clean-build proof restores the pre-fix frontend build tsconfig. Existing feature coverage checks current behavior; it does not require inventing an application change first.

Restaurant feature tests also cover v15-to-v16 preservation, exact cloud limits, independent menu reachability, malformed/old readers, rating rollback, local advanced preferences, fixed-snapshot disclosure, timezone-aware ordering-date validation, retained-photo offline metadata edits and downgrade rejection. See [coordinated rollout and recovery](restaurant-rollout.md). Set REGRESSION_GREP for a focused browser proof; omit it for the full suite. REGRESSION_PHOTO_PATH can point to a staged synthetic PNG for visual comparison; default fixtures are embedded synthetic bytes. Runtime artifacts remain outside the review diff.
