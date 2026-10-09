import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  createZipEntryStages, dataDescriptor, centralDirectoryHeader, endOfCentralDirectory, needsZip64, dosDateTime,
} from "../src/lib/zipStream";
import { readSingleEntryZip } from "./helpers/readZip";

const NAME = "Résumé – 数据 - Q1.csv";
const MTIME = new Date(2026, 9, 8, 14, 30, 59);
const CHUNKS = ["id,name\r\n", "1,Résumé\r\n", "2,数据"];
const INPUT = Buffer.from(CHUNKS.join(""), "utf8");

async function zipOf(chunks: string[], forceZip64 = false, entryName = NAME): Promise<Buffer> {
  const out: Buffer[] = [];
  const sink = new Writable({ write(c, _e, cb) { out.push(Buffer.from(c)); cb(); } });
  await pipeline(Readable.from(chunks.map((c) => Buffer.from(c, "utf8"))), ...createZipEntryStages({ entryName, mtime: MTIME, forceZip64 }), sink);
  return Buffer.concat(out);
}

const has = (cmd: string, arg: string): boolean => spawnSync(cmd, [arg]).error === undefined;
const HAS_PY = has("python3", "--version");
const HAS_UNZIP = has("unzip", "-v");

let tmp: string | null = null;
const mk = (): string => (tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kbi-zip-")));
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null; });

const PY = "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; i=z.infolist(); assert len(i)==1; sys.stdout.write(i[0].filename+'\\n'); sys.stdout.flush(); sys.stdout.buffer.write(z.read(i[0]))";

