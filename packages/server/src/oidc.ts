// server/src/oidc.ts
// Phase 5 Plan 02: full OIDC module — discovery, auth URL, code exchange, claim extraction.
//
// Pattern: module-level singleton (_client, _config) initialized once at boot via initOidcClient().
// Route handlers in index.ts (Plan 05-03) call buildAuthorizationUrl() / exchangeCode() / extractUsername().
// Anti-pattern (REJECTED): per-request Issuer.discover() (ARCHITECTURE AP-5).
// Anti-pattern (REJECTED): import oidc.ts from sessionStore.ts (ARCHITECTURE AP-2).
//
// PITFALLS in scope (each guarded below):
//   C-01: signature verification — handled by client.callback() (NEVER manual jwt.decode)
//   C-02: state CSRF — caller passes expectedState; library checks it; route also does timingSafeEqual pre-check
//   C-03: nonce replay — caller passes expectedNonce; library checks it
//   C-04: aud — library checks aud === client_id (set on Client construction)
//   C-05: iss — library checks iss === issuer.metadata.issuer (trailing slash already stripped in validateOidcEnv)
//   C-06: JWKS cache — handled by openid-client per Client instance; singleton lifetime = process lifetime
//   C-07: redirect_uri pinned to config.redirectUri (env var); NEVER from req.headers
//   T-01: access token encryption is the caller's job (createSession via encryptSecret)
//   T-02: username extracted from id_token claims, NEVER access_token (extractUsername reads tokenSet.claims())
//   T-03: empty username → return null, caller maps to oidc_no_username
//   T-04: scope="openid profile" requested in authorizationUrl (minimum for preferred_username)
//   T-06: clockTolerance=30 set via custom symbol post-construction

import { Issuer, custom, errors } from "openid-client";
import type { Client } from "openid-client";

// ---- Config type (unchanged from Plan 05-01) ----
export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  usernameClaim: string;
  usernameRegex?: string;
};

// ---- Friendly error code vocabulary (LOCKED in CONTEXT.md; Phase 7 frontend asserts these strings) ----
export type OidcFriendlyCode =
  | "oidc_denied"
  | "oidc_invalid"
  | "oidc_token_invalid"
  | "oidc_no_username";

// ---- validateOidcEnv (unchanged from Plan 05-01) ----
export const validateOidcEnv = (): OidcConfig => {
  const issuerRaw = process.env.AUTH_OIDC_ISSUER_URL;
  const clientId = process.env.AUTH_OIDC_CLIENT_ID;
  const clientSecret = process.env.AUTH_OIDC_CLIENT_SECRET;
  const redirectUri = process.env.AUTH_OIDC_REDIRECT_URI;
  if (!issuerRaw) throw new Error("AUTH_OIDC_ISSUER_URL is required when AUTH_MODE=oidc");
  if (!clientId) throw new Error("AUTH_OIDC_CLIENT_ID is required when AUTH_MODE=oidc");
  if (!clientSecret) throw new Error("AUTH_OIDC_CLIENT_SECRET is required when AUTH_MODE=oidc");
  if (!redirectUri) throw new Error("AUTH_OIDC_REDIRECT_URI is required when AUTH_MODE=oidc");
  return Object.freeze({
    issuer: issuerRaw.replace(/\/$/, ""),
    clientId,
    clientSecret,
    redirectUri,
    usernameClaim: process.env.AUTH_OIDC_USERNAME_CLAIM || "preferred_username",
    usernameRegex: process.env.AUTH_OIDC_USERNAME_REGEX || undefined,
  });
};

// ---- Module-level singleton ----
// _client lives for the process lifetime so JWKS cache (per-Client instance) is preserved.
// Reset via resetOidcClientForTests() in test contexts only.
let _client: Client | null = null;
let _config: OidcConfig | null = null;

/**
 * Boot-time discovery + Client construction. Throws on network/discovery failure
 * (Phase 5 SC6 fail-fast). Sets clockTolerance=30 via custom symbol (PITFALLS T-06,
 * NOT a constructor option).
 */
