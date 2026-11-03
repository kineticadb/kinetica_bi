// kbi-mcp: a tiny Kinetica BI REST client. Signs in with the user's personal access token (Phase 143, KBI_TOKEN), or
// with a username and password when no token is set, and keeps the session cookie; one re-login on a 401 (the server
// drops sessions when it restarts). Never logs credentials, tokens or cookies.

export type KbiResponse = { status: number; body: unknown };
export type KbiCredentials = { token?: string; username?: string; password?: string };

export class KbiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "KbiError";
    this.status = status;
  }
}

const messageOf = (body: unknown, fallback: string): string => {
  if (body && typeof body === "object") {
    const b = body as { error?: unknown; message?: unknown };
    if (typeof b.error === "string") return b.error;
    if (typeof b.message === "string") return b.message;
  }
  return fallback;
};

export class KbiClient {
  private cookie: string | undefined;

  constructor(
    private readonly baseUrl: string,
    private readonly credentials: KbiCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }

  async login(): Promise<void> {
    const { token, username, password } = this.credentials;
    if (!token && !(username && password)) {
      throw new KbiError(401, "Set KBI_TOKEN in the MCP server's env (create one in Kinetica BI: your user menu, Connect Claude Desktop).");
    }
    const [path, payload] = token ? ["/api/mcp/token-login", { token }] : ["/api/auth/login", { username, password }];
    const res = await this.fetchImpl(this.url(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new KbiError(res.status, `Kinetica BI sign-in failed: ${messageOf(body, `HTTP ${res.status}`)}`);
    const session = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("kbi_session="));
    if (!session) throw new KbiError(500, "Kinetica BI sign-in returned no session cookie.");
    this.cookie = session;
  }

  /** JSON request as the signed-in user; throws KbiError with the server's message on a non-2xx. */
  async request(method: string, path: string, body?: unknown): Promise<KbiResponse> {
    if (!this.cookie) await this.login();
    let res = await this.send(method, path, body);
    if (res.status === 401) {
      await this.login();
      res = await this.send(method, path, body);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new KbiError(res.status, messageOf(json, `HTTP ${res.status}`));
    return { status: res.status, body: json };
  }

  private send(method: string, path: string, body?: unknown): Promise<Response> {
    return this.fetchImpl(this.url(path), {
      method,
      headers: { Cookie: this.cookie ?? "", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }
}