describe("zipStream", () => {
  it("EXPZIP-roundtrip", async () => {
    const z = await zipOf(CHUNKS);
    const r = readSingleEntryZip(z);
    expect(r.name).toBe(NAME);
    expect(r.data.equals(INPUT)).toBe(true);
    expect(r.crc).toBe(zlib.crc32(r.data));
  });

  it("EXPZIP-layout", async () => {
    const z = await zipOf(CHUNKS);
    const n = Buffer.byteLength(NAME, "utf8");
    expect(z.readUInt32LE(0)).toBe(0x04034b50);
    expect(z.readUInt16LE(4)).toBe(45);
    expect(z.readUInt16LE(6)).toBe(0x0808);
    expect(z.readUInt16LE(8)).toBe(8);
    expect(z.readUInt32LE(18)).toBe(0xffffffff);
    expect(z.readUInt32LE(22)).toBe(0xffffffff);
    expect(z.readUInt16LE(28)).toBe(20);
    expect(z.readUInt16LE(30 + n)).toBe(1);
    expect(z.readUInt16LE(32 + n)).toBe(16);
    const r = readSingleEntryZip(z);
    expect(r.localHasZip64Extra).toBe(true);
    expect(r.localFlags).toBe(0x0808);
    expect(r.centralFlags).toBe(0x0808);
    expect(r.zip64Central).toBe(false);
    expect(r.hasZip64Eocd).toBe(false);
    expect(z.readUInt32LE(z.length - 22)).toBe(0x06054b50);
    expect(z.readUInt16LE(z.length - 22 + 10)).toBe(1);
    // descriptor sits right after the compressed data: the 24 bytes before the central header
    const cd = z.readUInt32LE(z.length - 22 + 16);
    expect(z.readUInt32LE(cd - 24)).toBe(0x08074b50);
  });

  it("EXPZIP-zip64-forced", async () => {
    const z = await zipOf(CHUNKS, true);
    const r = readSingleEntryZip(z);
    expect(r.zip64Central).toBe(true);
    expect(r.hasZip64Eocd).toBe(true);
    expect(r.data.equals(INPUT)).toBe(true);
    const e = z.length - 22;
    expect(z.readUInt16LE(e + 8)).toBe(0xffff);
    expect(z.readUInt16LE(e + 10)).toBe(0xffff);
    expect(z.readUInt32LE(e + 12)).toBe(0xffffffff);
    expect(z.readUInt32LE(e + 16)).toBe(0xffffffff);
    expect(z.readUInt32LE(e - 20)).toBe(0x07064b50);
    expect(z.readUInt32LE(e - 76)).toBe(0x06064b50);
    const cdOff = Number(z.readBigUInt64LE(e - 76 + 48));
    expect(z.readUInt32LE(cdOff + 20)).toBe(0xffffffff);
    expect(z.readUInt32LE(cdOff + 24)).toBe(0xffffffff);
  });

  it("EXPZIP-records-64bit", () => {
    const d = dataDescriptor(0x12345678, 4_300_000_000, 5_000_000_000);
    expect(d.length).toBe(24);
    expect(d.readBigUInt64LE(8)).toBe(4300000000n);
    expect(d.readBigUInt64LE(16)).toBe(5000000000n);
    const dt = dosDateTime(MTIME);
    const c = centralDirectoryHeader({ name: Buffer.from("a.csv"), dt, crc: 1, compressedSize: 4_300_000_000, uncompressedSize: 5_000_000_000, zip64: true });
    expect(c.readUInt32LE(20)).toBe(0xffffffff);
    expect(c.readUInt32LE(24)).toBe(0xffffffff);
    expect(c.readUInt16LE(46 + 5)).toBe(1);
    expect(c.readUInt16LE(46 + 5 + 2)).toBe(16);
    expect(c.readBigUInt64LE(46 + 5 + 4)).toBe(5000000000n);
    expect(c.readBigUInt64LE(46 + 5 + 12)).toBe(4300000000n);
    const e = endOfCentralDirectory({ cdOffset: 4_400_000_000, cdSize: 75, zip64: true });
    expect(e.length).toBe(98);
    expect(e.readBigUInt64LE(48)).toBe(4400000000n);
    expect(e.readBigUInt64LE(56 + 8)).toBe(4400000075n);
    expect(e.readUInt32LE(76 + 16)).toBe(0xffffffff);
  });

  it("EXPZIP-needs-zip64-boundary", () => {
    const ok = 0xfffffffe, edge = 0xffffffff;
    expect(needsZip64({ compressedSize: ok, uncompressedSize: ok, cdOffset: ok })).toBe(false);
    expect(needsZip64({ compressedSize: edge, uncompressedSize: ok, cdOffset: ok })).toBe(true);
    expect(needsZip64({ compressedSize: ok, uncompressedSize: edge, cdOffset: ok })).toBe(true);
    expect(needsZip64({ compressedSize: ok, uncompressedSize: ok, cdOffset: edge })).toBe(true);
  });

  it("EXPZIP-dos-time", () => {
    expect(dosDateTime(new Date(2026, 9, 8, 14, 30, 59))).toEqual({ time: 29661, date: 23880 });
    expect(dosDateTime(new Date(1975, 0, 1))).toEqual({ time: 0, date: 33 });
  });

  it("EXPZIP-empty", async () => {
    const r = readSingleEntryZip(await zipOf([]));
    expect(r.data.length).toBe(0);
  });

  describe.each([["plain", false], ["forced-zip64", true]] as const)("%s", (_label, forced) => {
    it.skipIf(!HAS_PY)("EXPZIP-python", async () => {
      const f = path.join(mk(), "s.zip");
      fs.writeFileSync(f, await zipOf(CHUNKS, forced));
      const r = spawnSync("python3", ["-I", "-c", PY, f]);
      expect(r.status, String(r.stderr)).toBe(0);
      expect(Buffer.from(r.stdout).equals(Buffer.concat([Buffer.from(NAME + "\n", "utf8"), INPUT]))).toBe(true);
    });

    it.skipIf(!HAS_UNZIP)("EXPZIP-unzip-t", async () => {
      const f = path.join(mk(), "s.zip");
      fs.writeFileSync(f, await zipOf(CHUNKS, forced));
      const r = spawnSync("unzip", ["-t", f]);
      expect(r.status, String(r.stdout) + String(r.stderr)).toBe(0);
      expect(String(r.stdout)).toContain("No errors detected");
    });

    it.skipIf(process.platform !== "darwin")("EXPZIP-ditto", async () => {
      const d = mk();
      const f = path.join(d, "s.zip");
      const o = path.join(d, "out");
      fs.writeFileSync(f, await zipOf(CHUNKS, forced));
      const r = spawnSync("ditto", ["-x", "-k", f, o]);
      expect(r.status, String(r.stderr)).toBe(0);
      expect(fs.readFileSync(path.join(o, NAME)).equals(INPUT)).toBe(true);
    });
  });
});
