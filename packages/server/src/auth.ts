import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import {
  getSession,
  touchSession,
  deleteSession,
  type SessionRow,
} from "./sessionStore";

const COOKIE_NAME = "kbi_session";
const TOKEN_TTL_SECONDS = 60 * 60 * 8; // 8 hours

export type SessionPayload = {
  sub: string;
  sid: string;
  v: 1;
};

// AuthedRequest.user shape — flat per ARCHITECTURE.md "requireAuth Changes":
//   - credentialType lives at the TOP LEVEL of `user`, not inside `creds`
//   - creds always contains BOTH password AND token (mutually empty strings, never undefined)
//   - rationale: avoids null-guard noise in helper consumers (Phase 6 buildAuthHeader)
// PITFALLS I-05: this discriminant lives in the SESSION ROW, never in the JWT cookie payload.
// The cookie's v: 1 field is unchanged (see decodeAndVerifyJwt below).
export type AuthedRequest = Request & {
  requestId?: string; // populated for every request that passes requireAuth (set via crypto.randomUUID())
  user?: {
    sub: string;
    sid: string;
    credentialType: "password" | "oidc";
    creds: {
      username: string;
      password: string;   // populated in password mode; empty string in oidc mode
      token: string;      // populated in oidc mode; empty string in password mode
    };
  };
};

const getSecret = (): string => {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "AUTH_SECRET must be set to a string of at least 16 characters."
    );
  }
  return secret;
};

export const verifyKineticaCredentials = async (
  username: string,
  password: string
): Promise<{ ok: true } | { ok: false; status: number; message: string }> => {
  const kineticaUrl = process.env.KINETICA_URL;
  if (!kineticaUrl) {
    return { ok: false, status: 500, message: "KINETICA_URL is not configured." };
  }

  try {
    const response = await fetch(`${kineticaUrl.replace(/\/$/, "")}/execute/sql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
      },
      body: JSON.stringify({
        statement: "SELECT 1",
        offset: 0,
        limit: 1,
        encoding: "json",
        request_schema_str: "",
        data: [],
        options: {}
      })
    });

    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: 401, message: "Invalid Kinetica credentials." };
    }
    if (!response.ok) {
      return { ok: false, status: 502, message: `Kinetica returned ${response.status}` };
    }

    const body = await response.json().catch(() => ({}));
    if (body?.status === "ERROR") {
      const msg: string = body.message || "Kinetica rejected the credential check.";
      const looksAuth = /auth|credential|login|password/i.test(msg);
      return { ok: false, status: looksAuth ? 401 : 502, message: msg };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, status: 502, message: `Failed to reach Kinetica: ${String(error)}` };
  }
};

export const issueSessionCookie = (
  res: Response,
  username: string,
  sid: string
): void => {
  const payload: SessionPayload = { sub: username, sid, v: 1 };
  const token = jwt.sign(payload, getSecret(), { expiresIn: TOKEN_TTL_SECONDS });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TOKEN_TTL_SECONDS * 1000,
    path: "/",
  });
};

export const clearSessionCookie = (res: Response): void => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
};

export const decodeAndVerifyJwt = (req: Request): SessionPayload | null => {
  const token = (req as Request & { cookies?: Record<string, string> })
    .cookies?.[COOKIE_NAME];
  if (!token) return null;
  let decoded: jwt.JwtPayload | string;
  try {
    decoded = jwt.verify(token, getSecret());
  } catch {
    return null;
  }
  if (typeof decoded === "string") return null;
  // PITFALLS P4: check v BEFORE reading sid — old { sub } cookies decode with v: undefined.
  if (decoded.v !== 1) return null;
  if (typeof decoded.sid !== "string" || decoded.sid.length === 0) return null;
  if (typeof decoded.sub !== "string" || decoded.sub.length === 0) return null;
  return { sub: decoded.sub, sid: decoded.sid, v: 1 };
};

export const loadSessionForRequest = (
  req: Request
): { jwt: SessionPayload; session: SessionRow } | null => {
  const decoded = decodeAndVerifyJwt(req);
  if (!decoded) return null;
  const session = getSession(decoded.sid); // returns null if missing, expired (and deletes), or decrypt fails (and deletes)
  if (!session) return null;
  if (session.kineticaUrl !== process.env.KINETICA_URL) {
    // Operator-changed-KINETICA_URL defense — sessions stamped to old URL are dead.
    deleteSession(decoded.sid);
    return null;
  }
  return { jwt: decoded, session };
};

const REAUTH_RESPONSE = {
  error: "Authentication required.",
  code: "REAUTH_REQUIRED",
} as const;

export const requireAuth = (
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): void | Response => {
  const decoded = decodeAndVerifyJwt(req);
  if (!decoded) {
    // Steps 1-5: no cookie / bad sig / wrong v / missing sid / missing sub.
    // Do NOT clear cookie here — there's nothing valid to clear, and the user
    // may be in an honest "logged out" state (cookie expired naturally).
    return res.status(401).json(REAUTH_RESPONSE);
  }

  const session = getSession(decoded.sid);
  if (!session) {
    // Step 6: row missing (logout-then-replay, manual DELETE, or sweep race).
    // Also covers steps 7 (passive expiry) and 9 (decrypt failure) — getSession
    // handles both internally (returns null AND deletes the row).
    clearSessionCookie(res);
    return res.status(401).json(REAUTH_RESPONSE);
  }

  if (session.kineticaUrl !== process.env.KINETICA_URL) {
    // Step 8: operator changed KINETICA_URL mid-session.
    deleteSession(decoded.sid);
    clearSessionCookie(res);
    return res.status(401).json(REAUTH_RESPONSE);
  }

  // Step 10: success.
  // session.secret holds the password OR access token (Plan 04-02 unified the field name).
  // session.credentialType ('password' | 'oidc') drives which creds field gets the value.
  // creds.password and creds.token are BOTH always strings — empty in the inactive mode.
  req.user = {
    sub: session.username,
    sid: session.sid,
    credentialType: session.credentialType,
    creds: {
      username: session.username,
      password: session.credentialType === "password" ? session.secret : "",
      token:    session.credentialType === "oidc"     ? session.secret : "",
    },
  };
  req.requestId = randomUUID(); // fresh UUID per request — consumed by kinetica.ts audit log
  touchSession(session.sid); // last_used_at — NEVER expires_at
  return next();
};
