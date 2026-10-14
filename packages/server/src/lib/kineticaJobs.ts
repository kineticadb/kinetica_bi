// Best-effort cancel of Kinetica jobs by SQL-comment tag. Aborting an /execute/sql HTTP request does NOT stop the
// job (133 S7.6): tag the statement, find it in /admin/show/jobs query_text, cancel via /admin/alter/jobs.
// This module imports only TYPES from kinetica.ts (kinetica.ts imports tagSql from here), so there is no runtime
// import cycle; the small auth-header builder is therefore local.
import type { KineticaPrincipal } from "../kinetica";

export const AI_JOB_TAG_PREFIX = "kbi-ai:";

export function tagSql(sql: string, tag: string): string {
  return `/* ${AI_JOB_TAG_PREFIX}${tag} */ ${sql}`;
}

const authHeader = (p: KineticaPrincipal): string => {
  const { credentialType, creds } = p.user!;
  if (credentialType === "oidc") return `Bearer ${creds.token}`;
  return `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString("base64")}`;
};

async function adminPost(p: KineticaPrincipal, path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${process.env.KINETICA_URL!.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader(p) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const env = (await res.json()) as { status?: string; data_str?: unknown };
  if (env?.status === "ERROR") throw new Error("kinetica error");
  const d = typeof env.data_str === "string" ? JSON.parse(env.data_str) : env.data_str;
  return (d ?? {}) as Record<string, unknown>;
}

export async function cancelKineticaJobsByTag(principal: KineticaPrincipal, tag: string): Promise<{ cancelled: unknown[] }> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(tag)) return { cancelled: [] };
  try {
    const jobs = await adminPost(principal, "/admin/show/jobs", { options: {} });
    const ids = Array.isArray(jobs.job_id) ? (jobs.job_id as unknown[]) : [];
    const texts = Array.isArray(jobs.query_text) ? (jobs.query_text as unknown[]) : [];
    const needle = `/* ${AI_JOB_TAG_PREFIX}${tag} */`;
    const match = ids.filter((_, i) => typeof texts[i] === "string" && (texts[i] as string).includes(needle));
    if (match.length === 0) return { cancelled: [] };
    await adminPost(principal, "/admin/alter/jobs", { job_ids: match, action: "cancel", options: {} });
    return { cancelled: match };
  } catch {
    console.warn("[ai] job cancel failed");
    return { cancelled: [] };
  }
}
