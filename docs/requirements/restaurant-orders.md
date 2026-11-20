# Restaurant orders requirements

Status: proposal for glossner to review, 2026-11-20. Documentation only; no feature, schema or shared contract has been changed. Baseline: `image-storage-impl`, `81d00f2`.

## 1. Goal and users

Give a household one place to remember restaurants, dishes people enjoyed, and exactly how to order them again. Household members and guests are named on ratings: for example, "Ben 9/10, Sarah 8/10". A person is a display name, not a login or permission boundary. Anyone using the household's writable collection can edit its records and ratings.

The first release is a restaurant notebook, with optional structured ordering details. It does not need ordering, bookings, payments or an automatic recommendation service. All requirements below describe proposed behavior; defaults can change during glossner's review.

## 2. User stories and functional requirements

Restaurant story: a household member saves a restaurant with useful tags and general notes, then finds it when choosing dinner.

- **R1 - Navigation:** add a Restaurants entry alongside Meals, Lists and Stores. Opening a saved restaurant directly by its route ID shows the detail; an invalid or deleted ID shows "Restaurant not found" with a route back to the list.
- **R2 - Create:** save a restaurant with a trimmed name of 1-200 characters. Name alone is enough; tags and notes start empty. Reject whitespace-only names. Allow duplicate names for different branches, with a warning on an exact case-insensitive match rather than blocking save.
- **R3 - Edit:** edit the name, tags and general notes without changing its ID or losing dishes/ratings. Preserve createdAt; update updatedAt only after a successful save. Notes are plain multiline text, up to 10,000 characters, and preserve line breaks.
- **R4 - Delete:** confirmation names the restaurant and counts its dishes and ratings. Cancel changes nothing. Confirm atomically removes the restaurant, its dishes and those dishes' ratings; retain people, reusable tags, shared cached image bytes and remote images. Previously published snapshots/backups remain unchanged.
- **R5 - Restaurant tags:** choose multiple suggested tags or create a custom tag, using searchable autocomplete and chips. Trim names, reject empty names and limit them to 80 characters; reuse tags by trimmed case-insensitive name. Detach a tag from one restaurant without deleting it or changing other restaurants or meals. Defaults and dietary matching follow section 3.
- **R6 - Find restaurants:** case-insensitive substring search matches restaurant names and dish names. Tag filters require all selected tags, with the dietary implications in section 3. A person plus minimum score filter matches a restaurant with at least one dish rated at or above that score by that person; default minimum is 8/10, with half-point steps. Unrated dishes never match. Search, tags and person criteria combine with AND. Clear filters restores all restaurants; zero matches shows an empty state. Default order is restaurant name, then ID for ties.

Dish story: a household member records a dish, a photo and the wording needed when ordering, then records each person's opinion independently.

- **R7 - Dish CRUD:** add, edit and delete dishes within an existing restaurant. A trimmed 1-200 character dish name is required; all other fields are optional. Duplicate names are allowed for sizes or variants. Prevent saving to a deleted restaurant. Dish deletion confirms its rating count and removes the dish and ratings together; cancel preserves both.
- **R8 - Description and notes:** support separate plain multiline description and personal notes, each up to 10,000 characters. The description explains the dish; notes can say what was good or disappointing. No image or rating is required to save.
- **R9 - Pictures:** allow 0-10 pictures per dish, selected from files or a camera input where supported. Permit removal, reordering, enlargement and selection of one cover picture; default cover is the first picture, and deleting it selects the next or none. Apply the existing compression/cache/R2 path in section 5. On compression, validation, quota or cache failure, show an error, retain the previous saved dish and keep the form available for correction. Uploads must not require connectivity to save locally.
- **R10 - Ordering details:** optionally store price and currency, size/portion, spice level, modifiers, last ordered date and dish category. Price is a nonnegative decimal amount with up to two fractional digits and a required three-letter currency code when price is present; currency selection has no silent default. Portion is free text up to 200 characters. Spice is Unknown, None, Mild, Medium, Hot or Extra hot. Modifiers are multiline text up to 2,000 characters, such as "no coriander, sauce on the side". Category is Unknown, Starter, Main, Side, Drink or Dessert. Last ordered is a valid calendar date, not a timestamp, and cannot be in the future when entered; clearing it means unknown. Price describes the dish, not a bill total.
- **R11 - Item dietary flags:** allow independent Vegetarian, Vegan, Gluten-free option and Dairy-free option flags. Vegan implies Vegetarian for filtering/display. Do not copy restaurant dietary tags onto dishes: a restaurant offering vegan options does not make every dish vegan. Flags are household observations, not verified allergy assurances; an unset flag means unknown.
- **R12 - Dish display:** show saved description, pictures, ordering details, dietary flags and notes, plus named ratings and the mean/count from R17. Empty optional values do not display invented defaults. Detail shows "Not rated" when no scores exist. Keep ordering modifiers readable beside the dish name.

