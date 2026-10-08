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
