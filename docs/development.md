# Development and command reference

Commands below describe the checked-in scripts; server, upload, secret-sync and deployment commands were not executed for this documentation task. Root README commands such as `npm run dev` are frontend scripts, not root scripts. Sources: [root README](../README.md), [root package.json](../package.json), [frontend package.json](../apps/frontend/package.json).

## Workspace setup and command scope

The repository declares npm 11.4.2 and workspaces under apps and libraries. Install dependencies from the root in an authorized development environment using `npm ci`; the checked-in package-lock.json is the dependency input. The manifests do not declare a root Node engine requirement, so this guide does not assert an exact runtime version. Sources: [root package.json](../package.json), [package-lock.json](../package-lock.json).

Run a package command from its directory or use npm's workspace selector from root:

```sh
npm run check-types --workspace=@go-groceries/frontend
npm run build --workspace=@go-groceries/backend
```

Selectors use package names, not Worker directory names. Sources: [frontend package.json](../apps/frontend/package.json), [YouTube package.json](../apps/go-groceries-youtube-meal-resolver/package.json), [images package.json](../apps/go-groceries-images-meal-resolver/package.json), [backend package.json](../libraries/shared-backend/package.json).

## Root and Turbo

| Command from root | Scope and caveat |
| --- | --- |
| `npm run build` | `turbo run build`, dispatching workspace build scripts. |
| `npx turbo run check-types` | Configured type-check task; depends on dependency-package check-types tasks through `^check-types`. |
| `npx turbo run dev` | Configured persistent, uncached task; would start workspace dev servers. Documentation only. |

The root has no check-types, dev, lint or test npm script. Turbo declares only build, check-types and dev tasks; lint/test are not configured root Turbo workflows. Its build task depends on dependency-package builds through `^build` and caches both `dist/**` and `build/**`. A root build generates the backend and frontend shareable exports before bundling the Workers. Generated exports are ignored by Git and must be built in each checkout. Sources: [root package.json](../package.json), [turbo.json](../turbo.json), [frontend package.json](../apps/frontend/package.json), [frontend tsconfig.build.json](../apps/frontend/tsconfig.build.json).

## Frontend scripts

Use directory [apps/frontend](../apps/frontend/package.json) or selector `@go-groceries/frontend`.

| Script | Defined action |
| --- | --- |
| `check-types` | `tsc -b` using app/node project references. |
| `lint` | `eslint .`; the flat config is eslint.config.js, with a legacy .eslintrc.cjs also checked in. |
| `build` | `vite build && npm run build-node`; browser assets plus shareable JavaScript. |
| `build-node` | `tsc -p tsconfig.build.json`; emits the shareable include graph from the fixed `src` root to `build/shareable`. |
| `build:pwa` / `build:pwa-test` | `vite build --mode pwa` / `vite build --mode pwa-test`; do not also invoke build-node. |
| `check-and-build` | check-types then build. |
| `check-and-build:pwa` / `check-and-build:pwa-test` | check-types then the corresponding PWA build. |
| `dev` / `dev:pwa` | `vite` / `vite --host --mode pwa-test`. Server commands, documentation only. |
| `preview` | `vite preview`. Server command, documentation only. |
| `preview:pwa` / `preview:pwa-test` | Build the corresponding mode then `vite preview --host --mode ...`. Documentation only. |

Sources: [package.json](../apps/frontend/package.json), [tsconfig.json](../apps/frontend/tsconfig.json), [tsconfig.app.json](../apps/frontend/tsconfig.app.json), [tsconfig.node.json](../apps/frontend/tsconfig.node.json), [tsconfig.build.json](../apps/frontend/tsconfig.build.json), [eslint.config.js](../apps/frontend/eslint.config.js), [.eslintrc.cjs](../apps/frontend/.eslintrc.cjs).

Frontend configuration names are `VITE_YOUTUBE_API_BASE_URL`, `VITE_YOUTUBE_API_PASS` and `VITE_FILE_SYNC_BASE_URL`. The YouTube request can fall back to a relative URL when no base is provided; sync code interpolates its base directly. Saved `youtubeApiPass` is used for both generation and file sync. PWA/test behavior and diagnostics are described in [Frontend](architecture/frontend.md). Sources: [vite-env.d.ts](../apps/frontend/src/vite-env.d.ts), [generation caller](../apps/frontend/src/components/FromYoutubeMealCreation.tsx), [sync.ts](../apps/frontend/src/util/sync.ts), [vite.config.ts](../apps/frontend/vite.config.ts).

## Workers and shared backend