Rating story: the household can remember that Ben loved a dish while Sarah would choose something else.

- **R13 - People:** create a person from the rating form or a small people-management flow, then reuse that person by stable ID. Names are trimmed, 1-80 characters, and unique case-insensitively across active and archived people. A matching archived name offers restoration. Do not require an email, age, account or profile image; do not prepopulate real names.
- **R14 - Scores:** save one current rating per dish/person, 1-10 inclusive in steps of 0.5. Require both a person and score; reject 0, 10.5, 8.25, non-numbers and duplicate rows for the same pair. Editing replaces the current score rather than adding a second opinion. Removing a rating leaves the person and dish intact. The UI expresses scores as numbers out of 10, including "Ben 9/10, Sarah 8/10".
- **R15 - Opinion detail:** each person's rating may include a 2,000 character comment and Would order again = Yes, No or Undecided. Missing means Undecided and is not inferred from the score. This belongs to each person rather than a single household flag. Display positive scores as that person's opinion; avoid a separate ambiguous "liked by" list.
- **R16 - Rename/remove people:** renaming updates every displayed attribution without rewriting rating history; reject a duplicate name. Default Remove archives the person: hide from new-rating pickers, retain existing names/scores and mark them Archived; restore makes them selectable again. Historical summaries still include archived people's scores. An explicit Erase person and ratings action previews the rating count and requires confirmation, then atomically deletes the person and all their ratings. Warn that this cannot erase earlier exports or published snapshots.
- **R17 - Summaries:** show each dish's arithmetic mean of current scores, rounded to one decimal, and the number of people rating it; never treat missing scores as zero. Ben 9 and Sarah 8 produces 8.5/10 from 2 people. Include archived people's retained scores. A selected-person view shows that person's score separately from the household mean. Restaurant rows show dish count and the highest-scoring matching dish (selected person's score when filtered, otherwise dish mean), with rating count and a stable dish-name/ID tie break; label it as a dish score, not a restaurant/service review.

Reliability story: the household can use the notebook offline, restore it, and move it through the app's existing sync.

