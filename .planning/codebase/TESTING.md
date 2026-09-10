# Testing Patterns

**Analysis Date:** 2026-03-23

## Test Framework

**Status:** No testing framework detected

**Runner:**
- Not detected - no Jest, Vitest, Mocha, or other test runner installed
- No test configuration files present (jest.config.*, vitest.config.*, etc.)

**Assertion Library:**
- Not applicable - no testing framework configured

**Run Commands:**
- Not available - no test scripts defined in package.json files
- Frontend `package.json` has no test command
- Server `package.json` has no test command

**Build and Development:**
- Frontend: `npm run dev` (vite dev server), `npm run build` (vite build), `npm run preview`
- Server: `npm run dev` (tsx watch), `npm run start` (node), `npm run build` (tsc)

## Test File Organization

**Current Status:** No test files present

**File Search Results:**
- No `*.test.ts`, `*.test.tsx`, `*.spec.ts`, or `*.spec.tsx` files found in codebase
- No `__tests__` directories present
- No test utilities or fixtures directories

**Recommendation Pattern (if tests were added):**
- Co-locate test files: `ComponentName.tsx` and `ComponentName.test.tsx` in same directory
- For utilities: `client.ts` and `client.test.ts` in `src/api/`
- Server routes: `index.ts` and `index.test.ts` in `server/src/`

## Test Structure

**Recommended Pattern (based on TypeScript/React stack):**

For React components with Vitest:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Dashboard from './Dashboard';

describe('Dashboard', () => {
  it('renders dashboard with KPI grid', () => {
    render(<Dashboard />);
    expect(screen.getByText(/Active Dashboards/)).toBeInTheDocument();
  });

  it('displays chart cards', () => {
    render(<Dashboard />);
    expect(screen.getByText(/Throughput vs Latency/)).toBeInTheDocument();
  });
});
```

For API client functions:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSql, listDashboards } from './client';

describe('API Client', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('runSql should throw on failed response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal error'
    });

    await expect(runSql('SELECT 1')).rejects.toThrow();
  });
});
```

## Testing Recommendations

### Current Gaps

**What's NOT Tested:**
- No component rendering or interaction tests
- No API client error handling validation
- No database operations testing
- No server route handler testing
- No type validation tests
- No Zustand store operations
- No async data fetching flows

### Unit Test Candidates (High Priority)

**API Client (`src/api/client.ts`):**
- Response status validation
- Error message formatting
- Type assertions on response JSON
- Generic type parameter handling
- Environment variable configuration

**Database Functions (`server/src/db.ts`):**
- CRUD operations on all tables
- Row mapping functions (`mapDashboard`, `mapWidget`)
- Query parameter substitution
- Transaction consistency

**Store (`src/store/user.ts`):**
- Initial state
- `setName` action updates user and derives initials
- Zustand store creation and subscriptions

### Integration Test Candidates (Medium Priority)

**Server Routes (`server/src/index.ts`):**
- GET endpoints return correct data format
- POST endpoints validate required fields
- PATCH endpoints update partial objects
- DELETE endpoints return 204 status
- Middleware execution (CORS, JSON parsing)
- Error handling and 404/500 responses

**API Client + Server Interaction:**
- End-to-end dashboard CRUD flows
- Widget management within dashboards
- Table management and associations
- Error propagation from server to client

### E2E Test Candidates (Lower Priority)

**User Flows:**
- Dashboard creation, editing, deletion
- Widget placement and configuration
- Table selection and schema browsing
- Navigation between pages

## Mocking Patterns

**Framework:** Not yet established - Vitest recommended

**Fetch Mocking (API client tests):**
```typescript
// Mock successful response
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: async () => ({ data: [...] })
});

// Mock error response
global.fetch = vi.fn().mockResolvedValue({
  ok: false,
  status: 404,
  text: async () => 'Not found'
});

// Mock network error
global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
```

