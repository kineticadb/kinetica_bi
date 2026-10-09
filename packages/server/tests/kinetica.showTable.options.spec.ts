import { describe, it, expect, beforeEach, vi } from "vitest";
import { kineticaShowTable } from "../src/kinetica";
import type { AuthedRequest } from "../src/auth";

// ---------------------------------------------------------------------------
// Fake request builder — mirrors kinetica.sql.spec.ts's buildReq; does NOT
// require a live session row.
// ---------------------------------------------------------------------------
const buildReq = (
  username = "alice",
  password = "hunter2",
  requestId = "test-req-id-showtable-1"
): AuthedRequest =>
  ({
    user: {
      sub: username,
      sid: "x".repeat(64),
      creds: { username, password },
    },
    requestId,
  }) as unknown as AuthedRequest;

const ROUTE = "TEST /show/table";

// Happy-path body mirrors the real /show/table decoded shape (no
// json_encoded_response nesting — data_str IS the response, per kinetica.ts).
const happyBody = {
  status: "OK",
  data_str: JSON.stringify({ table_names: ["demo.nyctaxi"], type_schemas: [], properties: [] }),
};

const mockFetch = (status: number, body?: unknown) => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(body !== undefined ? JSON.stringify(body) : "", {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("kineticaShowTable — showOptions forwarding", () => {
  it("default call sends options: {} — byte-identical to the pre-122 body", async () => {
    const fetchMock = mockFetch(200, happyBody);
    const req = buildReq();
    await kineticaShowTable(req, "demo.nyctaxi", { route: ROUTE, op: "DISCOVERY" });
    const rawBody: string = fetchMock.mock.calls[0][1].body as string;
    const parsedBody = JSON.parse(rawBody);
    expect(parsedBody).toEqual({ table_name: "demo.nyctaxi", options: {} });
  });

  it("forwards showOptions into the /show/table request body", async () => {
    const fetchMock = mockFetch(200, happyBody);
    const req = buildReq();
    await kineticaShowTable(req, "demo.__schema_spike_missing_table__", {
      route: ROUTE,
      op: "DISCOVERY",
      showOptions: { no_error_if_not_exists: "true" },
    });
    const rawBody: string = fetchMock.mock.calls[0][1].body as string;
    const parsedBody = JSON.parse(rawBody);
    expect(parsedBody.options).toEqual({ no_error_if_not_exists: "true" });
  });

  it("showOptions does not leak into table_name or any other body field", async () => {
    const fetchMock = mockFetch(200, happyBody);
    const req = buildReq();
    await kineticaShowTable(req, "demo.nyctaxi", {
      route: ROUTE,
      op: "DISCOVERY",
      showOptions: { no_error_if_not_exists: "true" },
    });
    const rawBody: string = fetchMock.mock.calls[0][1].body as string;
    const parsedBody = JSON.parse(rawBody);
    expect(Object.keys(parsedBody).sort()).toEqual(["options", "table_name"]);
    expect(parsedBody.table_name).toBe("demo.nyctaxi");
  });
});