- **R18 - Save/cancel:** restaurant, dish and rating changes save locally and appear without reload. Show field errors and a save error without a false success message. A failed multi-row save rolls back its metadata. Cancelling does not change saved records; leaving a dirty form offers Keep editing or Discard. Preparing images may leave unreferenced cached assets, which remain retained under the existing no-GC policy.
- **R19 - Sync:** include all five proposed metadata tables in the approved snapshot contract and adapters. Metadata-only, rating-only, person-rename and image-only changes all affect the digest and sync observation, including bulk/collection deletes. Publish only after every referenced image has been verified remotely. Import updates restaurant queries and image hydration state without reload. Sync remains whole-snapshot replacement with conditional publication; no row-level merge or simultaneous household editing guarantee is introduced.
- **R20 - Backups/import:** portable exports contain all five tables and all referenced owned image bytes, preserving IDs, relationships, scores, filenames and photo order. Restore without R2 access, using staged validation and atomic replacement. Missing bytes, invalid rows, duplicate item/person ratings, invalid foreign keys or unsupported versions leave current data intact. Restore/import that would remove restaurants, dishes, people or ratings must show those changes for confirmation, even when meal names are unchanged. Section 5 defines older backup handling.
- **R21 - Disclosure:** writer sync and full backups contain people's names, ratings and personal notes. Existing read-only links grant remote read access to an entire fixed immutable snapshot and its member images; they cannot publish, write cloud data or read latest through that capability. Recipients can edit and export their imported local copy: the normal app is not a read-only viewer. Permission expiry does not erase downloaded copies. These links do not provide dish-only sharing or field redaction. Before creating such a link containing restaurant data, show that disclosure explicitly, including names and comments, and allow cancellation. Do not label an existing whole-household link "Share this restaurant". Dish-only, sanitized sharing is a later enhancement; see section 7.

## 3. Proposed restaurant tags

Suggestions are a starter vocabulary, not mandatory classifications. Offer groups in the picker, allowing multiple cuisines/services and custom tags. Seed or offer suggestions idempotently so reopening the page does not create duplicates. Preserve these four exact display labels: **Vegetarian options**, **Vegan options**, **Only vegetarian**, **Only vegan**.

| Group | Proposed tags |
| --- | --- |
| Cuisine | Italian, Indian, Chinese, Thai, Japanese, Korean, Vietnamese, Mexican, Middle Eastern, Mediterranean, American, British, Pizza, Burgers, Cafe/bakery |
| Dietary | Vegetarian options, Vegan options, Only vegetarian, Only vegan, Gluten-free options, Dairy-free options, Halal options |
| Price | Budget, Mid-range, Treat/splurge |
| Service | Delivery, Takeout, Dine-in, Counter service, Reservations recommended |
| Occasion | Kid-friendly, Good for groups, Date night, Quick lunch, Special occasion, Late night, Breakfast/brunch |

Price tags are household judgments rather than automatic currency thresholds. Offer at most one price tag; other groups are multi-select. Absence of a dietary tag means unknown, never "no suitable food".

**Recommended relationship to meals:** add a separate `restaurantTags` table, reusing the current `tags` pattern of numeric IDs on the owning record, case-insensitive name reuse, autocomplete and chips. Restaurant service labels would otherwise appear in Meals' unscoped tag picker. Keep existing meal tag rows, meanings and IDs unchanged; cuisine/dietary words can coincide without sharing IDs. A shared table with an explicit scope is an alternative for glossner, but changes the meal tag schema and shared contract as well.

**Dietary rule:** store the labels explicitly selected, and derive filter implications without adding redundant rows. Only vegan implies Only vegetarian, Vegan options and Vegetarian options. Only vegetarian implies Vegetarian options. Vegan options implies Vegetarian options. Display Only vegan as the most specific badge while explaining the implied matches in picker help. Removing an explicit label removes its derived matches unless another explicit label still implies them. Vegetarian options and Vegan options alone never imply an exclusive restaurant. These labels describe food offerings, not promises about kitchen cross-contact or non-food products; if needed, describe exceptions in notes.

## 4. People and rating model

Use a household-wide `people` table rather than free-text names repeated on every dish. Rating forms select an active name and offer Add person inline. Stable IDs mean a rename updates attribution everywhere, and no extra account/authentication system is needed. A household member may record another person's opinion; this feature does not prove who submitted it.

Recommend half-points on a 1-10 scale, one current rating per dish/person, optional comment and per-person Would order again. No rating history in the first release. Item means are derived, not persisted. Archived people remain in the detail and historical means; an optional Include archived control exposes them in the person filter. Erasure removes their scores from recalculated means. Neither archive nor erasure recalls copies already shared or downloaded.

## 5. Data model and integration proposal

