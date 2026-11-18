# Repository documentation

These documents describe the source on `docs-unsure`, based on `4fe98a9`. File links are the evidence for implementation claims; a configured script or declared type does not establish successful deployment or runtime behavior.

| Document | Contents |
| --- | --- |
| [Architecture overview](architecture/overview.md) | Product, workspaces, package dependencies, and component/data flow. |
| [Frontend](architecture/frontend.md) | Routes, UI/state ownership, forms, sync, and PWA behavior. |
| [Data model](architecture/data-model.md) | Every Dexie table, relationships, versions, date conversion, and backup/import. |
| [Backend workers](architecture/backend-workers.md) | Hono routes, contracts, external dependencies, configuration names, and shared backend code. |
| [Development](development.md) | Package-scoped commands, Turbo configuration, local setup, and deployment paths. |
| [Earlier branch analysis](analysis/unsure-branch-last-3-commits.md) | Historical review and checks of the three source commits preceding the documentation base. |

## Existing context and plans

- [Root README](../README.md): original PWA/S3 workflow; its npm commands require the frontend workspace. See [Development](development.md) for command scope.
- [Frontend context](../apps/frontend/context.md) and [frontend agent guidance](../apps/frontend/GEMINI.md): technology summary and contributor conventions. The context's build summary omits the current `build-node` step; [package.json](../apps/frontend/package.json) defines the scripts.
- [YouTube worker summary](../apps/go-groceries-youtube-meal-resolver/GEMINI.md), [YouTube README](../apps/go-groceries-youtube-meal-resolver/README.md), and [images README](../apps/go-groceries-images-meal-resolver/README.md): existing context. The worker READMEs describe an older OpenAPI/Swagger template; the [worker architecture](architecture/backend-workers.md) documents the routes actually registered.
- [File-retrieval plan](../file-retrieval.md): historical design. The [implemented contracts](architecture/backend-workers.md) include authentication and storage-type fields missing from the plan's example.
- [YouTube example response](../apps/go-groceries-youtube-meal-resolver/example_response.md): a historical extraction prompt/example, rather than the current HTTP response envelope.
- [Ingredient/store design](../apps/frontend/prompts/ingredient_store_design.md), [recipe requirements](../apps/frontend/prompts/recipe-requirement.md), [sync-to requirements](../apps/frontend/prompts/syncer.md), and [sync-from requirements](../apps/frontend/prompts/sync-from.md): design intent. Use the source-backed architecture pages for implemented behavior and limitations.
