// Phase 133 (AISAFE-V20-01, SSYNC-F6): PURE module — zero express/db/kinetica imports. Identifier trust is EARNED by membership in the registered snapshot, never assumed. See 133-COLUMN-AUDIT.md.

export const SQL_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export abstract class ColumnGuardError extends Error {
  abstract toBody(): Record<string, unknown>;
}

export class UnknownColumnError extends ColumnGuardError {
  readonly column: string;
  readonly table: string;
  constructor(column: string, table: string) {
    super(`Column "${column}" no longer exists on ${table}`);
    this.name = "UnknownColumnError";
    this.column = column;
    this.table = table;
  }
  toBody(): Record<string, unknown> {
    return {
      error: this.message,
      code: "UNKNOWN_COLUMN",
      column: this.column,
      table: this.table,
      hint: "If the column was added or renamed recently, apply Schema Sync for this table.",
    };
  }
}

export class InvalidIdentifierError extends ColumnGuardError {
  readonly field: string;
  readonly value: string;
  constructor(field: string, value: string) {
    super(`Invalid ${field}: "${value.slice(0, 64)}" is not a valid SQL identifier`);
    this.name = "InvalidIdentifierError";
    this.field = field;
    this.value = value;
  }
  toBody(): Record<string, unknown> {
    return { error: this.message, code: "INVALID_IDENTIFIER", field: this.field };
  }
}

export function tableLabel(t: { schema?: string | null; name: string }): string {
  return t.schema ? `${t.schema}.${t.name}` : t.name;
}

/** Throws UnknownColumnError for the FIRST column not in the snapshot (exact, case-sensitive match). */
export function assertColumnsExist(
  snapshot: Readonly<Record<string, string>> | readonly string[],
  columns: readonly unknown[],
  table: string,
): void {
  const has = Array.isArray(snapshot)
    ? (c: string) => (snapshot as readonly string[]).includes(c)
    : (c: string) => Object.prototype.hasOwnProperty.call(snapshot, c);
  for (const c of columns) {
    if (typeof c !== "string" || !has(c)) throw new UnknownColumnError(String(c), table);
  }
}

export function assertIdentifier(
  value: unknown,
  field: string,
  opts?: { allowEmpty?: boolean },
): void {
  const ok =
    typeof value === "string" &&
    (value === "" ? opts?.allowEmpty === true : SQL_IDENT_RE.test(value));
  if (!ok) throw new InvalidIdentifierError(field, String(value));
}