The code at the baseline is authoritative where older architecture docs differ. Dexie is already version 15; image bytes are in `imageAssets` with content-hash references, and v2 sync is implemented. The existing snapshot hard-codes schemaVersion 15 / adapterVersion 1 and a strict table set. Portable imports explicitly recognize versions 12, 14 and 15. Adding a table name alone is insufficient.

**Open decision reserved to glossner by the project rule:** approve the Dexie schema change and version bump before implementation. Recommend **version 16**, preserving existing stores and adding the five tables below. No schema is changed by this requirements document. Numeric `++id` keys match existing meal/store/tag patterns; no globally unique entity merge is promised.

| Proposed table | Proposed Dexie index string | Fields and relationships |
| --- | --- | --- |
| `restaurants` | `++id, name, updatedAt, *tags` | id, name, tags: restaurantTag IDs, notes, createdAt, updatedAt |
| `restaurantTags` | `++id, &normalizedName, group` | id, exact display name, normalizedName (trimmed lowercase), group: cuisine/dietary/price/service/occasion/custom |
| `restaurantItems` | `++id, restaurantId, name, category, lastOrderedDate, updatedAt` | id, restaurantId, name, description, notes, images, coverImageIndex?, priceAmount?, currency?, portion?, spiceLevel?, modifiers?, category?, lastOrderedDate?, dietaryFlags[], createdAt, updatedAt |
| `people` | `++id, &normalizedName, status` | id, display name, normalizedName, status: active/archived, createdAt, updatedAt |
| `restaurantItemRatings` | `++id, itemId, personId, &[itemId+personId], [personId+score]` | id, itemId, personId, score, comment?, wouldOrderAgain?: yes/no/undecided, createdAt, updatedAt |

Dates createdAt/updatedAt are stored and serialized as ISO UTC strings; explicitly extend the existing date-converter hooks for new tables if UI interfaces use Date. `lastOrderedDate` is `YYYY-MM-DD`, with calendar validation and no timezone conversion. `priceAmount` is a validated decimal string to avoid accidental rounding. The rating compound unique index prevents duplicate opinions for a pair. `[personId+score]` supports minimum-score lookup; map matching item IDs through restaurantItems to restaurant IDs. Do not denormalize person names or averages into ratings.

Relationships are enforced by application transactions and import validation, since Dexie does not enforce foreign keys. Validate that every dish owns an existing restaurant, every rating has an existing dish/person and every restaurant tag ID resolves. Enforce the same field limits and pair uniqueness on UI saves, cloud reads/writes and portable import. Multiple edits remain whole-snapshot sync operations; version conflicts need retry/review rather than automatic record merging.

**Open decision reserved to glossner by the project rule:** approve the shared sync contract/version strategy. Recommend retaining the existing **v2 envelope**, introducing **schemaVersion 16 / adapterVersion 2**, and explicitly supporting the old 15/1 shape for reading. Coordinate frontend and Images Worker rollout: old validators reject the new shape, so old clients must not keep writing to a collection after it is upgraded. A new version/collection is an alternative if isolating old writers is preferable; do not silently relax the old strict schema.

Implementation must update:

- `SNAPSHOT_TABLES` and `SnapshotRows` in the exported shared contract, plus both independently maintained validators: frontend `util/sync/snapshot-validation.ts` and Images Worker `src/image-storage/validation.ts`. Both strict validators must cover the new shape/version, five tables, row limits and reference checks; updating shared types alone is insufficient.
- Snapshot normalization, local reconstruction, temporary staging, metadata digest, replacement transactions, change confirmation, query invalidation and hydration. The current confirmation summary mostly compares meal names; add restaurant/dish/person/rating changes rather than implying it already handles them. Date/tag-only updates also require confirmation when they replace different local data.
- Image reference discovery everywhere: `getReferencedAssetIds`, snapshot freeze/inventory, runtime snapshot validation and reachability, portable validation/export/import, hydration counts and upload selection must include restaurantItems. Otherwise restaurant-only images can be omitted or rejected as unreferenced. Preserve bounded transfers and asset-first immutable publication.
- `INCLUDE_TABLES` for all five metadata tables, with row validators and version-aware required-table lists in the portable importer. Keep `imageAssets` included in portable backups; keep settings, sync locations, migration/upload jobs and credentials out of the portable data selection. Operational jobs are reconstructed/retained as in the existing importer.
- Existing liveQuery sync observation and mutation hooks where relevant; table-set coverage must catch multi-row saves/deletes as well as simple add/update. No new sync service or dependency is needed merely to include these tables.

