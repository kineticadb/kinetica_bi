# Stack Research — v1.0 Authentication & Per-User Access

**Domain:** Per-user credential passthrough on an Express 4 + JWT cookie BI server
**Researched:** 2026-04-27
**Confidence:** HIGH (versions verified live against the npm registry; encryption primitives verified via runtime Node check)

## Scope Note

This is a **delta** for a subsequent milestone, not a fresh stack. The existing server already pins:

- `express ^4.19.2`, `jsonwebtoken ^9.0.3`, `cookie-parser ^1.4.7`, `better-sqlite3 ^12.8.0`, `cors ^2.8.5`, `dotenv ^16.4.5`
- The session pattern is an httpOnly JWT (HS256) cookie `kbi_session`, 8h TTL, signed with `AUTH_SECRET`, validated by `requireAuth` on `/api/*`.

The only thing the v1.0 milestone needs to add is **a way to carry the user's Kinetica password between requests** so the server can re-emit `Authorization: Basic …` on every downstream call (SQL proxy, schemas/tables/columns discovery, view materialize, WMS proxy). Everything else stays.

## Recommendation Summary

**Adopt:** server-side encrypted credential row in the existing `better-sqlite3` database, keyed by an opaque session id; the JWT cookie payload changes from `{ sub }` to `{ sub, sid }`. Encryption uses Node's built-in `node:crypto` AES-256-GCM with a key derived from `AUTH_SECRET` via HKDF.

**Do NOT adopt:** `iron-session`, `@hapi/iron`, `express-session`, `connect-better-sqlite3`, `better-sqlite3-session-store`, or storing credentials in the JWS payload. Justifications below.

## Recommended Stack

### Core Technologies (already in place — no change)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| express | ^4.19.2 (current latest 4.x: 4.21.x; pin keeps minor flexibility) | HTTP framework | Already wired with `cookie-parser`, `cors`, JSON body parser, and `requireAuth`. No reason to swap. |
| jsonwebtoken | ^9.0.3 (latest 9.0.3, published 2026-04-16 — current) | Sign/verify the session cookie | Already issuing `kbi_session`. Stays as the integrity wrapper around `{ sub, sid }`. |
| cookie-parser | ^1.4.7 | Parse `Cookie` header into `req.cookies` | Already handles `kbi_session`. No change. |
| better-sqlite3 | ^12.8.0 (latest 12.9.0, published 2026-04-12 — current major) | Local persistence | Already the persistence layer. New `sessions` table fits the existing pattern; no extra driver. |

### Supporting Libraries — additions for v1.0

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **`node:crypto`** (Node ≥ 20 built-in; verified working on the runtime in this repo, Node 24.14.1) | bundled | AES-256-GCM encrypt/decrypt the stored Kinetica password; HKDF derive a 32-byte data key from `AUTH_SECRET` | This milestone — single dependency-free choice for symmetric encryption at rest in a small Express service. |

That is the entire dependency delta. No new npm packages. The implementation is ~60 lines of code touching `auth.ts`, a new `sessions.ts` (or a few rows in `db.ts`), and a `kineticaFetch(req, …)` helper that replaces the four current call sites.

### Recommended `sessions` table shape (informational; concrete schema is for the planning phase)

```
sessions (
  sid           TEXT PRIMARY KEY,        -- 256-bit random, base64url
  username      TEXT NOT NULL,
  ciphertext    BLOB NOT NULL,           -- AES-256-GCM ciphertext of "username:password"
  iv            BLOB NOT NULL,           -- 12-byte GCM nonce, fresh per row
  auth_tag      BLOB NOT NULL,           -- 16-byte GCM auth tag
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL         -- matches the JWT exp; rows GC'd on read
)
```

The JWT cookie payload becomes `{ sub: username, sid }`. `requireAuth` looks up `sid`, decrypts, and attaches `{ username, password }` to `req.user` for downstream handlers. The cookie remains the only thing on the client; the password never leaves the server.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `tsx` (already pinned) | TS dev runner | No change. |
| `typescript ^5.4.2` (already pinned) | Type checker | No change. New types: `EncryptedSessionRow`, extended `AuthedRequest['user']`. |

## Installation

**Nothing to install.** All required functionality is already in `package.json` plus Node's standard library.

