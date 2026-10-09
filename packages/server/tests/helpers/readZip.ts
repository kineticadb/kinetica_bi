// Independent single-entry zip reader for tests (does NOT import the writer). Throws on any mismatch.
import zlib from "node:zlib";

const U32 = 0xffffffff;

export type SingleEntryZip = {
  name: string; data: Buffer; crc: number; localFlags: number; centralFlags: number;
  localHasZip64Extra: boolean; zip64Central: boolean; hasZip64Eocd: boolean;
};

const need = (cond: boolean, msg: string): void => { if (!cond) throw new Error(`readSingleEntryZip: ${msg}`); };

export function readSingleEntryZip(buf: Buffer): SingleEntryZip {
  const eocd = buf.length - 22;
  need(eocd >= 0 && buf.readUInt32LE(eocd) === 0x06054b50, "bad EOCD signature");
  let cdOffset = buf.readUInt32LE(eocd + 16);
  let hasZip64Eocd = false;
  if (cdOffset === U32) {
    const loc = eocd - 20;
    need(buf.readUInt32LE(loc) === 0x07064b50, "bad ZIP64 locator signature");
    const recOff = Number(buf.readBigUInt64LE(loc + 8));
    need(buf.readUInt32LE(recOff) === 0x06064b50, "bad ZIP64 EOCD signature");
    cdOffset = Number(buf.readBigUInt64LE(recOff + 48));
    hasZip64Eocd = true;
  }
  need(buf.readUInt32LE(cdOffset) === 0x02014b50, "bad central header signature");
  const centralFlags = buf.readUInt16LE(cdOffset + 8);
  need(buf.readUInt16LE(cdOffset + 10) === 8, "method is not deflate");
  const crc = buf.readUInt32LE(cdOffset + 16);
  let csize = buf.readUInt32LE(cdOffset + 20);
  let usize = buf.readUInt32LE(cdOffset + 24);
  const n = buf.readUInt16LE(cdOffset + 28);
  const cExtra = buf.readUInt16LE(cdOffset + 30);
  const localOff = buf.readUInt32LE(cdOffset + 42);
  const cname = buf.subarray(cdOffset + 46, cdOffset + 46 + n);
  let zip64Central = false;
  for (let p = cdOffset + 46 + n, end = p + cExtra; p + 4 <= end; ) {
    const id = buf.readUInt16LE(p), sz = buf.readUInt16LE(p + 2);
    if (id === 1) {
      need(sz === 16, "central ZIP64 extra size");
      usize = Number(buf.readBigUInt64LE(p + 4));
      csize = Number(buf.readBigUInt64LE(p + 12));
      zip64Central = true;
    }
    p += 4 + sz;
  }
  need(buf.readUInt32LE(localOff) === 0x04034b50, "bad local header signature");
  const localFlags = buf.readUInt16LE(localOff + 6);
  const ln = buf.readUInt16LE(localOff + 26);
  const lExtra = buf.readUInt16LE(localOff + 28);
  need(buf.subarray(localOff + 30, localOff + 30 + ln).equals(cname), "local/central name mismatch");
  let localHasZip64Extra = false;
  for (let p = localOff + 30 + ln, end = p + lExtra; p + 4 <= end; ) {
    if (buf.readUInt16LE(p) === 1) localHasZip64Extra = true;
    p += 4 + buf.readUInt16LE(p + 2);
  }
  const start = localOff + 30 + ln + lExtra;
  const data = zlib.inflateRawSync(buf.subarray(start, start + csize));
  need(data.length === usize, "uncompressed size mismatch");
  need(zlib.crc32(data) === crc, "CRC mismatch");
  if (localFlags & 8) {
    const d = start + csize;
    need(buf.readUInt32LE(d) === 0x08074b50, "bad descriptor signature");
    need(buf.readUInt32LE(d + 4) === crc, "descriptor CRC mismatch");
    if (localHasZip64Extra) {
      need(Number(buf.readBigUInt64LE(d + 8)) === csize, "descriptor csize mismatch");
      need(Number(buf.readBigUInt64LE(d + 16)) === usize, "descriptor usize mismatch");
    } else {
      need(buf.readUInt32LE(d + 8) === csize, "descriptor csize mismatch");
      need(buf.readUInt32LE(d + 12) === usize, "descriptor usize mismatch");
    }
  }
  return { name: cname.toString("utf8"), data, crc, localFlags, centralFlags, localHasZip64Extra, zip64Central, hasZip64Eocd };
}