**Upgrade and older input:** the v15-to-v16 DB upgrade only creates stores; existing meals, recipes, tags, lists, stores, cached bytes and sync settings remain intact. Default restaurant tables are empty and people are not seeded. Read old 12/14/15 portable backups and 15/1 snapshots through explicit adapters that supply empty restaurant tables. If local restaurant data would be removed, require a visible replacement confirmation listing counts; automatic sync must not silently clear it. Missing tables in a purported v16 backup are invalid. Unknown/future versions are rejected before touching live data. There is no implicit merge, and IDs/foreign keys must survive round trips unchanged.

**Pictures:** reuse `convertFilesToImageBlobs`, `cacheImage`/normalization, `StoredImage` and `useImageUrl`. Persist ordered `ImageRef` asset entries on restaurantItems, with a cover index into that array; keep bytes in the shared hash-keyed `imageAssets` cache and per-collection upload inventory. Hash/cache final compressed bytes before a short metadata transaction; recheck the restaurant exists and the saved image references resolve. Never put File/base64/data/blob URL payloads or signed R2 URLs in new dish metadata. Deduplicate identical final bytes, retaining per-slot filename/lastModified. The same verified R2 prepare/complete/commit/publish and download/hydration path used for meals must handle these references. Removing a picture/dish must not delete bytes another meal/dish/snapshot uses; retain the current no automatic GC policy.

The current image path targets 1 MiB/1920 pixels when compressing; this target is not a guaranteed bound. Actual new image bytes must meet the existing JPEG/PNG/WebP, 4 MiB, pixel and dimension limits before cloud publication. Core entry uses owned/cached pictures. External image-URL entry can be added later with an explicit offline limitation; no remote mirroring is proposed. After cloud import, show missing-image placeholders and hydration counts until verified bytes are cached, then mark owned images available offline. Browser storage eviction can still remove local copies; a complete backup must fail rather than omit required bytes.

## 6. Screens and flows (words only)

**Restaurant list:** a Restaurants page provides name/dish search, tag chips, person/minimum-score filtering, result count and a Create restaurant action. Each result provides name, tags, dish count and the labeled best-dish summary. An empty collection offers the first creation action. Keep filters visible while opening and returning from a restaurant.

**Restaurant detail:** show restaurant name, tags and general notes, with edit/delete actions. Its dish list groups by category, with Unknown last; each dish presents its cover, description, ordering details, named scores and mean/count. Add dish starts the item form; selecting a picture opens the existing enlargement pattern. An archived person remains visibly attributed. Include a small Manage people entry, avoiding a new account settings screen.

**Restaurant create/edit:** require only name; provide multi-tag autocomplete/chips and multiline notes. Save returns to the saved detail; cancel/discard follows existing dialogs and error toasts.

**Item add/edit:** start with name and description; optional photos and ordering fields follow, with repeated person/score/comment/Would order again rows. Add person inline, reject duplicate people in the form, and preview the cover. Save the item and its rating edits atomically after image preparation; deleting a rating row only affects that opinion. A rating can also be edited from a dish already saved. Keep multiline modifiers readable for repeat ordering.

Use the app's TanStack file routes, React Query/Dexie reads and invalidation, React Hook Form/Zod, and MUI components already used by Meals, recipe, GroceryList and stores: TextField, Autocomplete, Chip, Dialog, List, Accordion, Select, Checkbox and Button. These are flow descriptions, not a selected layout.

