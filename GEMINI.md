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

## ❌ Don’t

* Comment everything
* Make assumptions about deployment or server behavior
* Push directly to main branches

---

## 🔄 Updates

If this file changes, treat it like a contract update. Review it carefully.

---

Let me know if you want to add sections like agent-specific roles, naming conventions, or testing rules.