**React Component Testing:**
```typescript
// Mock API calls in components
vi.mock('../api/client', () => ({
  listDashboards: vi.fn(() => Promise.resolve([...]))
}));

// Mock Zustand store
vi.mock('../store/user', () => ({
  useUserStore: () => ({
    user: { name: 'Test User', initials: 'TU', role: 'Admin' },
    setName: vi.fn()
  })
}));
```

**What to Mock:**
- External API calls via `fetch`
- Zustand stores (or use real store with test data)
- Browser APIs: `window.confirm()`, `window.fetch()`
- Environment variables via `import.meta.env`

**What NOT to Mock:**
- Component child components (test behavior, not implementation)
- React hooks (`useState`, `useEffect`) - let them run
- Custom hooks that contain business logic (test them directly)
- Database layer in server tests (use in-memory SQLite or test database)

## Fixtures and Factories

**Test Data Patterns (if added):**

Sample data already exists in `src/data/sampleData.ts`:
```typescript
export const kpi = [
  { label: "Active Dashboards", value: 42, delta: 8 },
  // ...
];

export const throughput = [
  { name: "Mon", records: 12, latency: 140 },
  // ...
];
```

**Recommended Factory Pattern for Tests:**
```typescript
// tests/factories/dashboard.ts
export function makeDashboard(overrides = {}): DashboardDto {
  return {
    id: 1,
    name: "Test Dashboard",
    description: "Test",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  };
}

export function makeWidget(overrides = {}): WidgetDto {
  return {
    id: 1,
    dashboard_id: 1,
    title: "Test Widget",
    type: "chart",
    position: 0,
    config: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  };
}
```

## Testing Setup Recommendation

**Recommended Stack:**
- Runner: Vitest (modern, fast, ESM-native)
- Component testing: @testing-library/react
- Assertions: Vitest built-in assertions or chai
- Mocking: Vitest vi (built-in mocking)
- Coverage: Vitest --coverage

**Installation:**
```bash
npm install -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```

**Configuration (`vitest.config.ts`):**
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts']
  }
});
```

**Server Testing (`vitest.config.server.ts`):**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true
  }
});
```

## Coverage Goals

**Not Currently Enforced**

**Recommended Coverage Targets:**
- Statements: 80% (UI components hard to test)
- Branches: 70% (conditional logic in API client)
- Functions: 90% (utility functions and handlers)
- Lines: 80% (code paths)

## Test Types

**Unit Tests (Recommended Priority 1):**

API Client Functions (`src/api/client.ts`):
- Each exported function has 1-2 test cases
- Test success path and error path
- Test type assertions and generics
- Scope: Single function in isolation

Database Functions (`server/src/db.ts`):
- CRUD operations per entity type
- Mapper functions (mapDashboard, mapWidget)
- Query correctness
- Scope: Single function, but database state matters

Zustand Store (`src/store/user.ts`):
- Store creation and initial state
- Actions update state correctly
- Derived values computed correctly
- Scope: Store module

Component Units (`src/components/*.tsx`):
- Small presentational components: `ChartCard`, `KPIGrid` (easy)
- Props render correctly
- Event handlers called
- Larger components like `DashboardsPage` harder - test behavior not structure

**Integration Tests (Recommended Priority 2):**

Server Routes (`server/src/index.ts`):
- Route handlers with real database
- Request validation
- Response formats
- Error handling
- HTTP status codes correct
- Scope: Route + handler + database

API Client + Component:
- Component fetches data via client
- Loading/error/success states rendered
- State updates trigger re-renders
- Scope: Component + API layer

**E2E Tests (Optional):**

User workflows with Playwright/Cypress:
- Dashboard CRUD flow
- Widget management
- Navigation
- Would require running both client and server

---

*Testing analysis: 2026-03-23*

**Key Finding:** No testing framework currently configured. Codebase is ready for test infrastructure. Recommend starting with unit tests for API client and database functions, then expanding to components.