**Project Design rule:** before building any new flow/layout, the implementing worker must offer **2-4 genuinely different mockup options**, each with pros/cons and in every theme the app supports, using the app's components and tokens, together in one captured HTML file. Glossner must select an option before it is built. This documentation task creates no mockups and selects no layout.

## 7. Nice to have, ranked separately from the core

Value estimates reflect repeat-order convenience for a household; effort is relative to the proposed core. None is an acceptance condition for the first release.

| Rank | Idea | Value / effort | Proposed behavior or constraint |
| --- | --- | --- | --- |
| 1 | Copy "our usual order" | High / Low-medium | Select dishes, quantities and modifiers for named people, preview a plain-text summary, then copy/share it. Default output omits scores, comments and people's names unless explicitly included. |
| 2 | Favourite/pin restaurants | High / Low | Mark favourites and put pinned restaurants first, without changing tags or dish scores. |
| 3 | Menu/contact/map/delivery links | High / Low | Optional menu URL, phone, address, map link and delivery-app links; store entered links, not scraped availability or credentials. |
| 4 | Sort best rated for a person | High / Low-medium | Sort dishes/restaurants by the selected person's best dish score; keep unrated last and label ties/sample count. |
| 5 | "What should the household order?" | High / Medium | Suggest dishes using selected people's current ratings, dietary flags and Would order again, explain the scores and exclude explicit No for that person; use deterministic local logic first. |
| 6 | Order history | Medium-high / Medium | Record date, restaurant, selected dishes/quantities, total/currency and optional notes; preserve order-time prices/modifiers separately from today's dish details. |
| 7 | Menu photo | Medium / Low-medium | Cache and sync restaurant-level menu pictures via the same image path; count these in reachability/backups as well. |
| 8 | Dish-to-meal / "make at home" link | Medium / Medium | Link a dish to an existing meal, or create a reviewed custom grocery-list idea. A restaurant dish has no ingredient list, so do not invent ingredients or silently add them to a list. |
| 9 | Opening hours | Medium / Medium | Manually enter hours and a last-checked date first; defer live "open now" claims/timezone services. |
| 10 | Read-only restaurant sharing | Medium / High | Reuse snapshot-scoped capability delivery only after approving a restaurant-only sanitized export/projection. Preview exactly the dish/person fields and asset filenames included; omit names, ratings, personal notes and identifying filename metadata by default. Current whole-snapshot links cannot redact these. |
| 11 | Receipt/menu photo extraction | Medium / High | Follow the existing image upload + editable LLM-prefill pattern with explicit confirmation before sending a photo and review before save. The image-to-meal dialog/Worker are currently placeholders; extraction requires implementation, not just calling an existing working endpoint. Receipts may contain personal/payment information; omit it from saved structured output by default. |

## 8. Non-functional requirements and acceptance tests

- **R22 - Offline/PWA:** after the installed app shell is cached, create/edit/search/rate/delete using IndexedDB without network. Previously cached owned pictures render offline after reload; not-yet-hydrated pictures show a placeholder without blocking metadata use. Keep the feature reachable in the existing PWA modes and responsive on mobile; fetching new remote images and cloud sync wait for connectivity.
- **R23 - Accessible UI:** at 360 CSS pixels wide and desktop width, labels/validation and every CRUD/rating action remain usable without horizontal form scrolling. Keyboard users can select tags/people, enter exact numeric scores and confirm/cancel. Give image controls and fields accessible names, restore dialog focus, provide dish-name-based alt text, and never encode scores/status only in colour. Verify every supported theme without adding a theme in this task.
- **R24 - Image/performance limits:** load metadata for search/filter without decoding all pictures. Render list covers lazily, process photo work in bounded batches, release object URLs on cleanup and retain transfer limits. On a documented Chromium test machine with 500 restaurants, 5,000 dishes and 10,000 ratings plus 500 cached photo assets, a warmed list search/filter updates visible results within 500 ms of input; opening a restaurant renders its first 20 dish summaries within 1 second, excluding first-use image decoding. Record machine/browser and timings. This local stress set exceeds the current 10,000 total-record sync cap; do not promise it can be synced as one collection. At current cloud caps (2 MiB metadata, 512 assets, 10,000 total records), stop with an actionable message and preserve local data when limits are exceeded; a cap increase needs contract review.
- **R25 - Scope/dependencies:** use existing app and test dependencies; no new package, server-side CRUD database, authentication provider or paid service unless glossner approves it. Keep tokens, passes and signed transfers out of durable dish/person fields, backups and logs. Render entered text as text, not HTML. No external account or real household data is needed for tests.