```bash
# (No-op — confirming the existing install is sufficient)
cd kinetica_bi/server && npm install
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Encrypted server-side row + JWT(`{sub, sid}`) | **JWE via `jose` (latest `6.2.3`, published 2026-04-27, maintained by `panva`)** | If the team wanted a stateless, client-bound encrypted token (no server table). Reasonable, but adds a 1st-class dep where `node:crypto` already covers the need, and complicates the existing `jsonwebtoken` wiring (would have to migrate sign/verify to `jose` or run two JOSE libraries side-by-side). Choose if you anticipate horizontal scale-out and want zero session affinity — not the case for this single-process Express server backed by a local SQLite file. |
| Encrypted server-side row | **`iron-session` `8.0.4` (last publish 2024-11-12, stable but no release in ~17 months)** | If this were a Next.js app, `iron-session` is the canonical Vercel-ecosystem pick. For Express it is supported but second-class, and would replace (not augment) the existing `jsonwebtoken` cookie. Skip. |
| Encrypted server-side row | **`@hapi/iron` `7.0.1` (current, published 2026-04-07, NOT deprecated)** | The lower-level primitive `iron-session` wraps. Useful if you want "sealed token" symmetric-encrypted cookies without a server table — but the API is older-feeling and the code we'd write around `node:crypto` AES-GCM is shorter than the code we'd write around Iron's seal/unseal contract. Skip. |
| Encrypted server-side row | **`express-session` `1.19.0` + a SQLite store** | Idiomatic for Express, but it would replace the JWT cookie pattern that already shipped this session. Also, the two SQLite-backed stores for `better-sqlite3` (`connect-better-sqlite3@0.1.8`, last publish 2022-04-27; `better-sqlite3-session-store@0.1.0`, last publish 2022-06-25) are unmaintained pre-1.0 hobby packages. The maintained `connect-sqlite3@0.9.16` uses node-sqlite3, not `better-sqlite3`, and would force a second SQLite driver into the process. None of these earn their keep. Skip. |
| Storing the encrypted password server-side | **Putting the credentials in the JWS payload directly** | Never. JWS is signed but not encrypted — the cookie is httpOnly to the browser, but anyone with read access to the cookie value (logs, debug tools, an XSS that lands inside another httpOnly bypass, an inadvertent dump) gets a base64-decodable `username:password`. Hard reject. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Putting the Kinetica password in the JWS (`jsonwebtoken`) payload | JWS is signed, not encrypted. The payload is base64url-decodable by anyone holding the cookie value. Even though the cookie is httpOnly, treating credentials as "private because httpOnly" is an availability-of-attack-surface bet, not a confidentiality guarantee. | Server-side encrypted row keyed by a `sid` claim in the JWT. The cookie remains an opaque session pointer. |
| `connect-better-sqlite3` (`0.1.8`, 2022-04-27) | Unmaintained, pre-1.0, no releases in ~4 years. Adopting it now means inheriting a dependency that will rot. | If session-store middleware is ever wanted, hand-roll a tiny `Store` against `better-sqlite3` directly (~30 lines) — but the recommendation above avoids `express-session` entirely. |
| `better-sqlite3-session-store` (`0.1.0`, 2022-06-25) | Same diagnosis: unmaintained, pre-1.0, no releases in ~4 years. | Same as above. |
| `connect-sqlite3` (`0.9.16`) | Maintained, but built on `sqlite3` (callback-based, native binding distinct from `better-sqlite3`). Adopting it would put two SQLite drivers in the process. | Stay with `better-sqlite3` and own a `sessions` table directly. |
| `iron-session` for an Express app | Targets Next.js / Web-Fetch handlers; the Express adapter exists but is not where the library invests. Last publish 2024-11-12 — stable but slow. Would also displace `jsonwebtoken`. | `node:crypto` AES-256-GCM + the existing `jsonwebtoken` cookie. |
| Adding `jose` purely to get JWE | A real option, but it is a new top-level dep where Node's stdlib already does the job for this use case. Also creates two JWT libraries (`jsonwebtoken` + `jose`) unless the team migrates fully — out of scope for v1.0. | `node:crypto` AES-256-GCM. Revisit `jose` in a later milestone if/when the team wants a stateless encrypted token (e.g., before horizontal scale-out). |
| Replacing `jsonwebtoken` with `jose` for HS256 signing | `jsonwebtoken@9.0.3` is current (latest publish 2026-04-16) and already wired. Migration cost is real, benefit for this milestone is zero. | Keep `jsonwebtoken`. |
| Replacing the JWT cookie with `express-session` | Shipped JWT pattern already passes the auth bootstrap, logout, and 401 → re-login event flow on the frontend. Swapping middlewares mid-milestone burns scope on a refactor that buys nothing the encrypted-row approach doesn't already give us. | Keep the JWT cookie; add `sid` to the payload. |

## Stack Patterns by Variant

**If the deployment ever moves to multiple Express processes behind a load balancer:**
- Sessions table is already shared (single `better-sqlite3` file → SQLite is single-writer; multi-process Node will need WAL mode or a migration to Postgres).
- Reconsider JWE (`jose`) at that point so sessions go fully stateless and the SQLite contention disappears. Until then, server-side row is simpler and faster.

**If the team later wants a "sliding session" (refresh on activity):**
- Touch `sessions.expires_at` on each authenticated request, re-issue the JWT cookie with a new `exp`, and let the GC sweep stale rows. Easy with the recommended row-based design; awkward with pure JWE.

**If the auditor ever asks "where do we store the Kinetica password?":**
- Answer: encrypted at rest in `kinetica.db`, key derived from `AUTH_SECRET` via HKDF, AES-256-GCM, fresh 96-bit nonce per row, 128-bit auth tag. The plaintext lives only in process memory between `decrypt(req.user.sid)` and the `fetch()` of the downstream Kinetica call. Cleared on logout.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `jsonwebtoken@^9.0.3` | `cookie-parser@^1.4.7`, `express@^4.19.2` | Already proven in `auth.ts`. Adding an `sid` claim to the payload is a no-op for compat. |
| `better-sqlite3@^12.8.0` | Node ≥ 20 (engines field of 12.x) | Already in use; the runtime is Node 24.14.1 in this checkout. New `sessions` table is one `db.exec(CREATE TABLE …)` call. |
| `node:crypto` AES-256-GCM | Node ≥ 16 (LTS); verified working on Node 24.14.1 | Built-in, no version drift risk. |
| `AUTH_SECRET` | min 16 chars enforced by `auth.ts` | For HKDF-derived AES-256 keys, 32 bytes (`openssl rand -hex 32` → 64 hex chars) is the right ask in `.env.example`. The current placeholder satisfies this. No change needed beyond the comment. |

## Confidence Assessment

| Claim | Confidence | Source |
|-------|------------|--------|
| `jose@6.2.3` is current and JWE-capable | HIGH | `npm view jose version time.modified` — 2026-04-27 |
| `iron-session@8.0.4` last shipped 2024-11-12 | HIGH | `npm view iron-session version time.modified` |
| `@hapi/iron@7.0.1` is current and not deprecated | HIGH | `npm view @hapi/iron version time.modified deprecated` — empty deprecated, 2026-04-07 |
| `express-session@1.19.0` is current | HIGH | `npm view express-session version time.modified` |
| `connect-better-sqlite3` and `better-sqlite3-session-store` are unmaintained | HIGH | Both last published in 2022 per `npm view`; both pre-1.0 |
| `jsonwebtoken@9.0.3`, `express@5.2.1`, `better-sqlite3@12.9.0` are the current latest | HIGH | `npm view … version time.modified` |
| Node `crypto` AES-256-GCM works as described | HIGH | Direct runtime check on the working tree (Node 24.14.1) |
| Storing creds in JWS is ill-advised | HIGH | JWS spec (RFC 7515) — payload is base64url-encoded, not encrypted |
| Encrypted server-side row is "the right fit" for this app vs. JWE | MEDIUM-HIGH | Argued from the existing JWT pattern, single-process SQLite deployment, and the desire to minimize scope. Reasonable engineers could pick `jose` JWE; the recommendation prioritizes "smallest diff that ships v1.0." |

## Sources

- `npm view jose version time.modified description engines homepage repository dist-tags maintainers` — verified 2026-04-27 (HIGH)
- `npm view iron-session version time.modified description homepage repository keywords dist-tags versions` — verified 2026-04-27 (HIGH)
- `npm view @hapi/iron version time.modified description deprecated engines homepage repository versions` — verified 2026-04-27 (HIGH; not deprecated)
- `npm view express-session version time.modified description homepage repository peerDependencies` — verified 2026-04-27 (HIGH)
- `npm view connect-better-sqlite3 version time.modified description` — verified 2026-04-27 (HIGH; last 2022-04-27)
- `npm view better-sqlite3-session-store version time.modified description peerDependencies` — verified 2026-04-27 (HIGH; last 2022-06-25)
- `npm view connect-sqlite3 version time.modified description` — verified 2026-04-27 (HIGH; uses `sqlite3`, not `better-sqlite3`)
- `npm view jsonwebtoken|express|better-sqlite3|cookie-session version time.modified` — verified 2026-04-27 (HIGH)
- Node.js `crypto` `createCipheriv('aes-256-gcm', …)` — verified working on Node 24.14.1 in this repo (HIGH)
- Existing repo files: `kinetica_bi/server/package.json`, `kinetica_bi/server/src/auth.ts`, `kinetica_bi/server/src/index.ts`, `kinetica_bi/server/.env.example`, `.planning/PROJECT.md`, `.planning/STATE.md` (HIGH)

**Tool note:** Context7 MCP and WebFetch were both unavailable during this research session (Context7 not exposed as callable tool; WebFetch returned permission-denied for npmjs.com and GitHub). The npm registry was queried directly via `npm view`, which is the same source Context7 and the npm website both pull from. Where the recommendation involves judgment (e.g. "encrypted server-side row over JWE for *this* app"), I've labeled the confidence MEDIUM-HIGH and shown the reasoning so the planning phase can override it deliberately.

---
*Stack research for: per-user Kinetica credential passthrough in an Express 4 + JWT cookie BI server*
*Researched: 2026-04-27*
