# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## records-table-column-headers — Records Table shows column_1/column_2 instead of real column names
- **Date:** 2026-04-28
- **Error patterns:** column_1, column_2, column_3, positional keys, column_headers, records table, widget headers, parseKineticaResponse
- **Root cause:** Kinetica always returns positional keys (column_1, column_2, ...) in json_encoded_response regardless of the SELECT clause. Real names are always in a sibling column_headers array in the same decoded object. parseKineticaResponse used Object.keys(columnar) which produced the positional keys as row property names instead of remapping via column_headers.
- **Fix:** In parseKineticaResponse (WidgetRenderer.tsx), filter out metadata keys (column_headers, column_datatypes), build a keyToName map from column_headers[idx] for each positional data key, and use real names when constructing row objects. Also removed the INFORMATION_SCHEMA discovery effect from RecordsTableRenderer — it was redundant and doubly broken (Kinetica still returns positional keys even with an explicit SELECT list, and the discovery parser accessed r.COLUMN_NAME which was undefined because the row key was column_1 before remapping).
- **Files changed:** kinetica_bi/src/components/charts/WidgetRenderer.tsx
---

