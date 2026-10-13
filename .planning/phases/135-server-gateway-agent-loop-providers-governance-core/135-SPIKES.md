# Phase 135 Spike Decision Record

**How to read:** one section per spike in the 133 D-15 template. S6 is the only Phase 135 research spike. The harness was built and unit-tested by the agent (plan 135-12 Task 1, then corrected red-first, see "Scoring correction"); the live run was done by the operator in their own shell with their own key. No agent ran it, saw a key, or called a real provider.

---

## S6 — Tool calling on Gemini / local model

**Question:** Does the production OpenAI-compatible adapter + the real tool JSON schemas + the gateway shape/allow-list/live-schema stages produce valid tool calls on a real model (Gemini via AI Studio's OpenAI-compatible endpoint; optionally a local Ollama model)? Which `AI_TOOL_MODE` (`native` | `json`) should be the documented default per model?

**Method:** `packages/server/src/spikes/toolCallSpike.ts` (`npm run tool-call-spike`; not part of the Express app; imports nothing from db/env/index/Express). It reads env via `parseAiConfig`, prints only `endpoint=<origin> model=<model> key=set|not set`, drives `createOpenAiCompatProvider` (+ `createJsonActionProvider` in json mode) with `buildToolRegistry({dataAccess:"schema"})` specs, `AI_SYSTEM_RULES`, and an inline synthetic `demo.nyctaxi`-style schema (no real data). Write tools go through the real `checkAiOp` stages with stub deps. Seven scenarios, R runs each: (1) list_tables, (2) describe_table typed args, (3) multi-step add bar chart, (4) parallel invite ("describe both tables"), (5) no-tool question, (6) multi-turn tool round-trip (step 2 after a tool result: catches thought-signature 400s), (7) malformed pressure (nested layout args). Self-paced to `--rpm`; 429s honoured and counted. Command shape (operator's shell, key entered with `read -s`, never on the command line or in chat):

```
cd packages/server
AI_ENABLED=true AI_PROVIDER=openai-compatible \
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/ \
AI_MODEL=gemini-3-flash-preview \
  npx tsx src/spikes/toolCallSpike.ts --runs 5 --rpm 6 --out ./s6-gemini.json --record ./s6-gemini-wire
```

### Runs

| Date | AI_MODEL | Result |
|---|---|---|
| 2026-10-12 | `Antigravity` | **INVALID RUN (operator error), no verdict.** `Antigravity` is Google's IDE product name, not a model ID; 35/35 requests returned HTTP 400 "unexpected model name format". Nothing about tool calling was measured. |
| 2026-10-13 | `gemini-3-flash-preview` | Scored below. 35 trials attempted, stream=true, mode=native. The free-tier DAILY quota ran out mid-run. |

### Results (2026-10-13, gemini-3-flash-preview, clean-trial basis)

The free tier's per-model daily cap tripped mid-run: HTTP 429 `RESOURCE_EXHAUSTED`, `quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier`, `quotaValue: "20"`, `retryDelay` ~29,900 s (about 8 h 18 min), with no `Retry-After` header (the delay is only in the body). All 15 429s were this daily cap, not the per-minute limit. In addition, one trial (run 1, scenario 1, the very first call) was `aborted` at the 60 s `AI_TIMEOUT_MS` default: Gemini 3's default (high) thinking on a cold first call took longer than 60 s.

These 16 trials never reached the model (or never got an answer back), so they are excluded from the quality figures. Reconstructed from the operator's sanitised wire captures (39 files) and `s6-gemini.json`:

| Metric | Value |
|---|---|
| Trials attempted / clean / excluded | 35 / **19** / 16 (`rate_limited` 15, `aborted` 1) |
| Tool calls in clean trials | 17, **100 % valid** (JSON-parsable, zod-valid, passed shape/allow-list), 0 % malformed |
| Text instead of tool (clean, tool-expected) | 0 / 16 |
| No-tool question (scenario 5) | 3 / 3 answered in text, no tool call |
| Wrong tool | 2 / 19: both clean scenario-4 trials ("describe both tables") called `list_tables` first instead of `describe_table`. The spike stops scenario 4 after one step, so a reasonable "look first" step counts as wrong-tool here |
| Parallel calls | 0 clean. The only parallel response (`describe_table` + `list_tables` in one turn, scenario 3 run 3) was in a trial a 429 cut off, so it is excluded. Parallel calls are possible but rare |
| Multi-turn round-trip (scenario 6) | **2 / 2 clean OK** (the other 3 runs hit the 429). Plus a clean scenario-3 describe → add_widget continuation |
| Bounce repair | not exercised (0 invalid calls) |
| Streamed `tool_calls[].index` | **absent** (indexPresent = no). The adapter already falls back to id/order keys (openaiCompat.ts) |
| Streamed `tool_calls[].id` | present |
| `extra_content.google.thought_signature` | seen on tool calls; replayed by the adapter; no 400 on any continuation |
| Argument fragmentation | none: whole arguments per chunk (fragmentedStreams = 0) |
| `usage` in stream | present on all 24 successful responses |
| Latency (all trials, as printed) | p50 10.0 s, p95 28.7 s (not split by clean/excluded) |
| 429 delay > 20 s | 15 / 15 |

Metrics excerpt from the operator's run (key-free; as printed by the original harness, before the scoring correction):

```json
{ "trials": 35, "calls": 20, "validCallPct": 100, "malformedPct": 0, "wrongToolPct": 5.7,
  "textInsteadOfToolPct": 40, "parallelPct": 11.1, "secondTurnRuns": 5, "secondTurnOk": 2,
  "latencyP50Ms": 10044, "latencyP95Ms": 28722, "indexPresent": "no", "idPresent": "yes", "extraContentSeen": true,
  "rateLimit": { "count": 15, "retryAfterHeaderCount": 0, "maxRetryDelayMs": 29921000, "over20sCount": 15 },
  "errors": { "aborted": 1, "rate_limited": 15 } }
```

**Scoring correction.** The harness as first committed (a3205d8) printed matrix row `fail (2/5)` for the second turn and verdict `json (best effort)`. That came from the scoring code, not the model: rate-limited and aborted trials were counted as model failures (no-call → "text instead of tool", 429 on step 2 → "second turn failed"). Fixed red-first in plan 135-12 (ed08c42 test, bb693c7 fix):
- Trials ending in a transport, quota or request error (`rate_limited`, `overloaded`, `network`, `timeout`, `aborted`, `auth`, `bad_request`) are left out of the validity, text-instead, second-turn and latency figures and reported as `excludedTrials`. `protocol` stays in, because it is a model/adapter failure. The 20-trial rule counts clean trials only.
- Fewer than 20 clean trials gives `inconclusive (N clean trials)`. If every trial is a request error, the verdict is `INVALID RUN (check AI_MODEL / AI_BASE_URL)`.
- The spike stops early after 3 consecutive 400s, or on a 429 whose quota id contains `PerDay` or whose retry delay is over 1 h. It still writes partial output. With this fix the 2026-10-12 run would have stopped after 3 requests with INVALID RUN, and the 2026-10-13 run would have stopped at the first daily-quota 429 instead of using up the remaining scenarios.

The 2026-10-13 run scored with the fix comes out as `inconclusive (19 clean trials)`, one clean trial short of the bar.

### Tested-models matrix

| provider | model | date | stream | tool valid% | malformed% | parallel% | 2nd-turn ok | index present | 429 delay>20s | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| gemini | gemini-3-flash-preview | 2026-10-13 | true | 100% | 0% | 0% | ok (2/2) | no | 15/15 | **native (provisional, operator decision)**. Spike: inconclusive (19 clean trials) |
| ollama | — | — | — | — | — | — | — | — | — | not run |

(Invalid run 2026-10-12, `AI_MODEL=Antigravity`: 35/35 HTTP 400. Operator error, no row, no verdict.)

**Decision:** **Gemini `gemini-3-flash-preview` = `AI_TOOL_MODE=native` (provisional).** The research rule asks for ≥ 90 % valid over ≥ 20 trials, ≤ 1 bounce repair and a passing multi-turn round-trip. Every clean measurement met it (100 % valid, 0 repairs needed, round-trip 2/2), but there were 19 clean trials, one short of 20, because the free-tier daily quota ran out. The operator accepted native provisionally. A re-run with ≥ 20 clean trials (a paid key, or across two quota days with `--runs 3`) would make it final. `AI_TOOL_MODE=json` stays the documented fallback. No other model is claimed: this does **not** mean "any OpenAI-compatible endpoint works". Ollama and local models are untested. The Claude adapter is unit-tested against doc-derived fixtures only and is NOT live-verified (no Anthropic key, AI-F11).

**Fallback:** `AI_TOOL_MODE=json` (json-action decorator, shipped in 135-05) for any model that fails the rule. The default stays `native`.

**Consequences for later phases:**
- **Free-tier capacity (136/137/142):** the Gemini free tier allowed **20 requests/day per model** for `gemini-3-flash-preview`. One AI ask uses several requests (one per tool step; scenario 3 needed 2), so a free-tier key gives only a handful of asks per day. Operators on a free key should set `AI_MAX_ANSWERS_PER_DAY`. The UI should show the daily-cap refusal clearly, not as a generic error.
- **429 vs the 20 s retry budget:** the daily-cap delay (~8 h) is far over the gateway's 20 s budget, so production surfaces `rate_limited` straight away with no wait, which is correct. The delay is only in the body's `RetryInfo.retryDelay` (no `Retry-After` header), and the body parser already handles that. A per-minute 429 was not observed.
- **Timeout:** Gemini 3 thinking models can exceed 60 s on a cold first call. Recommend `AI_TIMEOUT_MS ≥ 120000` for Gemini 3 (documented in README). Consider whether 137 should show a "still thinking" status before the timeout.
- **Thought signatures:** `extra_content.google.thought_signature` round-trips correctly through `providerState` replay. No continuation got a 400.
- **Streaming:** `index` is missing from Gemini's streamed `tool_calls`; the adapter's fallback keying covers this. Arguments arrive whole (not fragmented) and usage is present. Stay with `stream=true`. Non-streaming was not compared (operator did not run `--stream false`).
- **Model ID vs display name:** `AI_MODEL` must be the model ID (`gemini-3-flash-preview`), not a product/display name (`Antigravity`). A wrong ID returns HTTP 400 on every request. 142 (settings/diagnostics) could map an all-400 first request to a "check AI_MODEL" hint.
- **Wire captures:** the sanitised captures showed no quirk beyond the hand-written fixtures except the missing `index` (already covered) and the body-only `retryDelay` (already covered). No adapter change is needed. Follow-up (optional): add one Gemini daily-quota 429 body and one no-index streamed tool call as recorded adapter fixtures.

**Confidence:** MEDIUM. Every clean measurement passed, but the sample is small (19 clean trials, 2 round-trips), comes from one model on one day, and is cut short by the quota. The Claude adapter is not live-verified, and Ollama is untested.
