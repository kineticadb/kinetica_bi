import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import zlib from "node:zlib";
import { writeCsv } from "../src/lib/exportRunner";
import { rowsToCsv } from "../../web/src/lib/csvExport";

const collector = () => {
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk, _e, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  return { sink, bytes: () => Buffer.concat(chunks) };
};

async function* fromBatches<T>(b: T[]): AsyncGenerator<T> {
  for (const x of b) yield x;
}

describe("writeCsv memory/laziness", () => {
  it("EXPMEM-lazy-1m: 1,000,000 rows into a slow sink are pulled on demand", async () => {
    let produced = 0;
    let consumedRows = 0;
    let maxLag = 0;
    async function* gen() {
      for (let b = 0; b < 1000; b++) {
        const rows: unknown[][] = [];
        for (let i = 0; i < 1000; i++) rows.push([b * 1000 + i, "x".repeat(40)]);
        produced += rows.length;
        maxLag = Math.max(maxLag, produced - consumedRows);
        yield rows;
      }
    }
    const sink = new Writable({
      highWaterMark: 64 * 1024,
      write(chunk, _e, cb) {
        const s = chunk.toString();
        let c = 0;
        for (let i = s.indexOf("\r\n"); i !== -1; i = s.indexOf("\r\n", i + 2)) c++;
        consumedRows += c;
        setImmediate(cb);
      },
    });
    const heap0 = process.memoryUsage().heapUsed;
    const n = await writeCsv(gen(), ["id", "v"], sink);
    expect(n).toBe(1_000_000);
    expect(maxLag).toBeLessThan(50_000);
    expect(process.memoryUsage().heapUsed - heap0).toBeLessThan(200 * 1024 * 1024);
  }, 15_000);

  it("EXPMEM-bytes: writeCsv output equals web rowsToCsv for a small fixture", async () => {
    const header = ["id", "=h", "v"];
    const batches = [
      [[1, "=1+1", null]],
      [[-5, "a,b", "z"], [2, "plain", 3]],
      [[null, "q\"r", "-x"]],
    ];
    const all = batches.flat();
    const objs = all.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
    const { sink, bytes } = collector();
    const n = await writeCsv(fromBatches(batches), header, sink);
    expect(n).toBe(4);
    expect(bytes().toString("utf8")).toBe(rowsToCsv(objs, header));
  });

  it("EXPMEM-empty: zero batches writes the header line only, no trailing CRLF", async () => {
    const { sink, bytes } = collector();
    const n = await writeCsv(fromBatches([]), ["a", "b"], sink);
    expect(n).toBe(0);
    expect(bytes().toString()).toBe("a,b");
  });

  it("EXPMEM-gzip: gzip:true output gunzips to the same bytes", async () => {
    const batches = [[[1, "x"], [2, "y"]]];
    const plain = collector();
    await writeCsv(fromBatches(batches), ["a", "b"], plain.sink);
    const gz = collector();
    await writeCsv(fromBatches(batches), ["a", "b"], gz.sink, { gzip: true });
    expect(zlib.gunzipSync(gz.bytes()).toString()).toBe(plain.bytes().toString());
  });

  it("EXPMEM-gzip-os: gzip header OS byte is 0x03 (Unix), so macOS Archive Utility opens it; stream stays valid", async () => {
    const batches = [[[1, "x"], [2, "y"]]];
    const gz = collector();
    await writeCsv(fromBatches(batches), ["a", "b"], gz.sink, { gzip: true });
    const out = gz.bytes();
    expect(out.subarray(0, 3)).toEqual(Buffer.from([0x1f, 0x8b, 0x08]));
    expect(out[9]).toBe(0x03);
    expect(zlib.gunzipSync(out).toString()).toBe("a,b\r\n1,x\r\n2,y");
  });

  it("EXPMEM-gzip-os-split: the OS byte is patched even when the header arrives in 1-byte chunks", async () => {
    const { gzipUnixHeader } = await import("../src/lib/exportRunner");
    const src = zlib.gzipSync(Buffer.from("hello"));
    src[9] = 0x13;
    const t = gzipUnixHeader();
    const parts: Buffer[] = [];
    t.on("data", (c: Buffer) => parts.push(c));
    for (let i = 0; i < src.length; i++) t.write(src.subarray(i, i + 1));
    t.end();
    await new Promise((r) => t.on("end", r));
    const out = Buffer.concat(parts);
    expect(out[9]).toBe(0x03);
    expect(zlib.gunzipSync(out).toString()).toBe("hello");
  });

  it("EXPMEM-abort: an aborted signal rejects with AbortError and stops pulling the generator", async () => {
    const ac = new AbortController();
    let produced = 0;
    let finallyRan = false;
    async function* gen() {
      try {
        for (let b = 0; b < 100000; b++) {
          produced++;
          yield [[b, "x"]];
          await new Promise((r) => setImmediate(r));
        }
      } finally {
        finallyRan = true;
      }
    }
    const { sink } = collector();
    const p = writeCsv(gen(), ["a", "b"], sink, { signal: ac.signal, onBatch: (n) => n === 5 && ac.abort() });
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    await new Promise((r) => setTimeout(r, 20));
    const at = produced;
    await new Promise((r) => setTimeout(r, 20));
    expect(produced).toBe(at);
    expect(produced).toBeLessThan(100);
    expect(finallyRan).toBe(true);
  });
});