Implementation acceptance coverage should extend the existing setup in [docs/TESTING.md](../TESTING.md), not create another test framework:

| Test area | Acceptance cases | Requirements |
| --- | --- | --- |
| Vitest: forms/model and queries | Whitespace names; limits; duplicate restaurant warning; custom/case-variant tag reuse; all dietary implications/removal; AND search/tag/person threshold rules and unrated exclusion; calendar/currency/score boundaries; named mean 8.5 and no zero-score defaults; independent Would order again | R2-R3, R5-R6, R8, R10-R17 |
| Vitest: real Dexie/fake IndexedDB | v15-to-v16 preserves meals/cache; unique rating pair; rename/archive/restore/erase; item save rollback; restaurant/dish delete cascade; image cache failure; tag/person FK validation; cover reorder/delete and image dedup | R4, R7, R9, R13-R18 |
| Vitest: portable backup | Offline round trip of five tables plus exact referenced byte hashes and filenames; restaurant-only assets; frozen snapshot during concurrent write; invalid/missing/future input leaves live data unchanged; old backup replacement explicitly reports cleared restaurant data | R9, R19-R20 |
| Vitest: frontend + Images Worker | Approved new/old contract adapters; ratings/person-only and bulk-delete digest/observation; restaurant-only image discovery, asset-first publish, duplicate transfer reuse, import/hydration/expiry/corruption and conditional conflict; schema mismatch rejection; names/comments present in full snapshot and absent from any future sanitized projection | R19-R21, R24-R25 |
| Vitest: cloud-cap boundaries | Independently test canonical UTF-8 snapshot size at 2 MiB and one byte over, 512/513 unique referenced asset hashes (reuse duplicates across meal/dish slots), and 10,000/10,001 total rows summed across old and all five new tables. At limits accept; above limits reject in frontend and Worker while preserving local metadata and the last published head | R19-R20, R24 |
| React DOM / Playwright visible flows | Navigate list/detail; create/edit/delete restaurant and dish; Ben 9/Sarah 8 example; rename/archive; combined filtering and no results; dirty form cancel; photo controls; disclosure cancellation; show replacement counts before import | R1-R18, R20-R21, R23 |
| Playwright round trip/sync | Save photos and ratings, restore portable backup with identical bytes; sync up/down against existing local Worker/R2 stub and visibly update scores and covers | R9, R19-R21 |
| Playwright PWA/offline extension | Extend the guarded runner with a built pwa-test preview flow; await service-worker control and precache readiness, then set the fresh context offline and reload a restaurant deep route. Assert CRUD/ratings work, cached photos render and uncached photos show placeholders | R9, R22 |
| Accessibility/performance probes | Keyboard/focus, 360px viewport, supported themes, lazy covers/object URL cleanup, recorded stress timings, and cap-exceeded local-data retention | R23-R25 |

