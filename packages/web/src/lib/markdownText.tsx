// kbi-mcp: the text widget's markdown subset, rendered to React elements only (never innerHTML), so HTML
// written by a model or a user shows as literal text. Supported: # to ### headings, paragraphs, **bold**,
// *italic* / _italic_, `code`, [links](https://...), - / * bullet and 1. numbered lists, | pipe | tables |,
// and --- rules. Only http, https and mailto links become links; anything else renders as its text.
import type { ReactNode } from "react";

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
const HEADING = /^(#{1,3})\s+(.*)$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** Earliest inline token wins; ties go to the longer delimiter (** before *). */
const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_|\[([^\]]+)\]\(([^)\s]+)\)/;

export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest.length > 0) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const key = `${keyPrefix}-${n++}`;
    if (m[1] !== undefined) out.push(<code key={key}>{m[1]}</code>);
    else if (m[2] !== undefined || m[3] !== undefined) out.push(<strong key={key}>{renderInline(m[2] ?? m[3], key)}</strong>);
    else if (m[4] !== undefined || m[5] !== undefined) out.push(<em key={key}>{renderInline(m[4] ?? m[5], key)}</em>);
    else {
      const label = renderInline(m[6], key);
      const href = m[7];
      out.push(
        SAFE_HREF.test(href) ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        ) : (
          <span key={key}>{label}</span>
        ),
      );
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export function renderMarkdown(source: string): ReactNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  const key = () => `b-${k++}`;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      const Tag = (["h3", "h4", "h5"] as const)[h[1].length - 1];
      const bk = key();
      blocks.push(<Tag key={bk}>{renderInline(h[2].trim(), bk)}</Tag>);
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push(<hr key={key()} />);
      i++;
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const head = tableCells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(tableCells(lines[i++]));
      const bk = key();
      blocks.push(
        <table key={bk}>
          <thead>
            <tr>{head.map((c, j) => <th key={j}>{renderInline(c, `${bk}-h${j}`)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>{head.map((_, j) => <td key={j}>{renderInline(r[j] ?? "", `${bk}-${ri}-${j}`)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    const list = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : undefined;
    if (list) {
      const items: string[] = [];
      while (i < lines.length && list.test(lines[i])) items.push(list.exec(lines[i++])![1]);
      const bk = key();
      const lis = items.map((t, j) => <li key={j}>{renderInline(t, `${bk}-${j}`)}</li>);
      blocks.push(list === BULLET ? <ul key={bk}>{lis}</ul> : <ol key={bk}>{lis}</ol>);
      continue;
    }
    // A paragraph runs until a blank line or the start of another block.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !HEADING.test(lines[i]) &&
      !RULE.test(lines[i]) &&
      !BULLET.test(lines[i]) &&
      !NUMBERED.test(lines[i]) &&
      !(lines[i].trim().startsWith("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]))
    ) {
      para.push(lines[i++].trim());
    }
    const bk = key();
    blocks.push(<p key={bk}>{renderInline(para.join(" "), bk)}</p>);
  }
  return blocks;
}
