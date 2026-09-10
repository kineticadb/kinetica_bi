# Coding Conventions

**Analysis Date:** 2026-03-23

## Naming Patterns

**Files:**
- Component files use PascalCase: `Dashboard.tsx`, `ChartCard.tsx`, `DashboardsPage.tsx`
- Non-component files use camelCase: `client.ts`, `sampleData.ts`, `user.ts`
- Type/interface files follow their content purpose: `types/index.ts`, `db.ts`
- Database module files are named by their function: `db.ts` for database operations

**Functions:**
- Exported functions use camelCase: `runSql()`, `createDashboard()`, `listDashboards()`, `updateDashboard()`
- React component functions are named as PascalCase components: `Dashboard`, `ChartCard`, `DashboardsPage`
- Async functions are clearly named with action verbs: `fetchKineticaSchemas()`, `fetchKineticaTables()`, `fetchKineticaColumns()`
- Helper functions follow camelCase: `ensureDir()`, `mapDashboard()`, `format()` (KPIGrid.tsx)
- CRUD operations follow naming pattern: `create*`, `list*`, `get*`, `update*`, `delete*`

**Variables:**
- React state variables use camelCase: `dashboards`, `loading`, `error`, `view`
- State setters follow React convention: `setDashboards()`, `setLoading()`, `setError()`, `setView()`
- Event handlers use handle prefix: `handleDelete()`, `onSelect()`, `onViewChange()`
- Props objects defined inline are unnamed or use generic `Props` type name
- Constants use lowercase naming in objects: `nav`, `palette`

**Types:**
- Type definitions end with `Type` suffix: `UserState`, `ActivityRow`, `KPIMetric`
- DTO (Data Transfer Object) types end with `Dto` suffix: `DashboardDto`, `TableDto`, `WidgetDto`
- Union types use `|` operator for mode variants: `type Page = "overview" | "dashboards" | ...`
- Props types are defined inline in component files with generic `Props` name
- Exported types in `types/` and API modules are domain-specific

## Code Style

**Formatting:**
- No explicit formatter configured (no .prettierrc, .eslintrc, or biome.json found)
- Observed style uses 2-space indentation
- Line lengths vary without strict enforcement
- Import statements not automatically sorted
- Trailing commas appear in most multi-line structures
- Arrow functions preferred over function declarations

**Linting:**
- No linter configuration detected in project root
- TypeScript strict mode enabled: `"strict": true` in tsconfig.json
- allowJs disabled: `"allowJs": false`
- esModuleInterop enabled for better ES module compatibility

## Import Organization

**Order:**
1. External packages: `import React from "react"`, `import { useState } from "react"`
2. Third-party libraries: `import clsx from "clsx"`, `import { create } from "zustand"`
3. Chart libraries: `import { AreaChart, ... } from "recharts"`
4. Relative imports: `import ChartCard from "./ChartCard"`, `import Dashboard from "./components/Dashboard"`
5. Type imports at module level: `import { DashboardDto } from "../api/client"`

**Path Aliases:**
- Not detected in tsconfig.json or vite.config.ts
- All imports use relative paths with `./` or `../` notation
- No alias shortcuts like `@/` are configured

**Import Grouping Examples:**
- `src/components/Dashboard.tsx`: External libraries first (recharts), then relative imports (components, data)
- `src/api/client.ts`: No internal imports (pure API layer)
- `src/components/DashboardsPage.tsx`: API imports, component imports, style imports in sequence

## Error Handling

**Patterns:**
- Async functions throw errors directly: `throw new Error("SQL request failed: ${response.status} ${error}")`
- Response validation before processing: Check `response.ok` before calling `response.json()`
- 204 status code explicitly handled for DELETE operations: `if (!response.ok && response.status !== 204)`
- Try-catch blocks used in Express route handlers for async operations
- Client errors caught with `.catch()` in promises: `.catch((err) => setError(err.message))`
- Error messages logged to console before returning HTTP response
- Window confirmation dialogs for destructive operations: `window.confirm()` in `DashboardsPage.tsx`
- Null coalescing operator used for defaults: `input?.title || !input?.type`, `input.position ?? 0`

