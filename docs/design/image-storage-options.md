# Image storage options

Status: proposed design; application code remains unchanged. Source baseline: `origin/unsure`, commit `7fe9eab`. Pricing read: 2026-11-18. The independent correctness/security review is recorded in `code-review.md` in the task evidence.

## Outcome and decision scope

Separating binary images from the sync snapshot is feasible with the R2 storage the app already uses. Recommend **private R2 objects addressed by a content hash, with a small versioned metadata manifest and signed image downloads**. Keep local binary copies for offline viewing. This makes metadata retrieval small and avoids uploading unchanged images on every sync.

This is a recommendation, not approval to change the Dexie schema, shared contracts, dependencies, authentication, or Cloudflare configuration. No app edits, deployment, account access, real IndexedDB access, or real export inspection were performed. Only a fresh browser profile with synthetic data was used. No repository dependency was installed.

Evidence labels: **LIVE** means source inspection, an official documentation read, or a completed synthetic probe; it does not mean the deployed app was tested. **INFERRED** identifies extrapolations and proposed behavior. The user's actual image fraction remains unknown.

## Current state

### Where images live

**LIVE - repository source.** IndexedDB stores binary objects inside records, rather than in an app-level image store:

| Location | Stored shape | Consequence for export |
| --- | --- | --- |
| `meals.images` | Descriptor union: `url`, `file: File`, or `recipeImage {recipeId, imageIndex}`, each optionally `isThumbnail`. | A File descriptor contains bytes; URL and recipe references contain only text/IDs. [db.ts:7](../../apps/frontend/src/db/db.ts#L7) |
| `recipes.images` | `(File \| string)[]`; strings are used as image URLs. | Each File is embedded; ordinary URL strings do not include remote image bytes. [db.ts:45](../../apps/frontend/src/db/db.ts#L45) |
| `pendingRecipes.images` | Shared `MealRecipeImage[]`: URL, File, Blob, or base64 string. | All binary/data-string alternatives can carry a full image. [db.ts:53](../../apps/frontend/src/db/db.ts#L53), [shareable/meals.ts:5](../../apps/frontend/src/shareable/meals.ts#L5) |
| Thumbnail | Flag plus a reference to a recipe image. | No separate compressed thumbnail file is created by these paths; a thumbnail displays the same image at a small CSS width. [Meals.tsx:293](../../apps/frontend/src/pages/Meals.tsx#L293), [Meals.tsx:381](../../apps/frontend/src/pages/Meals.tsx#L381), [recipe route:419](../../apps/frontend/src/routes/recipe.$mealId.tsx#L419) |

The recipe editor compresses camera/file selections through `convertFilesToImageBlobs`, then saves the returned Files in `recipes.images`. Its URL path verifies that an image loads and stores the string. [recipe route:69](../../apps/frontend/src/routes/recipe.$mealId.tsx#L69), [recipe route:116](../../apps/frontend/src/routes/recipe.$mealId.tsx#L116), [recipe route:232](../../apps/frontend/src/routes/recipe.$mealId.tsx#L232), [images.ts:25](../../apps/frontend/src/util/images.ts#L25). The form allows at most ten image entries, but the DB interfaces do not enforce this on old/imported records. [types/recipe.ts:3](../../apps/frontend/src/types/recipe.ts#L3).

String/URL fields have no HTTP(S)-only restriction here. A loadable `data:` URL therefore carries inline bytes as text and can also enlarge the export; it is not an external image merely because it is a string. A saved `blob:` URL is only a temporary browser reference, not a portable image. Migration must distinguish both from ordinary remote URLs. [images.ts:6](../../apps/frontend/src/util/images.ts#L6), [recipe route:72](../../apps/frontend/src/routes/recipe.$mealId.tsx#L72).

Generated images follow a different path. Deferred recipe creation stores the descriptors unchanged in `pendingRecipes`; immediate creation maps URL to string, passes File through, wraps Blob as File, and decodes base64 into File. That mapper does **not** call the compressor. [Meals.tsx:269](../../apps/frontend/src/pages/Meals.tsx#L269), [Meals.tsx:284](../../apps/frontend/src/pages/Meals.tsx#L284), [images.ts:44](../../apps/frontend/src/util/images.ts#L44). The implemented YouTube resolver currently returns a thumbnail **URL**, so a collection made only from those URLs need not have a large binary-image export. [YouTube endpoint:193](../../apps/go-groceries-youtube-meal-resolver/src/endpoints/generate-meal-data.ts#L193).

A stored thumbnail reference is cheap; it does not duplicate its recipe File. Separately stored equal Files in different image slots/rows do duplicate payloads in the export: there is no content-based deduplication in these app paths. The synthetic duplicate-byte dataset confirms that serialization counts each occurrence. Direct meal `url`/`file` descriptors are supported by the model, but the meal-list rendering branch shown here handles `recipeImage` only. [Meals.tsx:381](../../apps/frontend/src/pages/Meals.tsx#L381).

There is a migration hazard independent of storage size: the recipe editor compares/writes `recipeId: Number(mealId)`, while generated creation uses the actual inserted recipe ID. Those primary keys can diverge. The list selects a recipe by `mealId` and uses the index rather than checking that descriptor ID. [recipe route:149](../../apps/frontend/src/routes/recipe.$mealId.tsx#L149), [recipe route:178](../../apps/frontend/src/routes/recipe.$mealId.tsx#L178), [Meals.tsx:285](../../apps/frontend/src/pages/Meals.tsx#L285), [Meals.tsx:382](../../apps/frontend/src/pages/Meals.tsx#L382).

### Serializer: File is not Blob

**LIVE - pinned package source and synthetic browser probe.** The lockfile resolves Dexie 4.0.11, dexie-export-import 4.1.4, and browser-image-compression 2.0.2. Public npm tarball integrity and bundle hashes are recorded in `public-source-check.json`.

The exact exporter calls `TSON.encapsulate()` per row, finalizes pending Blob reads, and JSON-stringifies the result. It does not compress the database export. The shipped source map identifies these implementation locations:

- `dexie-export-import/src/export.ts:150`: encapsulation and compact JSON output.
- Bundled `typeson-registry/types/file.js:8`: synchronous object-URL XHR using `charset=x-user-defined`; File becomes `{type, stringContents, name, lastModified}` with a `$types` entry.
- `dexie-export-import/src/tson.ts:23`: the `blob2` override converts Blob bytes to base64 `data`, with MIME type and a revival marker.
- Bundled `typeson-registry/utils/stringArrayBuffer.js:64`: File revival writes string character codes into a Uint8Array.

These are source-map locations in the [published 4.1.4 package](https://registry.npmjs.org/dexie-export-import/-/dexie-export-import-4.1.4.tgz), not the latest upstream implementation. Method and source pointers are in `measurement-method.md`.

**LIVE - measurement.log.** A 256-byte File containing all byte values exported as `stringContents`; byte 128 became Unicode U+F780. Its escaped JSON content occupied 654 UTF-8 bytes. The equivalent Blob exported to 344 base64 characters. Importing the export into a second synthetic DB restored File type/name/lastModified and the exact File/Blob bytes, checked with SHA-256.

Therefore, applying base64's 33% overhead to every File in this app is incorrect. For uniformly distributed bytes in this Chromium File path, the factor is `654 / 256 = 2.5546875`, or about **155.5% extra bytes**. Low ASCII mostly takes one byte, quotes/backslashes take two, control bytes take two or six after escaping, and high bytes map to three-byte UTF-8 characters. Actual compressed images have their own byte distribution. Blob base64 length is exactly `4 * ceil(n / 3)`; existing base64 strings are already inflated before export and are not decoded/re-encoded by the exporter.

### Export, upload, retrieval, and import

**LIVE - repository source.** Local export and sync call the same `getExportBlob()`, using a row filter for nine tables: meals, groceryLists, groceryListStates, recipes, tags, customIngredients, pendingRecipes, stores, ingredientStores. Settings and sync rows are excluded; exporter table headers may still describe filtered tables. The bytes in image fields of included rows remain included. [export.ts:15](../../apps/frontend/src/util/db/export.ts#L15), [db.ts:188](../../apps/frontend/src/db/db.ts#L188), [home route:14](../../apps/frontend/src/routes/index.lazy.tsx#L14).

`useSyncTo` delegates to `syncTo`. That exports the whole snapshot, wraps it as an application/json File, chooses a UUID filename initially and reuses it thereafter, reads `youtubeApiPass`, requests a PUT signature, uploads the full File directly to R2, then requests a GET signature and saves that URL. There is no image extraction or incremental upload. Automatic upload can log the signed GET URL. [useSyncTo.ts:20](../../apps/frontend/src/hooks/useSyncTo.ts#L20), [sync.ts:7](../../apps/frontend/src/util/sync.ts#L7), [file-upload.ts:22](../../apps/frontend/src/util/file/file-upload.ts#L22), [useSyncTo.ts:29](../../apps/frontend/src/hooks/useSyncTo.ts#L29). Mutations can trigger another whole snapshot after a five-second debounce. [useDebouncedSync.ts:5](../../apps/frontend/src/hooks/useDebouncedSync.ts#L5).

The image/file Worker signs caller-supplied keys using an S3 SDK client configured for R2. `/file-upload` accepts JSON/JPEG/PNG/WebP/octet-stream and yields a **300-second PUT** URL. `/file-retrieval` performs HEAD, then yields a **24-hour GET** URL; every HEAD error is mapped to 404. It neither sees nor validates the PUT body. [upload endpoint:15](../../apps/go-groceries-images-meal-resolver/src/endpoints/file-upload.ts#L15), [upload signer:17](../../apps/go-groceries-images-meal-resolver/src/file-upload/r2-presign.ts#L17), [retrieval signer:16](../../apps/go-groceries-images-meal-resolver/src/file-upload/r2-presign-get.ts#L16), [S3 client:6](../../apps/go-groceries-images-meal-resolver/src/file-upload/s3-client.ts#L6), [allowlist:1](../../apps/frontend/src/shareable/file-upload.ts#L1).

`syncFromDb` downloads the full signed snapshot and imports it into a temporary DB to compare meal-name additions/removals. It refreshes the GET URL with the shared pass when fewer than 60 seconds remain. Its URL parser retains only the final path segment as `filename`, so introducing namespaced snapshot keys without changing this parser breaks renewal. [sync-from.ts:47](../../apps/frontend/src/util/sync-from.ts#L47), [s3-presigned.ts:32](../../apps/frontend/src/util/file/s3-presigned.ts#L32), [import.ts:24](../../apps/frontend/src/util/db/import.ts#L24).

Final import clears the nine tables **before** `importDB(..., {noTransaction: true})`: it is destructive replacement with partial-failure risk, not merge. Only meal names participate in its diff. The App automatic path calls a same-name snapshot "Already latest" without importing; manual sync imports that case, and modal import only invalidates `syncFrom`. Image-only updates must not use this name comparison as a completeness check. [import.ts:5](../../apps/frontend/src/util/db/import.ts#L5), [import.ts:38](../../apps/frontend/src/util/db/import.ts#L38), [App.tsx:86](../../apps/frontend/src/App.tsx#L86), [SyncSettings.tsx:65](../../apps/frontend/src/components/SyncSettings.tsx#L65), [DiffsModalProvider.tsx:32](../../apps/frontend/src/contexts/DiffsModalProvider.tsx#L32).

The current shared HTTP contracts are `{pass,fileUploadType:'R2',fileName,contentType} -> {url}` and `{pass,uploadedType:'R2',fileName} -> {url}`. TypeScript request generics do not validate JSON at runtime. Both endpoints use the same optional pass check, with no user/collection ownership checks or key namespace restriction. Worker CORS allows every origin; actual R2 bucket CORS and public access are unknown external configuration. There is no active R2 binding in Wrangler. [upload contract:8](../../apps/frontend/src/shareable/file-upload.ts#L8), [retrieval contract:3](../../apps/frontend/src/shareable/file-retrieval.ts#L3), [retrieval endpoint:10](../../apps/go-groceries-images-meal-resolver/src/endpoints/file-retrieval.ts#L10), [CORS:4](../../apps/go-groceries-images-meal-resolver/src/endpoints/cors.ts#L4), [wrangler.jsonc:14](../../apps/go-groceries-images-meal-resolver/wrangler.jsonc#L14).

## Measurements and limits of the size verdict

**LIVE - measurement.log, successful probe exit 0.** The dataset has 100 meals, 100 recipes with about 2 KiB of notes each, ingredients, tags, lists, stores and associations. Ten recipes have two synthetic Files each. Files repeat byte values 0-255; they are serializer fixtures, not photographs or a measured distribution of actual compressed pictures.

The probe uses the real pinned Dexie exporter in a fresh Chromium profile. It measures the UTF-8 Blob size and, separately, the exact reduction after replacing only typed File `stringContents`/Blob `data` payloads with empty strings. Everything else, including file descriptors, thumbnail references and JSON structure, stays in the non-image count. Compact reserialization is checked to have exactly the original size.

| Scenario | Raw image bytes | Image payload in JSON | Other bytes | Total export | Image fraction |
| --- | ---: | ---: | ---: | ---: | ---: |
| No embedded files | 0 | 0 | 293,295 | 293,295 (0.280 MiB) | 0% |
| 20 x 100 KiB Files | 2,048,000 | 5,232,000 | 295,287 | 5,527,287 (5.271 MiB) | 94.66% |
| 20 x 300 KiB Files | 6,144,000 | 15,696,000 | 295,287 | 15,991,287 (15.250 MiB) | **98.15%** |
| 20 x 1 MiB Files | 20,971,520 | 53,575,680 | 295,287 | 53,870,967 (51.375 MiB) | 99.45% |

**INFERRED - sensitivity model, not the user's data.** Let `M` be all other export bytes, `F` the sum of embedded File bytes counting duplicates, and `B` the sum of Blob bytes. Then a useful uniform-byte estimate is `T ~= M + 2.5547F + (4/3)B + existingBase64PayloadBytes`. In the 300 KiB scenario, externalizing images reduces the recurring metadata transfer from roughly 15.25 MiB to roughly 0.282 MiB plus new asset references. First complete transfer still needs the raw 5.86 MiB of images; binary objects plus the stripped manifest total about 6.14 MiB before protocol overhead. It does not make first-time offline hydration free or instantaneous.

With about 295 KB of other data, roughly 116 KB of uniform embedded File data is enough to exceed half the export. Conversely, URL-only images add short strings and do not establish the user's suspicion. The user's actual image count/size/distribution and any compression performed outside these paths are unmeasured.

### Compression target is not a hard bound

**LIVE - code and measurement.log.** App settings are `maxSizeMB:1`, `maxWidthOrHeight:1920`, `useWebWorker:true`. [images.ts:19](../../apps/frontend/src/util/images.ts#L19). Library 2.0.2 uses MiB (`1024*1024`) for that target, preserves input type unless overridden, and stops after a finite iteration budget. [compressor source](https://github.com/Donaldcwl/browser-image-compression/blob/v2.0.2/lib/image-compression.js).

Three generated 1920x1080 PNGs, compressed with the same size/dimension settings on the main-thread path, produced:

| Synthetic content | Input bytes | Compressed bytes | At/below 1 MiB? |
| --- | ---: | ---: | --- |
| Solid | 44,114 | 346 | Yes |
| Gradient | 45,935 | 12,384 | Yes |
| Seeded noise | 7,134,829 | 1,307,394 | **No** |

This is not a claim about real photos or exact Worker-thread output. It demonstrates the compressor's main-thread behavior, consistent with its bounded loop. Generated Blob/base64 imports also bypass this compressor. Server limits must be explicit and checked against actual uploaded bytes.

### Optional measurement the human can run privately

No real measurement is needed to compare these storage designs. If you want your own exact fraction later, you can select an export in an offline/local tool, count UTF-8 file bytes, and blank typed File `stringContents` and Blob `data` payloads in a copy of the parsed JSON; count again and report only totals. Count `pendingRecipes` data/base64 image strings separately, and flag recipe/meal strings beginning `data:` rather than treating every string as binary. For pretty-printed exports, measure both projections with the same serialization so formatting is not attributed to images. Do not remove `$types`/record metadata for this payload-only metric. No file contents need leave your device.

## Current Cloudflare pricing

**LIVE - official Cloudflare documentation read on 2026-11-18.** Initial public docs HTTP requests returned 403. The pricing and feature claims below were verified against Cloudflare's own documentation repository's `production` commit `489e479cf1b5a9ae7f779d81808b863a0fa4774a`. Later web reads of the published pricing pages, including the independent review's reads, confirmed the figures. This is a documentation read, not an account/plan/billing check. Exact immutable source links and hashes are in `public-source-check.json`; published-page checks are in `pricing-source-check.md`.

| Product/meter | Current included/free usage | Price beyond inclusion / availability | Official source |
| --- | --- | --- | --- |
| R2 **Standard** storage | 10 GB-month each month | $0.015/GB-month | [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [official source snapshot](https://github.com/cloudflare/cloudflare-docs/blob/489e479cf1b5a9ae7f779d81808b863a0fa4774a/src/content/docs/r2/pricing.mdx) |
| R2 Standard Class A | 1 million operations/month | $4.50/million; PUT and LIST count | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| R2 Standard Class B | 10 million operations/month | $0.36/million; HEAD and GET count separately | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| R2 egress / deletion | Direct R2 egress free; DELETE free | Connected metered services may add charges | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| R2 Infrequent Access | **No Standard free tier** | $0.01/GB-month, $9/million A, $0.90/million B, $0.01/GB retrieval; 30-day minimum storage | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| Workers Free | 100,000 requests/day; 10 ms CPU/invocation | Free limits, not an unlimited monthly allocation | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [official source snapshot](https://github.com/cloudflare/cloudflare-docs/blob/489e479cf1b5a9ae7f779d81808b863a0fa4774a/src/content/docs/workers/platform/pricing.mdx) |
| Workers Paid | $5/month minimum includes 10M requests and 30M CPU-ms/month | $0.30/additional million requests; $0.02/additional million CPU-ms; no Workers egress charge | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Images Free, external originals | 5,000 unique transformations/month | No hosted image storage; new transformations beyond limit fail, rather than generating overage charges | [Images pricing](https://developers.cloudflare.com/images/pricing/), [official source snapshot](https://github.com/cloudflare/cloudflare-docs/blob/489e479cf1b5a9ae7f779d81808b863a0fa4774a/src/content/docs/images/pricing.mdx) |
| Images Paid, hosted storage | **No hosted storage free tier** | Storage purchased in $5 increments per 100,000 images/month | [Images pricing](https://developers.cloudflare.com/images/pricing/) |
| Images Paid, hosted delivery | No hosted-delivery free allowance stated | $1 per 100,000 delivered images; successful responses over 1,024 bytes count | [Images pricing](https://developers.cloudflare.com/images/pricing/) |
| Images Paid, external transformation | First 5,000 unique transformations included | $0.50/additional 1,000/month | [Images pricing](https://developers.cloudflare.com/images/pricing/) |

R2 charges round usage up to billing units; free allowances are shared with other account usage, not reserved for this app. R2 storage billing uses average daily peak storage. "Free" here means **within Standard R2 and Workers Free limits with remaining account allowance**, not a guaranteed spending cap. No existing allowance consumption or deployed Worker CPU usage was inspected.

Optional Images Free transformations can complement R2 later, but do not replace storage. Client compression and current full-image thumbnails already work without a transformation service; keep transformations out of the initial change.

## Common design requirements and human-owned choices

All proposals below are **INFERRED**. Compare metadata size, repeated transfer, offline availability, access control, migration safety, and operational work. None adds a queryable record backend: meal metadata remains a small snapshot. If "retrieve data" means server-side per-meal queries, that is a separate requirement.

### Local model choices

**Reference model proposal:** subject to your approval, add Dexie **version 15** after current version 14, a hash-keyed `imageBlobs` table for local Blob bytes and an upload-state table keyed by collection/asset. Change recipe and pending-recipe image slots to a tagged union of external URL and stable asset reference; normalize embedded meal Files similarly. Keep name/lastModified per slot, since identical bytes can have different filenames. Store MIME/byte length in the asset descriptor and verify consistency. Hash the compressed/normalized final bytes with built-in Web Crypto SHA-256; do not recompress existing Files just to migrate.

The DB upgrade creates tables and leaves old fields readable. A resumable local conversion runs after open, outside the version-change transaction: read bytes, hash outside the write transaction, then atomically save the Blob and replace the corresponding legacy slot in a short multi-table transaction. Recheck that the slot did not change before committing. Quota/cancel/hash failures retain the original. No network work occurs in a Dexie upgrade. Local Blob/upload-state tables are excluded from cloud metadata export; the manifest's asset inventory is explicit.

**Lower migration alternative:** retain Dexie version 14 and current File/string/descriptor fields. A new sync serializer projects Files into asset references, and a new importer fully hydrates them back into Files before committing. This avoids changing the local schema and image-rendering model, but it keeps duplicate local Files and makes complete first import wait for every required image. It still requires your approval for the new shared manifest/API contracts. It cannot claim metadata-only import plus persistent unresolved references without introducing another local state model.

Neither alternative is selected by this investigation. The rest of the migration section describes the reference-model proposal; the hydration alternative uses the same remote objects and validation but has no v15 conversion.

### Versioned contracts

Propose a separate `shareable/image-assets.ts`/`snapshot.ts` contract rather than silently changing old Dexie JSON:

```ts
type ImageRef =
  | { kind: 'externalUrl'; url: string }
  | { kind: 'asset'; assetId: string; name?: string; lastModified?: number };
type Asset = {
  assetId: string; sha256: string; mimeType: string; byteLength: number;
  location: { provider: 'r2'; key: string }
    | { provider: 'images'; imageId: string; originalKey: string };
};
type Snapshot = {
  format: 'go-groceries-snapshot'; version: 2;
  collectionId: string; snapshotId: string; assets: Asset[];
  // Versioned metadata rows, dates, IDs, schema/adapter version.
  data: unknown;
};
```

This sketch is not a final type design. Specify runtime parsing, unknown-version rejection, bounded table/record/asset counts, content types, image-byte and pixel limits, and permitted key formats before implementation. Separate generation inputs (URL/base64/etc.) from persisted image references and normalize them at the frontend boundary. Extend frontend package exports only after approving the contract. No new dependency is inherently required for hashing; a runtime validator or backup archive dependency is a separate choice.

Never serialize transient signed URLs, passes, or share tokens into durable image records or metadata manifests. A share link carries a read-only, expiring capability scoped to one immutable snapshot; the app separately presents that capability to retrieve its images. Binding image access only to the global pass would break pass-free recipients of today's signed snapshot links. Update Worker CORS to permit the chosen methods and Authorization header from approved frontend origins; the current Content-Type-only header allowlist cannot support cross-origin capability-header requests.

### Offline, sharing, and backup

In the reference model, render locally cached Blob bytes through short-lived object URLs and revoke them on cleanup. Propose eagerly downloading every referenced owned image for an "available offline" collection; count verified cached assets before reporting completion. Lazily fetched or never-cached assets show a placeholder offline. Browser storage eviction/quota still applies; persistence requests improve durability but do not guarantee it. Keep external URL behavior explicit: current URLs are not stored as bytes by the DB. Mirroring them is optional and can fail due to CORS or source policies.

The current PWA has a broad CacheFirst runtime route in PWA builds, not a durable per-asset offline completeness model. New signed URLs change cache keys on renewal; cached private data may outlive remote authorization. Do not rely on that route for assets. Use a hash-keyed local Blob store, exclude API/signature/snapshot requests from broad caching, request metadata with a fresh strategy, and clear locally cached private assets when the user deliberately removes a collection. [vite.config.ts:13](../../apps/frontend/vite.config.ts#L13), [vite.config.ts:20](../../apps/frontend/vite.config.ts#L20). Neither offline copies nor already downloaded exports can be recalled by token revocation.

Keep a **portable full backup** that contains image bytes and can restore without Cloudflare. Metadata-only sync manifests are dependent on remote object retention; they are not equivalent backups. A full backup may materialize legacy-compatible Files for export, or use a separate archive after you approve its contract/dependency. Refuse to label it complete if any required bytes are absent. Replacing every existing local export with a keys-only file would silently remove current portability.

### Publication and deletion

Upload assets first, verify success, then publish an immutable snapshot. Update the mutable "latest" pointer only after the snapshot is committed, using a conditional revision check. Conflicting writers receive a conflict instead of silently overwriting one another. Retrying after an ambiguous timeout reconciles object/snapshot existence; no broken manifest becomes latest. Apply image-only changes based on snapshot revision/content, not meal-name differences.

A shared pass remains a shared trust group: every holder can currently sign arbitrary keys. Random collection names reduce accidental discovery but do not create user isolation. For the proposed implementation, choose either explicitly trusted shared writers or per-collection writer capabilities/account authorization. Read capabilities must always be narrower than write credentials. SHA-256 is a deduplication identity, not a password: hashes of known images can be computed/guessed. Namespace deduplication by collection rather than providing a global cross-user existence oracle.

Deleting a slot/meal does not immediately delete its object. Scan all recipes, pending recipes, embedded meal images, retained snapshots and live heads; thumbnail references alone are not the reachability set. Today's meal delete leaves recipe rows behind. [Meals.tsx:156](../../apps/frontend/src/pages/Meals.tsx#L156). Preserve unrelated existing orphan records during migration rather than making an unrequested cleanup decision.

Initially **disable automatic remote garbage collection**. A later mark/sweep must mark all retained immutable manifests and active publications, wait a defined retention/grace period, and recheck before deletion under a coordination mechanism that excludes commits racing the sweep. R2 strong consistency is per object and does not give a multi-object transaction. A time delay alone does not solve the race. A coordinated maintenance window or a new durable coordinator is an additional design decision; no extra storage service/dependency is assumed here. Old offline writers must check/reupload missing assets before publishing. Standalone metadata exports need declared expiration or indefinite retention; portable backups retain their own bytes.

## Option: R2 objects with direct signed transfers

**Storage and model.** Use the existing private R2 Standard bucket, with reserved prefixes such as `collections/<random-id>/images/sha256/<digest>`, immutable snapshots and a latest pointer. The durable manifest contains keys/hash descriptors, never embedded owned-image bytes or signed URLs. Apply either approved local model above; v15 conversion preserves legacy Files in local storage while replacing slots with references.

**Shared contract and endpoints.** Keep old file routes for legacy snapshots during coexistence, but restrict both GET and PUT signing to an explicit legacy-key allowlist/format; deny reserved asset/manifest prefixes in both directions. Otherwise a global-pass holder bypasses new collection read scopes through `/file-retrieval`. Existing legacy snapshots retain their old trust model until migrated. Drain outstanding reserved-key signatures before claiming the new boundary is enforced. Add bounded batch image preparation/download signing and snapshot commit/read operations. Retire the filename-from-URL parser for v2; carry the full canonical key/collection/snapshot explicitly. The old `{url}` responses need expiration/full-key fields or an entirely separate v2 contract.

**Upload, download and deduplication.** Hash final bytes; prepare checks for an already verified final object. For a miss, sign a five-minute PUT to a random staging key. Completion checks actual size, allowed format and SHA-256 before the Worker creates the final immutable hash object; only server code writes final keys. Conditional create prevents concurrent overwrites. If a verified object exists, reuse it. Download signing verifies capability membership in the committed snapshot and returns short-lived GET URLs; fetch/cache/verify the binary locally. Batch calls reduce signer requests, not underlying R2 GET counts.

This staging design deliberately avoids granting unrestricted signed PUTs to final hash keys. Otherwise a pass holder can poison a content-addressed key with unrelated bytes. Signed Content-Type is insufficient body validation. Completion reads a staging object once into a bounded buffer, verifies it, and writes **those exact verified bytes** to the final key; do not validate a mutable key and then separately re-read/copy it. PUT URLs are reusable until expiry. Equivalent version-bound promotion is possible only after its conditional semantics are verified. Make completion idempotent and remove staging after a confirmed final write. At least one staging GET and a final write are needed for strict verification; do not assume client metadata or HEAD proves the content hash. Error handling must distinguish genuine 404 from authorization, throttling and upstream failure.

**Delete/GC and offline.** Use the common retention rules. Delete abandoned staging objects after an agreed short window, but do not apply an age-only lifecycle to final images. Cached images remain viewable offline; metadata can load first, with offline readiness completed after hydration.

**Security.** The bucket stays private; no `r2.dev` or public custom-domain access is required. Current PUT is 300 seconds and GET is 24 hours; propose image GET validity of minutes and never beyond the share capability's expiry. Presigned URLs are reusable bearer tokens until expiry and cannot use R2 custom domains. Remove URL logging, set appropriate referrer policy, and avoid broad service-worker caching of authorization-bearing requests. Configure bucket CORS for allowed frontend origins and required PUT headers; Worker CORS does not configure bucket CORS. [Official presigned URL docs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

**Cost/effort/risks.** R2 allowance fit is strong at small scale; strict staging doubles new-image writes and adds verification reads. Worker signing/verification CPU is unmeasured: qualify zero-cost expectations against the 10 ms Free limit. Relative effort: moderate; familiar transfer plumbing, but manifest versioning, safe import, offline cache and share scopes are substantive work. Main risks are partial migration, stale clients, signed URL expiry, poisoning if legacy routes bypass restrictions, and changing the current pass-free sharing behavior.

## Option: Private R2 behind a Worker binding

**Storage and model.** Use the same hash objects/manifests and either approved local model, with the same proposed v15 resumable conversion if selected. Add an R2 binding in Wrangler and generated Env types. The browser sees stable authenticated Worker endpoints rather than S3 signed image URLs.

**Shared contract and endpoints.** Define explicit image upload and binary retrieval routes plus snapshot commit/read. Requests carry writer authorization or a snapshot-scoped read capability. Image responses carry MIME type, hash/ETag, length and appropriate private cache headers. For HTML `<img>`, fetch with the capability and render the cached Blob; a direct `src` cannot attach an Authorization header. Prefer headers to putting a long-lived global pass in a URL. Stable paths include collection/hash, not a permanent credential. Change Worker CORS to allow Authorization and the chosen binary-upload methods from approved app origins; current CORS permits only Content-Type and GET/POST/OPTIONS. Verify preflight and an authorized cross-origin fetch.

**Upload, download and deduplication.** The Worker accepts a bounded binary stream, verifies format/size/hash, and writes only the validated final object through its binding; stage during validation if necessary. Conditional create makes equal-byte writes idempotent. It authorizes every read, checks the requested key against a permitted snapshot, and streams R2 bytes. Native binding storage access removes S3 credentials from this path. Metadata publication is unchanged.

**Delete/GC and offline.** Same reachability/coordination rules. The Worker is the sole object mutation path, which makes enforcing those rules easier, but it does not make multi-object commits atomic. Local Blob caching/eager hydration is still required for the same offline experience.

**Security.** Keep the bucket private and authenticate before any shared cache lookup. Stable URLs are not permission. An authenticated private response must not be served by a public cache to a different requester; start without shared response caching, or implement an authorization-checked internal immutable-object cache. If checked revocation state is implemented, the Worker can stop future online reads more promptly than issued S3 GET URLs; stateless expiring capabilities alone do not provide revocation. Previously cached/downloaded bytes remain available. Do not treat the broad current PWA CacheFirst rule as safe API caching.

**Cost/effort/risks.** Each image network read invokes the Worker and performs an R2 read absent a safe cache. It can fit Workers Free at personal scale, but has a daily request limit and unmeasured verification CPU. Relative effort: moderate to high; more centralized streaming/error/authorization code and a new binding configuration, with fewer URL-expiry/CORS problems. Good choice if centralized authorization/revocation and a stable delivery API outweigh reuse of the current direct-transfer path. Risks include Worker availability becoming the delivery dependency, incorrect authenticated caching, upload validation resource use and stale clients using the old signer.

## Option: Cloudflare Images hosted storage and delivery

**Storage and model.** Use Images for managed image storage/delivery and put provider-assigned image IDs in the manifest. For the byte-exact original/hash guarantees used elsewhere in this proposal, also retain verified originals in private R2: Images' [download API](https://developers.cloudflare.com/api/resources/images/subresources/v1/subresources/blobs/methods/get) can return near-lossless representations for larger images, so it cannot establish the original SHA-256. The same proposed v15 Blob cache/reference migration applies if approved; retain originals locally and in portable backups. Keep a server-side mapping from collection/original-hash to R2 original key and Images ID. This is a hybrid with additional storage/coordination work, not an Images-only byte-exact backup.

**Shared contract and endpoints.** Add Images-specific ingestion/completion/download operations instead of reusing the R2 discriminator. First verify and preserve an original through the approved R2 upload path. The Worker ingests that verified original into Images using a server-held API token and binds the resulting provider ID to it. Completion checks provider upload status and authorization before activating that mapping. A client-supplied hash or the disappearance of `draft` alone is not original-byte proof. Direct Creator Upload is a supported lower-proxy-work alternative, but does not prove that its bytes match a separately hashed original; that weaker integrity contract needs a separate decision. Require signed delivery and configured thumbnail/full-size variants.

**Upload, download and deduplication.** Check the verified original-hash-to-ID mapping before ingesting into Images; coordinate concurrent preparations or reconcile duplicates after upload. Use provider-generated IDs: current Images custom-ID uploads **cannot** be private with signed tokens, so using the content hash as a custom ID conflicts with this design's private delivery. Request `requireSignedURLs=true`; avoid variants that always allow public access. Sign delivery URLs only after snapshot membership authorization. Original restoration downloads the verified R2 bytes; Images variants have separate cache identities and must not be checked against the original hash. Private signed delivery and direct-upload behavior are documented by [private images](https://developers.cloudflare.com/images/optimization/hosted-images/serve-private-images/) and [Direct Creator Upload](https://developers.cloudflare.com/images/storage/upload-images/direct-creator-upload/).

**Delete/GC and offline.** Reachability uses retained snapshot IDs, R2 originals and provider mappings, not just current recipe rows. Delete Images objects and originals only after the same coordinated retention checks. Keep original and display-variant cache identities separate. Full original hydration from R2 gives offline availability even when a variant is absent. An Images-only alternative could omit R2 originals if you explicitly accept changed cloud-restored bytes and redesign the hash contract; portable full backups would remain the original-byte recovery source.

**Security.** API/signing tokens stay in the Worker, never the frontend or manifest. Shared-pass/capability scope remains an app responsibility. Signed links are bearer access and expiration does not revoke local copies. Watch public variant exceptions and custom-ID limitations.

**Cost/effort/risks.** Hosted Images does **not** meet a strict free requirement: the first storage increment is $5/month, plus metered delivery, the additional original R2 storage/operations, and applicable Worker costs. It buys managed image validation/transformation/variants rather than just object storage. Relative effort: highest, because it adds provider-specific contracts, server ingestion/mapping, concurrency recovery and original/variant distinctions to an original-preservation path. Favor it if you want managed resizing/delivery enough to accept recurring cost and provider dependence. The existing image-generation placeholder does not provide any of this infrastructure.

## Comparison and recommendation

| Criterion | R2 signed transfers | R2 Worker binding | Hosted Images |
| --- | --- | --- | --- |
| Recurring sync snapshot | Small metadata + asset keys | Small metadata + asset keys | Small metadata + provider IDs |
| Unchanged images | Reused by verified hash | Reused by verified hash | Reused through hash-to-ID mapping |
| Offline | Local verified Blob cache; v14 alternative fully hydrates Files | Same | Local originals/display variants |
| Public exposure required | No | No | No, with supported private IDs/variants |
| Online access | Short-lived S3 bearer links after capability check | Authorization on each Worker read | Signed provider delivery links |
| Fits free storage | Yes, within R2 Standard allowance | Yes, within R2 Standard allowance | **No** |
| Additional backend state | Immutable manifests/latest pointers; no extra DB assumed | Same, plus R2 binding | Original R2 objects plus durable provider-ID mapping |
| Relative effort | Moderate | Moderate/high | Highest |
| Main reason to choose | Reuse existing R2 transfer approach | Central enforcement and stable delivery | Managed image variants |

**INFERRED - recommendation.** Choose R2 signed transfers if your priority is smaller, easier metadata retrieval with low recurring cost. The bucket and direct transfer code already exist; hashed objects also reduce first transfer's serialization overhead and later unchanged-image transfers. Choose the Worker-binding option instead if simpler centralized authorization is the stronger priority. Hosted Images is credible for managed variants, but is a paid alternative.

Recommendation is conditional on approving the local schema/import approach and the v2 sharing contract. Restricting legacy signer key access, preserving pass-free share recipients with scoped read capabilities, and validating bytes before publishing hash objects are requirements, not optional polish.

### Illustrative allowance budget

**INFERRED - workload estimate, not current usage.** 1,000 unique 300 KiB objects are 0.3072 decimal GB. With 100 retained ~0.3 MB metadata snapshots, storage is about 0.3372 GB, plus staging/backup/other account usage. Do not equate GiB with Cloudflare's GB billing units.

If all 1,000 images are new in a month, signed staging/final writes use about 2,000 Class A operations, plus snapshot/head writes and list/GC work. Three devices doing ten completely cold full reads each use 30,000 image GETs. Using today's HEAD-before-signing pattern makes that 60,000 Class B operations, plus about 2,000 prepare/verification operations and snapshot reads. This is far below R2's 1M A/10M B allowances. Downloads have no R2 egress fee.

The Worker-binding variant can omit the per-image signing HEAD and centralize uploads, but image reads still consume Worker requests and R2 reads. Roughly 30,000 delivery requests/month is small if spread out; monthly totals cannot prove compliance with a daily limit. Strict verification and SDK signing must be profiled before claiming Workers Free fits. Hosted Images requires at least the $5 storage increment; at its stated delivery rate, 30,000 counted deliveries correspond to $0.30 of usage before provider billing treatment and Worker costs.

## Migration and validation plan

This is proposed implementation work after your choices, not work performed by this investigation.

1. **Approve boundaries.** Choose storage/delivery, v15 references versus v14 projection/hydration, offline completeness policy, writer trust/access scope, manifest/share contracts and backup/retention policy. No dependency addition is presumed.
2. **Protect recovery.** Preserve existing full exports and local Files. Build/read-test the new importer before any writer publishes v2. Validate all metadata in a temporary DB/version adapter, asset inventory, owned keys, dates, count/size limits and required hashes before replacing current tables. Do not carry forward the current clear-then-import behavior.
3. **Convert locally if v15 is chosen.** Create cache/upload tables on upgrade; convert File, Blob and data-base64 slots in bounded, restartable batches outside the upgrade transaction. Also decode `data:` URLs in string/URL slots; leave HTTP(S) URLs external by default and report unrecoverable `blob:` references. Include pending and embedded meal images. Retain original bytes on failures, preserve filenames/slot order and deduplicate identical bytes. Do not rely on a mutation-hook outbox alone: current hooks intercept selected single-row methods, not every bulk/collection change. Use an explicit resumable migration/upload queue. [db.ts:200](../../apps/frontend/src/db/db.ts#L200).
4. **Resolve thumbnail references conservatively.** Verify recipe ID, owner meal and image index. Preserve a reference when interpretations agree. When declared recipe ID and the currently displayed meal-owned recipe disagree, retain the legacy descriptor and report the ambiguous relationship rather than attaching another meal's image. Do not collapse multiple recipes per meal as an incidental migration.
5. **Provision only after approval.** Reserve/protect prefixes; configure private bucket access, bucket CORS and Worker CORS for the chosen methods/Authorization header, credentials/binding or Images token. Constrain both legacy GET and PUT signing and drain outstanding reserved-key signatures before claiming collection isolation. Implement bounded preparation/verification and promotion of exactly the verified bytes. Default GC remains disabled.
6. **Publish safely.** Upload missing assets, reconcile ambiguous retries, verify each asset, commit immutable manifest, then conditionally advance latest. Freeze the metadata revision during asset preparation or restart if records change; never publish references from one revision with rows from another.
7. **Import safely.** Reference-model clients can stage validated metadata and retain a background hydration inventory. Replace included metadata tables atomically in a short transaction; preserve verified hash-matching cache entries, keep old data until validation succeeds, invalidate affected meal/recipe/list queries, and mark offline-ready only when hydration completes. No network awaits inside that transaction. The v14 alternative stages and verifies every required File before its atomic replacement. Expired share authorization may allow staged metadata only if you explicitly choose a partial availability policy; do not report full restore.
8. **Coexist and rollback.** Introduce v2 behind an explicit opt-in/new sync location; keep legacy snapshot keys and full backup export during rollout. Old clients must not be allowed to overwrite a v2 head or reserved prefixes. Readers reject unknown versions before clearing data. Application rollback after v15 cannot assume an old build will open the newer database; use the validated portable legacy restore into an explicitly supported DB/recovery path. Retain remote assets until rollback/retention decisions are settled.
9. **Validate failure cases.** Cover differing recipe/meal IDs, multiple recipe rows, reordered/deleted slots, duplicate content with different names, pending Blob/base64, URL-only collections, malformed/oversized input, quota exhaustion, offline edits/restart, image-only snapshot changes, URL renewal, wrong hash/poisoned upload, pass rejection, guessed key, share expiry, legacy-signer bypass, concurrent publishers, upload timeouts, GC racing a commit and missing asset restore. The synthetic serializer probe does not validate these proposed services.
10. **Operate from useful signals.** Track snapshot bytes, binary bytes, dedup hits, upload completion failures, offline missing-asset counts, invalid hashes, authorization failures and object/manifest growth; redact capabilities and signed URLs. Set budget/usage alerts before enabling broader sharing. Only enable remote GC after proving reachability and commit/sweep coordination.

## Decisions to evaluate

- Storage/delivery: recommend private R2 signed objects; choose binding delivery for stronger central enforcement, or paid Images for managed variants.
- Local model: v15 references/cache supports fast metadata import; v14 projection avoids schema migration but requires full image hydration before import. Your choice.
- Shared contracts/access: approve a versioned manifest and snapshot-scoped read capability; decide whether all pass holders remain equally trusted writers.
- Offline: recommend explicit eager hydration for offline collections; on-demand caching lowers disk/network use but leaves unseen images unavailable offline.
- Backup/retention: preserve portable full backups; keep GC disabled initially. Keys-only exports need a declared lifetime or indefinite object retention.
- Dependencies: none added; native hashing suffices. Archive/runtime-validation/image-decoder choices need a separate approval if new libraries are wanted.

## Open questions

- Actual embedded image fraction? Unmeasured by design; use synthetic sensitivity estimates until you elect to measure totals privately.
- Remaining Cloudflare allowances and Worker CPU? Unknown without account/profiling access; default cost claims are conditional, with no account access taken.
- Does "retrieve" also mean server-side per-meal queries? Default here is faster metadata snapshot access and independent image retrieval.
- Should external URL images be guaranteed offline? Default leaves them external; mirroring requires a separate policy and CORS/error handling.
- How long must shared snapshots remain restorable? Default retains originals/portable backups and disables automatic deletion; no retention duration has been selected.
- Which legacy thumbnail relationships are ambiguous? Migration must discover/report locally; no real database inspection was performed.

## Evidence

- `measurement.log`: completed actual serializer/import/hash/compressor probe, with per-probe exit code and browser cleanup.
- `measurement-probe.mjs`: synthetic-only browser probe; requires existing Node/Chromium and the pinned bundles, without an app server.
- `public-source-probe.py` and `public-source-check.json`: public-source retrieval, npm integrity verification and immutable official Cloudflare source hashes.
- `measurement-method.md`: reproduction commands, versions, measurement definitions, limitations and failed-attempt pointers.
- `repository-source-evidence.log`: source excerpts/line numbers and baseline revision.
- `code-review.md`: independent subagent findings and every disposition.
- `FINDINGS.md`: concise human-facing decisions and outcome.
