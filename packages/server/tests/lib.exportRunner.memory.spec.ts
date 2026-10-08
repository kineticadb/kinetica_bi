import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { randomBytes } from "node:crypto";
import { writeCsv } from "../src/lib/exportRunner";
import { SizeCapError } from "../src/lib/exportCaps";
import { readSingleEntryZip } from "./helpers/readZip";
import { rowsToCsv } from "../../web/src/lib/csvExport";

const MTIME = new Date(2026, 9, 8, 14, 30, 59);

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

  it("EXPMEM-zip-bytes: zip output holds one entry equal to the plain bytes", async () => {
    const batches = [[[1, "x"], [2, "y"]]];
    const plain = collector();
    await writeCsv(fromBatches(batches), ["a", "b"], plain.sink);
    const z = collector();
    await writeCsv(fromBatches(batches), ["a", "b"], z.sink, { zip: { entryName: "t.csv", mtime: MTIME } });
    const r = readSingleEntryZip(z.bytes());
    expect(r.name).toBe("t.csv");
    expect(r.data.equals(plain.bytes())).toBe(true);
  });

  it("EXPMEM-zip-backpressure: a stalled sink stops the source pulling (barely compressible rows)", async () => {
    let produced = 0;
    async function* gen() {
      for (let i = 0; i < 1000; i++) {
        produced += 1000;
        yield Array.from({ length: 1000 }, (_, k) => [i * 1000 + k, randomBytes(20).toString("hex")]);
      }
    }
    const chunks: Buffer[] = [];
    const held: (() => void)[] = [];
    let first = true;
    const sink = new Writable({
      write(chunk, _e, cb) {
        chunks.push(Buffer.from(chunk));
        if (first) { first = false; held.push(cb); } else cb();
      },
    });
    const p = writeCsv(gen(), ["a", "b"], sink, { zip: { entryName: "t.csv", mtime: MTIME } });
    await new Promise((r) => setTimeout(r, 100));
    expect(produced).toBeLessThan(200_000);
    held.forEach((cb) => cb());
    const n = await p;
    expect(n).toBe(1_000_000);
    const data = readSingleEntryZip(Buffer.concat(chunks)).data;
    expect(data.toString("utf8").split("\r\n").length - 1).toBe(1_000_000);
  }, 60_000);

  it("EXPMEM-zip-cap-counts-zip-bytes: byteCap counts bytes after the zip stages", async () => {
    const batches = [[[1, "x"], [2, "y"], [3, "z"]]];
    const zip = { entryName: "t.csv", mtime: MTIME };
    const free = collector();
    await writeCsv(fromBatches(batches), ["a", "b"], free.sink, { zip });
    const S = free.bytes().length;
    await expect(writeCsv(fromBatches(batches), ["a", "b"], collector().sink, { zip, maxBytes: S })).resolves.toBe(3);
    await expect(writeCsv(fromBatches(batches), ["a", "b"], collector().sink, { zip, maxBytes: S - 1 })).rejects.toBeInstanceOf(SizeCapError);
  });

  it("EXPMEM-zip-abort: aborting a zip export rejects with AbortError and stops the generator", async () => {
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
    const p = writeCsv(gen(), ["a", "b"], collector().sink, { zip: { entryName: "t.csv", mtime: MTIME }, signal: ac.signal, onBatch: (n) => n === 5 && ac.abort() });
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    await new Promise((r) => setTimeout(r, 40));
    expect(produced).toBeLessThan(100);
    expect(finallyRan).toBe(true);
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
