// 137 D-20: the model's reply trailer (no extra tool, no extra request). Untrusted text: the web renders it as plain text.
import { AI_FOLLOWUP_MAX, AI_FOLLOWUP_MAX_CHARS, type AiClarification } from "@kinetica-bi/shared";

export type ReplyTrailer = { text: string; followUps: string[]; choices: string[] };

const PARSE_CAP = 20000;
const CHOICE_MAX = 3;
const CHOICE_MAX_CHARS = 200;
const ITEM_RE = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/;
const HEADING_RE = /^\s*(follow[- ]?ups?(?: questions)?|choices|options)\s*:\s*$/i;

function clean(items: string[], max: number, maxChars: number): string[] {
  const out: string[] = [];
  for (const raw of items) {
    const s = raw.trim().slice(0, maxChars).trim();
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

const norm = (s: string) => s.trim().toLowerCase();

/** `echoes`: questions the UI already shows as cards. 142 UAT: the model repeats a confirm question after its
 *  trailer, which hid the trailer and showed the question twice, so trailing echoes are dropped first. */
export function parseReplyTrailer(raw: string, echoes: readonly string[] = []): ReplyTrailer {
  try {
    const unchanged = { text: raw, followUps: [] as string[], choices: [] as string[] };
    if (raw.length > PARSE_CAP) return unchanged;
    const lines = raw.replace(/\r\n?/g, "\n").split("\n");
    const echo = new Set(echoes.map(norm).filter(Boolean));
    const hasTextAbove = (n: number) => lines.slice(0, n).some((l) => l.trim() !== "");
    while (lines.length > 0 && (lines[lines.length - 1]!.trim() === "" || (echo.has(norm(lines[lines.length - 1]!)) && hasTextAbove(lines.length - 1)))) lines.pop();
    let end = lines.length - 1;
    let cut = lines.length;
    let followUps: string[] = [];
    let choices: string[] = [];
    for (let block = 0; block < 2; block++) {
      while (end >= 0 && lines[end]!.trim() === "") end--;
      const items: string[] = [];
      let i = end;
      let heading: string | null = null;
      for (; i >= 0; i--) {
        const line = lines[i]!;
        if (line.trim() === "") continue;
        const h = HEADING_RE.exec(line);
        if (h) {
          heading = h[1]!.toLowerCase();
          break;
        }
        const m = ITEM_RE.exec(line);
        if (!m) break;
        items.push(m[1]!);
      }
      if (heading === null) break;
      items.reverse();
      if (heading.startsWith("follow")) followUps = followUps.length ? followUps : items;
      else choices = choices.length ? choices : items;
      cut = i;
      end = i - 1;
    }
    if (cut === lines.length) return { text: lines.join("\n").trimEnd(), followUps: [], choices: [] };
    return {
      text: lines.slice(0, cut).join("\n").trimEnd(),
      followUps: clean(followUps, AI_FOLLOWUP_MAX, AI_FOLLOWUP_MAX_CHARS),
      choices: clean(choices, CHOICE_MAX, CHOICE_MAX_CHARS),
    };
  } catch {
    return { text: raw, followUps: [], choices: [] };
  }
}

export function toChoiceClarification(text: string, choices: readonly string[]): AiClarification | null {
  if (choices.length < 2) return null;
  const last = text.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
  const question = last.endsWith("?") && last.length <= 300 ? last : "Which did you mean?";
  return {
    kind: "choose_option",
    question,
    options: choices.slice(0, CHOICE_MAX).map((label, i) => ({ id: String(i + 1), label })),
  };
}