Use synthetic names/images, fresh test contexts and the existing guarded localhost transports. Extend Vitest files in package tests and browser flows in `apps/frontend/tests/e2e`; mock storage/SDK transports rather than this feature. The current e2e launcher uses Vite regression mode, which does not register the PWA plugin; it cannot by itself prove an offline app-shell reload. Keep its localhost request guards and process isolation when adding the built pwa-test case. Future implementation validation uses the existing `npm test`, extended `npm run test:e2e`, `npm run test:types`, frontend lint and root build commands. This documentation task runs no app tests, installs no dependencies and starts no dev server.

## 9. Open questions for glossner

Each entry has a recommended default for review; these are proposals, not implementation approvals.

| Question | Recommended default | What changes if overruled |
| --- | --- | --- |
| Approve the Dexie schema/version change? **Project rule: glossner decides.** | v16 and the five proposed tables | Rework table boundaries/indexes/migration before implementation. |
| Approve the shared sync contract/rollout? **Project rule: glossner decides.** | v2 envelope, schema 16 / adapter 2, explicit old readers, coordinated rollout | A separate envelope/collection needs different migration and rollout handling. |
| Separate restaurant tags or reuse meal tags? | Separate restaurantTags with the same UX | Shared tags need scoped meal suggestions and changes to existing tag contracts. |
| How should Only vegan relate to Only vegetarian? | Derived implication, most-specific badge | Independent meanings need different filter rules and help text. |
| Whole-number scores or half-points; should opinions have history? | 1-10, halves, one current opinion | Whole scores simplify entry; historical scores require order/time records and different summaries. |
| What should removing a person do? | Archive by default; explicit erase removes ratings | Immediate deletion loses attribution and changes means without restoration. |
| How much ordering detail belongs in the first release? | Optional price/currency, portion, spice, modifiers, category, date, dietary flags and per-person Would order again | A smaller form defers selected fields without weakening restaurant/dish/rating CRUD. |
| Include restaurant sharing in the first release? | Defer dish-only sharing; disclose full-snapshot exposure | Earlier sharing needs a sanitized projection and privacy review before release. |
| Which extras should follow first? | Copy usual order, favourites, then menu/contact links | Priorities change later scope; no extra becomes core without review. |
| Which screen layout should be built? **Design rule: glossner selects.** | Implementing worker supplies 2-4 options before building | Different selected options affect navigation and form presentation; no default layout is approved here. |

## Codebase references

Architecture reading: [overview](../architecture/overview.md), [frontend](../architecture/frontend.md), [data model](../architecture/data-model.md), [workers](../architecture/backend-workers.md), [image storage design](../design/image-storage-options.md). These documents include older descriptions; the inspected baseline code determines the integration proposal.

Current patterns: [Dexie tables/INCLUDE_TABLES](../../apps/frontend/src/db/db.ts), [date hooks](../../apps/frontend/src/db/date-converter.ts), [Meals/tags](../../apps/frontend/src/pages/Meals.tsx), [recipe editor](../../apps/frontend/src/routes/recipe.$mealId.tsx), [GroceryList](../../apps/frontend/src/pages/GroceryList.tsx), [stores](../../apps/frontend/src/pages/ManageStores.tsx), [navigation](../../apps/frontend/src/routes/__root.tsx).

Integration: [image cache/reachability](../../apps/frontend/src/db/image-cache.ts), [image limits/refs](../../apps/frontend/src/shareable/image-assets.ts), [snapshot contract/SNAPSHOT_TABLES](../../apps/frontend/src/shareable/snapshot.ts), [snapshot adapter](../../apps/frontend/src/util/sync/snapshot-adapter.ts), [runtime validator](../../apps/frontend/src/util/sync/snapshot-validation.ts), [portable export](../../apps/frontend/src/util/db/export.ts), [portable import](../../apps/frontend/src/util/db/import.ts), [sync observation](../../apps/frontend/src/hooks/useDebouncedSync.ts), [share links](../../apps/frontend/src/util/sync/share.ts), [image-generation stub](../../apps/go-groceries-images-meal-resolver/src/endpoints/generate-meal-data-from-images.ts).
