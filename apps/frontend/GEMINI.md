# AGENTS.md

This document outlines agent behaviors, constraints, and expectations for working in this codebase.

## 🚫 Server Rules

**Do not** run the development server unless explicitly instructed. This includes:

* Starting local dev environments (`npm run dev`, `yarn dev`, etc.)
* Launching Docker containers that serve web interfaces
* Any action that listens on ports

Violating this guideline can lead to unpredictable behavior or conflict with other processes.

---

## 🧠 Agent Mindset

Pretend you're a human developer who writes code with minimal inline commentary. Assume others can read the code and don't need excessive hand-holding. Use these principles:

* Favor readable code over verbose comments
* Leave comments **only** when:

  * There's non-obvious logic
  * An external system is involved
  * A TODO or FIXME is necessary

Examples:

✅ Good:

```ts
// Handles Stripe webhook signature verification
```

❌ Bad:

```ts
// This function takes a string and returns it reversed
```

---

## ✅ Do

* Follow project conventions and existing patterns
* Ask before introducing new libraries or tools
* Use clean, modular code
* After any file changes, re-run the build via `npm run check-and-build` and fix any errors until the build passes.

## ❌ Don’t

* Comment everything
* Make assumptions about deployment or server behavior
* Push directly to main branches
* NEVER install any packages via `npm install` without asking me for EACH one

---

## 🔄 Updates

If this file changes, treat it like a contract update. Review it carefully.

---

Let me know if you want to add sections like agent-specific roles, naming conventions, or testing rules.

## ✨ Query Invalidation Best Practices

When a database value that is being fetched by `react-query` is updated, it is crucial to invalidate the corresponding query to ensure that all consuming components refetch the latest data.

*   **When to invalidate:** Invalidate a query immediately after a successful mutation (create, update, delete) that affects the data represented by that query.
*   **How to invalidate:** Use `queryClient.invalidateQueries` within the `onSuccess` callback of your `useMutation` hook.
*   **Refetch Type:** Always specify `refetchType: 'active'` (or the default behavior in `react-query` v5+) to ensure that only actively rendered components' queries are refetched, optimizing performance.

**Example:**
When updating the `lastEditedGroceryListId` (which is fetched by the `['lastEditedGroceryListId']` query), the mutation responsible for setting this ID should include:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setLastEditedGroceryListId } from '../util/db/settings';

export const useSetLastEditedGroceryListId = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => setLastEditedGroceryListId(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['lastEditedGroceryListId'],
        refetchType: 'active',
      });
    },
  });
};
```
