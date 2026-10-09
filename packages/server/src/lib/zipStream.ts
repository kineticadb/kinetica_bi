// Phase 131 D-07a: streaming one-entry zip writer (deflate, CRC-32, data descriptor, ZIP64).
// The local header always announces ZIP64; see 131-11-PLAN DD-2 (macOS ditto/Archive Utility rejects a
// 24-byte descriptor without it). No dependency: node:zlib only.
import zlib from "node:zlib";
import { Transform } from "node:stream";

export const ZIP_U32_MAX = 0xffffffff;

export type DosDateTime = { time: number; date: number };
export type ZipEntryOptions = { entryName: string; mtime?: Date; forceZip64?: boolean };

const big = (b: Buffer, off: number, v: number): void => { b.writeBigUInt64LE(BigInt(v), off); };

export function dosDateTime(d: Date): DosDateTime {
  const year = d.getFullYear();
  if (year < 1980) return { time: 0, date: 33 };
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function needsZip64(a: { compressedSize: number; uncompressedSize: number; cdOffset: number }): boolean {
  return a.compressedSize >= ZIP_U32_MAX || a.uncompressedSize >= ZIP_U32_MAX || a.cdOffset >= ZIP_U32_MAX;
}

export function localFileHeader(name: Buffer, dt: DosDateTime): Buffer {
  const n = name.length;
  const b = Buffer.alloc(30 + n + 20);
  b.writeUInt32LE(0x04034b50, 0);
  b.writeUInt16LE(45, 4);
  b.writeUInt16LE(0x0808, 6);
  b.writeUInt16LE(8, 8);
  b.writeUInt16LE(dt.time, 10);
  b.writeUInt16LE(dt.date, 12);
  b.writeUInt32LE(0, 14);
  b.writeUInt32LE(ZIP_U32_MAX, 18);
  b.writeUInt32LE(ZIP_U32_MAX, 22);
  b.writeUInt16LE(n, 26);
  b.writeUInt16LE(20, 28);
  name.copy(b, 30);
  b.writeUInt16LE(0x0001, 30 + n);
  b.writeUInt16LE(16, 32 + n);
  // 34+n / 42+n: 64-bit sizes, 0 (unknown; real values in the descriptor)
  return b;
}

export function dataDescriptor(crc: number, compressedSize: number, uncompressedSize: number): Buffer {
  const b = Buffer.alloc(24);
  b.writeUInt32LE(0x08074b50, 0);
  b.writeUInt32LE(crc >>> 0, 4);
  big(b, 8, compressedSize);
  big(b, 16, uncompressedSize);
  return b;
}

export function centralDirectoryHeader(a: {
  name: Buffer; dt: DosDateTime; crc: number; compressedSize: number; uncompressedSize: number; zip64: boolean;
}): Buffer {
  const n = a.name.length;
  const b = Buffer.alloc(46 + n + (a.zip64 ? 20 : 0));
  b.writeUInt32LE(0x02014b50, 0);
  b.writeUInt16LE(0x032d, 4);
  b.writeUInt16LE(45, 6);
  b.writeUInt16LE(0x0808, 8);
  b.writeUInt16LE(8, 10);
  b.writeUInt16LE(a.dt.time, 12);
  b.writeUInt16LE(a.dt.date, 14);
  b.writeUInt32LE(a.crc >>> 0, 16);
  b.writeUInt32LE(a.zip64 ? ZIP_U32_MAX : a.compressedSize, 20);
  b.writeUInt32LE(a.zip64 ? ZIP_U32_MAX : a.uncompressedSize, 24);
  b.writeUInt16LE(n, 28);
  b.writeUInt16LE(a.zip64 ? 20 : 0, 30);
  b.writeUInt16LE(0, 32);
  b.writeUInt16LE(0, 34);
  b.writeUInt16LE(0, 36);
  b.writeUInt32LE(0x81a40000, 38);
  b.writeUInt32LE(0, 42);
  a.name.copy(b, 46);
  if (a.zip64) {
    const o = 46 + n;
    b.writeUInt16LE(0x0001, o);
    b.writeUInt16LE(16, o + 2);
    big(b, o + 4, a.uncompressedSize);
    big(b, o + 12, a.compressedSize);
  }
  return b;
}

export function endOfCentralDirectory(a: { cdOffset: number; cdSize: number; zip64: boolean }): Buffer {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(a.zip64 ? 0xffff : 1, 8);
  eocd.writeUInt16LE(a.zip64 ? 0xffff : 1, 10);
  eocd.writeUInt32LE(a.zip64 ? ZIP_U32_MAX : a.cdSize, 12);
  eocd.writeUInt32LE(a.zip64 ? ZIP_U32_MAX : a.cdOffset, 16);
  eocd.writeUInt16LE(0, 20);
  if (!a.zip64) return eocd;
  const rec = Buffer.alloc(56);
  rec.writeUInt32LE(0x06064b50, 0);
  big(rec, 4, 44);
  rec.writeUInt16LE(0x032d, 12);
  rec.writeUInt16LE(45, 14);
  rec.writeUInt32LE(0, 16);
  rec.writeUInt32LE(0, 20);
  big(rec, 24, 1);
  big(rec, 32, 1);
  big(rec, 40, a.cdSize);
  big(rec, 48, a.cdOffset);
  const loc = Buffer.alloc(20);
  loc.writeUInt32LE(0x07064b50, 0);
  loc.writeUInt32LE(0, 4);
  big(loc, 8, a.cdOffset + a.cdSize);
  loc.writeUInt32LE(1, 16);
  return Buffer.concat([rec, loc, eocd]);
}

export function createZipEntryStages(opts: ZipEntryOptions): [Transform, Transform, Transform] {
  if (typeof zlib.crc32 !== "function") throw new Error("Compressed exports need Node.js >= 20.15 (zlib.crc32).");
  const name = Buffer.from(opts.entryName, "utf8");
  if (name.length > 0xffff) throw new Error("Zip entry name too long.");
  const dt = dosDateTime(opts.mtime ?? new Date());
  const st = { crc: 0, usize: 0, csize: 0, written: 0, headerSent: false };

  const meter = new Transform({
    transform(chunk, _enc, cb) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      st.crc = zlib.crc32(b, st.crc);
      st.usize += b.length;
      cb(null, b);
    },
  });
  const deflate = zlib.createDeflateRaw();
  const sendHeader = (t: Transform): void => {
    if (st.headerSent) return;
    st.headerSent = true;
    const h = localFileHeader(name, dt);
    st.written += h.length;
    t.push(h);
  };
  const framer = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      sendHeader(this);
      st.csize += chunk.length;
      st.written += chunk.length;
      cb(null, chunk);
    },
    flush(cb) {
      sendHeader(this);
      this.push(dataDescriptor(st.crc, st.csize, st.usize));
      st.written += 24;
      const cdOffset = st.written;
      const zip64 = opts.forceZip64 === true || needsZip64({ compressedSize: st.csize, uncompressedSize: st.usize, cdOffset });
      const cd = centralDirectoryHeader({ name, dt, crc: st.crc, compressedSize: st.csize, uncompressedSize: st.usize, zip64 });
      this.push(cd);
      this.push(endOfCentralDirectory({ cdOffset, cdSize: cd.length, zip64 }));
      cb();
    },
  });
  return [meter, deflate, framer];
}
