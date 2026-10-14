// 137 (D-01 / D-20): starter questions and fallback follow-ups built locally from the dashboard's
// table columns. Pure: no network, no store (no AI quota used).
import { isAiNumericColumnType } from "@kinetica-bi/shared";

export type StarterTable = { id: number; schema: string; name: string; columns: Record<string, string> };

const LAT = /^(lat|latitude)$|_lat(itude)?$|^lat_/i;
const LON = /^(lon|lng|long|longitude)$|_(lon|lng|long|longitude)$|^(lon|lng)_/i;
const ID_LIKE = /^id$|_id$/i;
const TEXT_TYPE = /^(string|char|varchar|text)/i;
const TIME = /timestamp|datetime|date/i;
const MAX_TABLES = 3;
const MAX_COLUMNS = 40;
const MAX_RESULTS = 3;

function candidatesFor(table: StarterTable): string[] {
  const cols = Object.entries(table.columns).slice(0, MAX_COLUMNS);
  const isGeo = (n: string) => LAT.test(n) || LON.test(n);
  const numeric = cols.find(([n, t]) => isAiNumericColumnType(t) === true && !isGeo(n) && !ID_LIKE.test(n))?.[0];
  const category = cols.find(([n, t]) => TEXT_TYPE.test(t) && !isGeo(n))?.[0];
  const hasLat = cols.some(([n]) => LAT.test(n));
  const hasLon = cols.some(([n]) => LON.test(n));
  const hasTime = cols.some(([, t]) => TIME.test(t));
  const out: string[] = [];
  if (numeric && category) out.push(`Show total ${numeric} by ${category}`);
  if (hasLat && hasLon) out.push(`Add a heatmap of ${table.name}`);
  if (numeric && hasTime) out.push(`Show ${numeric} over time`);
  if (category) out.push(`Show the number of ${table.name} records by ${category}`);
  return out;
}

function allCandidates(tables: readonly StarterTable[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tables.slice(0, MAX_TABLES)) {
    for (const q of candidatesFor(t)) {
      if (!seen.has(q)) {
        seen.add(q);
        out.push(q);
      }
    }
  }
  return out;
}

export function buildStarterQuestions(tables: readonly StarterTable[]): string[] {
  return allCandidates(tables).slice(0, MAX_RESULTS);
}

export function buildTemplateFollowUps(tables: readonly StarterTable[], askedQuestion: string): string[] {
  const asked = askedQuestion.trim();
  // "the other starters": drawn from the starter set itself, minus the asked question.
  return buildStarterQuestions(tables).filter((q) => q !== asked);
}