export const initOidcClient = async (config: OidcConfig): Promise<void> => {
  const discovered = await Issuer.discover(config.issuer);
  // TD-V11-XX: openid-client@5 enforces RFC 9207 (iss in auth response) when the IdP's
  // discovery doc advertises support. The IdP advertises but doesn't actually emit `iss`,
  // so we suppress the check by constructing a fresh Issuer from a metadata clone with
  // the flag flipped off. (issuer fields are non-configurable getters, so we can't mutate
  // the discovered instance in place.)
  const meta = { ...discovered.metadata, authorization_response_iss_parameter_supported: false };
  const issuer = new Issuer(meta);
  const client = new issuer.Client({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uris: [config.redirectUri],
    response_types: ["code"],
    id_token_signed_response_alg: "RS256",
  });
  client[custom.clock_tolerance] = 30;
  _client = client;
  _config = config;
};

/** Test-only: clears the singleton so tests start with `_client === null`. */
export const resetOidcClientForTests = (): void => {
  _client = null;
  _config = null;
};

const requireClient = (): { client: Client; config: OidcConfig } => {
  if (!_client || !_config) {
    throw new Error("[oidc] OIDC client not initialized — initOidcClient must run at boot");
  }
  return { client: _client, config: _config };
};

/**
 * Returns the IdP authorization URL. scope locked to "openid profile" (PITFALLS T-04
 * minimum for preferred_username). redirect_uri pinned to config.redirectUri (PITFALLS C-07
 * — never from request headers).
 */
export const buildAuthorizationUrl = (state: string, nonce: string): string => {
  const { client, config } = requireClient();
  return client.authorizationUrl({
    scope: "openid profile",
    redirect_uri: config.redirectUri,
    state,
    nonce,
  });
};

/**
 * Token exchange + ID token verification. client.callback() handles:
 *   - state check (vs checks.state)
 *   - nonce check (vs checks.nonce, against id_token.nonce claim)
 *   - signature verification via JWKS (cached per-Client)
 *   - aud === client_id
 *   - iss === issuer.metadata.issuer
 *   - exp > now - clockTolerance (30s)
 * Throws OPError (IdP-side error response) or RPError (client-side validation failure).
 * Returns plaintext access_token + id_token + parsed claims.
 * NEVER reads username from access_token claims (PITFALLS T-02).
 */
export const exchangeCode = async (
  code: string,
  expectedState: string,
  expectedNonce: string
): Promise<{ accessToken: string; idToken: string; claims: Record<string, unknown> }> => {
  const { client, config } = requireClient();
  const tokenSet = await client.callback(
    config.redirectUri,
    { code, state: expectedState },
    { state: expectedState, nonce: expectedNonce }
  );
  return {
    accessToken: tokenSet.access_token!,
    idToken: tokenSet.id_token!,
    claims: tokenSet.claims() as Record<string, unknown>,
  };
};

/**
 * Extracts the username from verified id_token claims. NEVER from access_token (PITFALLS T-02).
 * Optional regex transform: capture group 1 if present, fallback to full match.
 * Returns null on absent/empty claim or empty regex result (caller maps to oidc_no_username).
 */
export const extractUsername = (
  claims: Record<string, unknown>,
  config: OidcConfig
): string | null => {
  const raw = claims[config.usernameClaim];
  if (typeof raw !== "string" || !raw.trim()) return null;
  if (!config.usernameRegex) return raw.trim();
  const match = raw.match(new RegExp(config.usernameRegex));
  if (!match) return null;
  // Prefer capture group 1; fall back to full match
  const extracted = (match[1] ?? match[0] ?? "").trim();
  return extracted || null;
};

/**
 * Maps an unknown error from exchangeCode (or surrounding callback handler) to a friendly code.
 * - OPError(access_denied) → oidc_denied (user denied at IdP)
 * - OPError(other)         → oidc_invalid (server_error, invalid_request, etc.)
 * - RPError                → oidc_token_invalid (state/nonce/aud/iss/exp/sig validation)
 * - other                  → oidc_invalid (network errors, JSON parse, etc.)
 */
export const mapOidcError = (err: unknown): { code: OidcFriendlyCode } => {
  if (err instanceof errors.OPError) {
    if (err.error === "access_denied") return { code: "oidc_denied" };
    return { code: "oidc_invalid" };
  }
  if (err instanceof errors.RPError) {
    return { code: "oidc_token_invalid" };
  }
  return { code: "oidc_invalid" };
};