**Server Error Response Pattern:**
```typescript
// Validation errors
if (!name) return res.status(400).json({ error: "Dashboard name is required." });

// Not found errors
if (!updated) return res.status(404).json({ error: "Dashboard not found." });

// Upstream service errors
catch (error) {
  console.error("Kinetica schemas error", error);
  return res.status(502).json({ error: "Failed to fetch schemas", detail: String(error) });
}
```

## Logging

**Framework:** `console` (no logging library used)

**Patterns:**
- Server-side: `console.error()` and `console.log()` only
- Client-side: No logging observed
- Log messages prefixed with domain context: `"Kinetica schemas error"`, `"Kinetica tables error"`, `"WMS proxy error"`, `"SQL proxy error"`
- Error objects passed as second argument: `console.error("description", error)`
- Startup logging: `console.log(\`Kinetica BI backend running on http://localhost:${port}\`)`

## Comments

**When to Comment:**
- Minimal commenting observed throughout codebase
- Comments appear primarily in complex data transformation logic
- Database initialization SQL includes inline comments for clarity on schema purpose

**JSDoc/TSDoc:**
- Not used in the codebase
- No function or type documentation comments found
- TypeScript provides implicit type documentation through type annotations

## Function Design

**Size:**
- Components and functions are generally small and focused
- `ChartCard.tsx` is 23 lines total
- `KPIGrid.tsx` is 27 lines total
- `Dashboard.tsx` is 87 lines (largest single component)
- API functions are single-responsibility: One function per HTTP method combination
- Database functions are minimal, typically 1-3 lines

**Parameters:**
- React components use object destructuring for props: `({ title, description, actions, children, dense }: Props)`
- API functions accept typed parameters: `async (sql: string, options?: Record<string, unknown>)`
- Event handlers use inline arrow functions for single operations
- Partial type updates for PATCH operations: `Partial<Pick<TableDto, "name" | "description">>`

**Return Values:**
- Components return JSX or null
- API functions return typed promises: `Promise<T>`, `Promise<DashboardDto[]>`
- Database functions return domain types or undefined: `Dashboard | undefined`
- Express handlers return response objects via `res.json()`, `res.status().json()`, `res.send()`
- Generic type parameters used for flexibility: `runSql<T>()` returns `Promise<T>`

## Module Design

**Exports:**
- Named exports for utility functions: `export const runSql = ...`
- Default exports for React components: `export default Dashboard`
- Type exports placed at top of API module before function implementations
- Both named and type exports in `src/api/client.ts` (functions + DTOs)
- Zustand store exported directly: `export const useUserStore`

**Barrel Files:**
- `src/types/index.ts` re-exports types for centralized type definitions
- No other barrel patterns (index.ts) observed
- Components imported directly from their files, not via index files

## State Management

**Zustand Store Pattern:**
```typescript
export const useUserStore = create<UserState>((set) => ({
  user: { name: "Data Engineer", initials: "DE", role: "Admin" },
  setName: (name) =>
    set((state) => ({
      user: { ...state.user, name, initials: name.slice(0, 2).toUpperCase() }
    }))
}));
```

**React Local State Pattern:**
- `useState` for component-local state management
- Multiple state variables used together: `loading`, `error`, `dashboards`
- State setter functions called directly or through event handlers
- Error state captured and displayed: `error && <div>{error}</div>`

## API Client Pattern

**Consistent Structure in `src/api/client.ts`:**
- Base URL from environment or default: `const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000"`
- Each API function handles its own fetch, validation, and error handling
- Response validation checks `response.ok` before parsing
- Type safety with generics and type assertions: `response.json() as Promise<DashboardDto>`
- Consistent error message format: `\`${operation} failed: ${response.status} ${error}\``
- JSON body requests include `"Content-Type": "application/json"` header
- DELETE requests check both `.ok` and status code 204

---

*Convention analysis: 2026-03-23*