| Package selector | Scripts and limitations |
| --- | --- |
| `go-groceries-youtube-api` | check-types: `tsc -b`; build: `wrangler build`; dev/start: `wrangler dev`; deploy: `wrangler deploy`; cf-typegen: `wrangler types`; sync-secrets: the local secret-upload script. No lint/test script. |
| `go-groceries-images-api` | Same named scripts/actions as YouTube. No lint/test script; TypeScript is not a direct dependency of this package. |
| `@go-groceries/backend` | check-types: `tsc -b`; build: `tsc` to dist with declarations/maps; test: prints an error and exits 1. No dev/lint script. |

Sources: [YouTube package.json](../apps/go-groceries-youtube-meal-resolver/package.json), [images package.json](../apps/go-groceries-images-meal-resolver/package.json), [shared backend package.json](../libraries/shared-backend/package.json), [shared backend tsconfig.json](../libraries/shared-backend/tsconfig.json).

`wrangler build` is the literal Worker build script. Backend runtime exports refer to `dist`, and the images Worker imports frontend runtime constants from `build/shareable`. Run root `npm run build` before standalone Worker dev or deploy commands in a fresh checkout; it generates these modules in dependency order. Wrangler bundles them into the Worker, so deployments do not need generated JavaScript committed to Git. Sources: [worker manifests](../apps/go-groceries-youtube-meal-resolver/package.json), [images manifest](../apps/go-groceries-images-meal-resolver/package.json), [backend exports](../libraries/shared-backend/package.json), [frontend exports](../apps/frontend/package.json), [images types.ts](../apps/go-groceries-images-meal-resolver/src/types.ts).

Both workers' local configuration file is `.dev.vars`, as read by their secret scripts; only example variable names are documented in [Backend workers](architecture/backend-workers.md). The checked-in filename is `example.dev.vars`, despite the YouTube README referring to `.example.dev.vars`. The images example omits the R2 variables used by its source. No local values belong in architecture docs. Sources: [YouTube example](../apps/go-groceries-youtube-meal-resolver/example.dev.vars), [images example](../apps/go-groceries-images-meal-resolver/example.dev.vars), [YouTube README](../apps/go-groceries-youtube-meal-resolver/README.md), [YouTube secret script](../apps/go-groceries-youtube-meal-resolver/scripts/sync-dev-vars-to-cloudflare.js), [images secret script](../apps/go-groceries-images-meal-resolver/scripts/sync-dev-vars-to-cloudflare.js).

There are no tracked application test suites or configured test runners in this source tree; the only test script is the shared-backend failing placeholder. Worker tsconfigs exclude a tests directory but that does not establish an implemented suite. A passing type check/build/lint alone would not verify sync, migrations, Worker services or shopping interactions. Sources: [frontend manifest](../apps/frontend/package.json), [YouTube manifest](../apps/go-groceries-youtube-meal-resolver/package.json), [images manifest](../apps/go-groceries-images-meal-resolver/package.json), [backend manifest](../libraries/shared-backend/package.json), [YouTube tsconfig](../apps/go-groceries-youtube-meal-resolver/tsconfig.json), [images tsconfig](../apps/go-groceries-images-meal-resolver/tsconfig.json).

## Deployment paths (documentation only)

The frontend `upload-assets-to-s3` script invokes the AWS CLI's recursive copy of dist to the selected S3 bucket, accepting optional `--profile` and `--bucket`. Its default is the test bucket. `build-and-upload:test` combines a checked PWA test build with the test bucket; `build-and-upload:prod` combines a checked PWA build with the production bucket. The script uses copy, not sync/delete, and does not provision hosting, access policies, TLS, caching, or client-route fallback. Sources: [frontend package.json](../apps/frontend/package.json), [upload-to-s3.js](../apps/frontend/scripts/upload-to-s3.js), [root README](../README.md).

Each Worker deploy script runs Wrangler deploy using its own wrangler.jsonc entry. `sync-secrets` reads each nonempty/comment-free key/value line in its local `.dev.vars` and invokes `wrangler secret put` for that key, sending the value on stdin. That is a remote mutation, not local setup validation. No deploy/upload/secret-sync script was run or is required to review these docs. Sources: [YouTube package.json](../apps/go-groceries-youtube-meal-resolver/package.json), [images package.json](../apps/go-groceries-images-meal-resolver/package.json), [YouTube config](../apps/go-groceries-youtube-meal-resolver/wrangler.jsonc), [images config](../apps/go-groceries-images-meal-resolver/wrangler.jsonc), both secret scripts linked above.

For contributor conventions see [frontend GEMINI.md](../apps/frontend/GEMINI.md). Historical check results for the earlier source commits live in the [branch analysis](analysis/unsure-branch-last-3-commits.md); they are not fresh runtime validation of this documentation task.
