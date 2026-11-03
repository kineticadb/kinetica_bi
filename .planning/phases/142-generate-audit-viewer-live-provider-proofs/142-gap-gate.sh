#!/usr/bin/env bash
# Phase 142 step-0 gap gate (142-10 Task 1). Exit 0 = PASS. Prints the reason on failure.
# Run from anywhere: bash .planning/phases/142-generate-audit-viewer-live-provider-proofs/142-gap-gate.sh
set -u
cd "$(dirname "$0")/../../.." || exit 2
D=.planning/phases/142-generate-audit-viewer-live-provider-proofs
fail=0

# 1. No parked or skipped proofs in code (web specs live under packages/web/src).
#    The seven allow-listed lines pre-date Phase 142 (verified at plan time, 2026-10-23, same seven as 141):
#    a comment, one it.skip, and five environment-gated skipIf (spikes / nginx / python / unzip / macOS ditto).
R='\b(it|test)\.(fails|skip|todo)\b|\b(it|test|describe)\.(skipIf|runIf)\(|\.concurrent\.(skip|todo)\b|\bxit\(|\bdescribe\.(skip|todo)\b|GAP-142-'
hits=$(grep -rnE "$R" packages/*/src packages/*/tests 2>/dev/null \
  | grep -vE 'errorMiddleware\.spec\.ts:[0-9]+: \* Tests 1-4 are it\.todo placeholders|bootstrap\.spec\.ts:[0-9]+:  it\.skip\("does NOT call app\.listen|s3Validators\.spike\.spec\.ts:[0-9]+:describe\.skipIf\(!process\.env\.RUN_SPIKES\)\("S3 per-type validators"|deploy\.nginxStream\.spec\.ts:[0-9]+:  it\.skipIf\(!hasNginx\)\("NGX-4:|lib\.zipStream\.spec\.ts:[0-9]+:    it\.skipIf\((!HAS_PY|!HAS_UNZIP|process\.platform !== "darwin")\)\("EXPZIP-(python|unzip-t|ditto)"')
if [ -n "$hits" ]; then echo "FAIL: parked/skipped proofs:"; echo "$hits"; fail=1; fi

# 2. All 9 implementation SUMMARYs (142-01..09) exist and each has exactly one gaps line, and it is empty.
for n in 01 02 03 04 05 06 07 08 09; do
  f="$D/142-$n-SUMMARY.md"
  if [ ! -f "$f" ]; then echo "FAIL: missing $f"; fail=1; continue; fi
  c=$(grep -c '^gaps:' "$f")
  if [ "$c" -ne 1 ]; then echo "FAIL: $f has $c '^gaps:' lines (need exactly 1)"; fail=1; continue; fi
  g=$(grep '^gaps:' "$f")
  if [ "$g" != "gaps: []" ]; then echo "FAIL: $f -> $g"; fail=1; fi
done

if [ "$fail" -eq 0 ]; then echo "GAP GATE: PASS"; else echo "GAP GATE: FAIL"; fi
exit "$fail"
