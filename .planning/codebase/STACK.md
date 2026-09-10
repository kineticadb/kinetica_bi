# Technology Stack

**Analysis Date:** 2026-03-23

## Languages

**Primary:**
- TypeScript 5.4.2 - Frontend and backend application code
- JavaScript (JSX/TSX) - React component development

**Secondary:**
- SQL - Kinetica database queries and DDL

## Runtime

**Environment:**
- Node.js 18+ (inferred from ES modules and modern features)

**Package Manager:**
- npm - Primary dependency manager
- Lockfile: `package-lock.json` present in both frontend and server directories

## Frameworks

**Core:**
- React 18.3.1 - Frontend UI framework
  - React DOM 18.3.1 - React rendering for DOM
  - React Grid Layout 2.2.2 - Dashboard grid/layout management
  - Zustand 4.5.2 - State management
  - Recharts 2.10.3 - Data visualization and charting

**Backend:**
- Express 4.19.2 - HTTP server and REST API framework
- Better SQLite3 9.4.3 - Embedded SQLite database for local storage

**Build/Dev:**
- Vite 5.2.0 - Frontend build tool and development server
  - `@vitejs/plugin-react` 4.3.0 - React JSX transformation
- TSX 4.7.0 - TypeScript runner for Node.js scripts (development)
- TypeScript 5.4.2 - Type checking and compilation

**Utilities:**
- CORS 2.8.5 - Cross-origin request handling for Express
- dotenv 16.4.5 - Environment variable loading
- clsx 2.1.0 - Utility for conditional className strings

## Key Dependencies

**Critical:**
- React 18.3.1 - Core frontend framework; all UI built on React
- Express 4.19.2 - Backend API server; all endpoints defined via Express middleware
- Better SQLite3 9.4.3 - Local dashboard/widget persistence; schema in `kinetica_bi/server/src/db.ts`
- Zustand 4.5.2 - Global state management for frontend (user store in `src/store/user.ts`)

**Infrastructure:**
- react-grid-layout 2.2.2 - Dashboard grid layout functionality in `src/components/DashboardsPage.tsx`
- recharts 2.10.3 - Chart rendering in dashboard widgets
- CORS 2.8.5 - Cross-origin support between frontend (port 5173) and backend (port 4000)
- dotenv 16.4.5 - Environment configuration loading

## Configuration

**Environment:**
- Environment variables stored in `.env` files (server: `kinetica_bi/server/.env` and `kinetica_bi/server/.env.example`)
- Frontend API URL configured via Vite env var: `VITE_API_URL` (defaults to `http://localhost:4000`)
- Configuration loaded via `dotenv.config()` in `kinetica_bi/server/src/index.ts` line 26

**Build:**
- `vite.config.ts` - Frontend build configuration (dev server on port 5173, sourcemaps enabled)
- `tsconfig.json` - TypeScript compilation settings (strict mode, JSX as react-jsx, ESNext target)
- `tsconfig.node.json` - TypeScript config for Node scripts

**Key Configuration Files:**
- `kinetica_bi/package.json` - Frontend dependencies
- `kinetica_bi/server/package.json` - Backend dependencies
- `kinetica_bi/vite.config.ts` - Vite dev server and build configuration

## Platform Requirements

**Development:**
- Node.js 18+ (estimated from ES modules syntax and modern features)
- npm for dependency management
- Port 5173 for frontend dev server (Vite)
- Port 4000 for backend API server (Express)
- SQLite3 supported by better-sqlite3

**Production:**
- Node.js runtime for Express server
- Network access to Kinetica instance (see INTEGRATIONS.md)
- Better SQLite3 native module compilation may require build tools on deployment

---

*Stack analysis: 2026-03-23*
