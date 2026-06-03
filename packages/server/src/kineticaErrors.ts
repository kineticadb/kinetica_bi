/**
 * Typed error classes thrown by the kinetica.ts helper module.
 *
 * - KineticaAuthError:       Kinetica returned HTTP 401 (creds invalid / rotated)
 * - KineticaPermissionError: Kinetica returned HTTP 403, or HTTP 400 with a
 *                             body.message matching /access denied|permission/i
 *                             (Kinetica DDL-denial signals via 400 — see SPIKE.md)
 * - KineticaUpstreamError:   Any other failure: 5xx, network throw, body.status==="ERROR"
 *                             with no auth/permission signal, malformed response
 *
 * The `status` property is FIXED per class and reflects the HTTP status the Phase 3
 * global error middleware will eventually map to for the client.
 * The `upstreamStatus` property carries what Kinetica actually returned (undefined for
 * network throws / non-HTTP failures).
 */

export class KineticaAuthError extends Error {
  readonly status = 401 as const;
  readonly upstreamStatus: number;

  constructor(message: string, upstreamStatus: number) {
    super(message);
    this.name = "KineticaAuthError";
    this.upstreamStatus = upstreamStatus;
    // Restore prototype chain (required when extending built-ins in TypeScript)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class KineticaPermissionError extends Error {
  readonly status = 403 as const;
  readonly upstreamStatus: number;

  constructor(message: string, upstreamStatus: number) {
    super(message);
    this.name = "KineticaPermissionError";
    this.upstreamStatus = upstreamStatus;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class KineticaUpstreamError extends Error {
  readonly status = 502 as const;
  readonly upstreamStatus?: number;

  constructor(message: string, upstreamStatus?: number) {
    super(message);
    this.name = "KineticaUpstreamError";
    this.upstreamStatus = upstreamStatus;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
