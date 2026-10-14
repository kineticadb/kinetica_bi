import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const confPath = resolve(process.cwd(), "../../docker/nginx.conf");
const conf = readFileSync(confPath, "utf8");

/** Body of the block opened by `header {`, up to its matching `}`; null if absent. */
function blockBody(src: string, header: string): string | null {
  const start = src.indexOf(`${header} {`);
  if (start < 0) return null;
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  return null;
}

const hasNginx = spawnSync("nginx", ["-v"]).error === undefined;

describe("deploy nginx streams the AI ask endpoint (S2)", () => {
  it("NGX-1: has an exact-match location for /api/ai/ask", () => {
    expect(blockBody(conf, "location = /api/ai/ask")).not.toBeNull();
  });

  it("NGX-2: the ask location disables buffering/cache/gzip and re-declares proxy headers", () => {
    const b = blockBody(conf, "location = /api/ai/ask") ?? "";
    for (const d of [
      "proxy_buffering off;",
      "proxy_cache off;",
      "gzip off;",
      "proxy_http_version 1.1;",
      'proxy_set_header Connection "";',
      "proxy_read_timeout 300s;",
      "proxy_pass http://127.0.0.1:4000;",
      "proxy_set_header Host $host;",
      "proxy_set_header X-Forwarded-Proto https;",
      "proxy_set_header X-Forwarded-For $remote_addr;",
    ]) {
      expect(b, d).toContain(d);
    }
  });

  it("NGX-3: the generic /api/ location keeps buffering on", () => {
    const b = blockBody(conf, "location /api/");
    expect(b).not.toBeNull();
    expect(b).not.toContain("proxy_buffering off");
  });

  it.skipIf(!hasNginx)("NGX-4: nginx -t accepts the conf", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "kbi-ngx-"));
    try {
      const wrapper = resolve(dir, "nginx.conf");
      writeFileSync(
        wrapper,
        [
          `pid ${dir}/nginx.pid;`,
          `error_log ${dir}/error.log;`,
          "events {}",
          "http {",
          `  access_log off;`,
          `  client_body_temp_path ${dir}/cb;`,
          `  proxy_temp_path ${dir}/px;`,
          `  fastcgi_temp_path ${dir}/fc;`,
          `  uwsgi_temp_path ${dir}/uw;`,
          `  scgi_temp_path ${dir}/sc;`,
          `  include ${confPath};`,
          "}",
          "",
        ].join("\n"),
      );
      const r = spawnSync("nginx", ["-t", "-p", dir, "-c", wrapper], { encoding: "utf8" });
      expect(`${r.stdout}${r.stderr}`).toContain("syntax is ok");
      expect(r.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
