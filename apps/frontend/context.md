# Project Context

This document summarizes key information about the `apps/frontend` project.

## Technologies Used:
*   **Frontend Framework:** React
*   **Language:** TypeScript
*   **State Management/Data Fetching:** `@tanstack/react-query`
*   **Database (Client-side):** `dexie` (IndexedDB wrapper)
*   **UI Library:** `@mui/material`
*   **Form Management:** `react-hook-form`
*   **Schema Validation:** `zod`
*   **Routing:** `@tanstack/react-router`
*   **Build Tool:** Vite

## Key Files/Components:
*   `src/pages/Meals.tsx`: Main component for displaying and managing meals.

## Development Scripts:
*   `npm run check-types`: Runs TypeScript compiler for type checking (`tsc -b`).
*   `npm run lint`: Runs ESLint for code linting (`eslint .`).
*   `npm run build`: Builds the project for production (`vite build`).
