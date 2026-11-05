import type { Response } from "express";
import {
  DASHBOARD_VERSION_HEADER,
  DASHBOARD_VERSION_READ_HEADER,
  formatVersionWriteHeader,
  formatVersionReadHeader,
  type DashboardVersionList,
} from "@kinetica-bi/shared";
import { getDashboardVersion } from "../db";
import type { AuthedRequest } from "../auth";
import { noteMcpOwnWrite } from "./mcp/mcpSessions";

/** 141 D-17: run a SYNCHRONOUS db write and report the dashboard's version before/after it (nothing can interleave: better-sqlite3 is sync). Never wrap an await. */
export function stampWrite<T>(res: Response, dashboardId: number | undefined, fn: () => T): T {
  const before = dashboardId === undefined ? undefined : getDashboardVersion(dashboardId);
  const out = fn();
  const after = dashboardId === undefined ? undefined : getDashboardVersion(dashboardId);
  if (dashboardId !== undefined && before !== undefined && after !== undefined) {
    res.setHeader(DASHBOARD_VERSION_HEADER, formatVersionWriteHeader(dashboardId, before, after));
    const username = (res.req as AuthedRequest | undefined)?.user?.creds?.username;
    if (username) noteMcpOwnWrite(dashboardId, username, before, after);
  }
  return out;
}

/** 141 D-07: call in the same synchronous tick as the list read. */
export function stampRead(res: Response, dashboardId: number, list: DashboardVersionList): void {
  const v = getDashboardVersion(dashboardId);
  if (v !== undefined) res.setHeader(DASHBOARD_VERSION_READ_HEADER, formatVersionReadHeader(dashboardId, list, v));
}
