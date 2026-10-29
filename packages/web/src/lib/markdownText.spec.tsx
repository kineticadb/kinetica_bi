import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { renderMarkdown } from "./markdownText";

const html = (md: string) => render(<div>{renderMarkdown(md)}</div>).container.firstElementChild!.innerHTML;

describe("renderMarkdown (text widget)", () => {
  it("MD-1 headings, paragraphs and inline styles", () => {
    const out = html("# Title\n## Sub\n### Small\nSome **bold**, *italic*, _also_ and `code`.\nSame paragraph.\n\nNext one.");
    expect(out).toContain("<h3>Title</h3>");
    expect(out).toContain("<h4>Sub</h4>");
    expect(out).toContain("<h5>Small</h5>");
    expect(out).toContain("<p>Some <strong>bold</strong>, <em>italic</em>, <em>also</em> and <code>code</code>. Same paragraph.</p>");
    expect(out).toContain("<p>Next one.</p>");
  });

  it("MD-2 bullet and numbered lists, rules", () => {
    const out = html("- one\n- **two**\n\n1. first\n2. second\n\n---");
    expect(out).toContain("<ul><li>one</li><li><strong>two</strong></li></ul>");
    expect(out).toContain("<ol><li>first</li><li>second</li></ol>");
    expect(out).toContain("<hr>");
  });

  it("MD-3 pipe tables", () => {
    const out = html("| Type | Trips |\n|---|---:|\n| Cash | 320,000 |\n| Credit |");
    expect(out).toContain("<thead><tr><th>Type</th><th>Trips</th></tr></thead>");
    expect(out).toContain("<tr><td>Cash</td><td>320,000</td></tr>");
    expect(out).toContain("<tr><td>Credit</td><td></td></tr>");
  });

  it("MD-4 only http, https and mailto become links, opened safely", () => {
    const out = html("[docs](https://kinetica.com) [mail](mailto:a@b.c) [bad](javascript:alert(1)) [rel](/x)");
    expect(out).toContain('<a href="https://kinetica.com" target="_blank" rel="noopener noreferrer">docs</a>');
    expect(out).toContain('<a href="mailto:a@b.c"');
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain('href="/x"');
    expect(out).toContain("<span>bad</span>");
  });

  it("MD-5 HTML is shown as text, never parsed", () => {
    const { container } = render(<div>{renderMarkdown('<script>alert(1)</script>\n<img src=x onerror="alert(1)">\n# <b>hi</b>')}</div>);
    expect(container.querySelector("script, img, b")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.innerHTML).toContain("&lt;img src=x");
  });

  it("MD-6 empty and plain input", () => {
    expect(renderMarkdown("")).toEqual([]);
    expect(html("just text")).toBe("<p>just text</p>");
  });
});
