/**
 * Machine-readable AI label for every result Tevyon stores (AI Act Art. 50 (2): synthetic output marked in a
 * machine-readable format). An XMP packet with the IPTC digital source type “trainedAlgorithmicMedia” and Tevyon as
 * the creator tool, never a vendor or model name (the supply route stays on the server). The picture or video itself is never
 * re-encoded: PNG gets an iTXt chunk, JPEG an APP1 segment, WebP an XMP chunk (with the VP8X header that requires),
 * MP4 a uuid box at the end.
 *
 * Files that carry a C2PA manifest are left exactly as they are: any changed byte would break the vendor's signature,
 * and that label must stay. A file that already names its digital source type, or that cannot be read
 * safely, is left alone as well. The result is the same object when nothing changed.
 */

const SOURCE_TYPE = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";
const XMP =
  '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">' +
  `<Iptc4xmpExt:DigitalSourceType>${SOURCE_TYPE}</Iptc4xmpExt:DigitalSourceType>` +
  "<xmp:CreatorTool>Tevyon</xmp:CreatorTool>" +
  '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';

const enc = new TextEncoder();
const XMP_BYTES = enc.encode(XMP);
const ascii = (s: string) => enc.encode(s);

/** Byte search without decoding the whole file. */
function contains(data: Uint8Array, needle: string): boolean {
  const n = ascii(needle);
  const first = n[0]!;
  for (let i = data.indexOf(first); i !== -1 && i <= data.length - n.length; i = data.indexOf(first, i + 1)) {
    let j = 1;
    while (j < n.length && data[i + j] === n[j]) j++;
    if (j === n.length) return true;
  }
  return false;
}

const startsWith = (data: Uint8Array, at: number, s: string) => {
  const b = ascii(s);
  return data.length >= at + b.length && b.every((x, i) => data[at + i] === x);
};

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const u32be = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u32le = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const u24le = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** PNG: an iTXt chunk “XML:com.adobe.xmp” right after IHDR. */
function png(data: Uint8Array): Uint8Array | null {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (data.length < 33 || !sig.every((b, i) => data[i] === b) || !startsWith(data, 12, "IHDR")) return null;
  const body = concat(ascii("XML:com.adobe.xmp"), new Uint8Array([0, 0, 0, 0, 0]), XMP_BYTES);
  const typed = concat(ascii("iTXt"), body);
  const chunk = concat(u32be(body.length), typed, u32be(crc32(typed)));
  return concat(data.subarray(0, 33), chunk, data.subarray(33));
}

/** JPEG: an APP1 XMP segment after SOI (and after a JFIF APP0, which must stay first). */
function jpeg(data: Uint8Array): Uint8Array | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let at = 2;
  if (data[2] === 0xff && data[3] === 0xe0) {
    if (data.length < 6) return null;
    at = 4 + ((data[4]! << 8) | data[5]!);
    if (at > data.length) return null;
  }
  const payload = concat(ascii("http://ns.adobe.com/xap/1.0/\u0000"), XMP_BYTES);
  const length = payload.length + 2;
  if (length > 0xffff) return null;
  const segment = concat(new Uint8Array([0xff, 0xe1, length >> 8, length & 255]), payload);
  return concat(data.subarray(0, at), segment, data.subarray(at));
}

/** WebP: an “XMP ” chunk, flagged in VP8X (built from the VP8 or VP8L header of a simple file). */
function webp(data: Uint8Array): Uint8Array | null {
  if (data.length < 30 || !startsWith(data, 0, "RIFF") || !startsWith(data, 8, "WEBP")) return null;
  const pad = XMP_BYTES.length % 2 ? new Uint8Array([0]) : new Uint8Array(0);
  const xmpChunk = concat(ascii("XMP "), u32le(XMP_BYTES.length), XMP_BYTES, pad);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let head: Uint8Array;
  let rest: Uint8Array;
  if (startsWith(data, 12, "VP8X")) {
    head = data.slice(12, 30);
    head[8] = head[8]! | 0x04;
    rest = data.subarray(30);
  } else {
    let width: number;
    let height: number;
    let alpha = false;
    if (startsWith(data, 12, "VP8 ")) {
      if (data[23] !== 0x9d || data[24] !== 0x01 || data[25] !== 0x2a) return null;
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    } else if (startsWith(data, 12, "VP8L")) {
      if (data[20] !== 0x2f) return null;
      const bits = view.getUint32(21, true);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
      alpha = ((bits >>> 28) & 1) === 1;
    } else return null;
    if (!width || !height) return null;
    head = concat(ascii("VP8X"), u32le(10), new Uint8Array([0x04 | (alpha ? 0x10 : 0), 0, 0, 0]), u24le(width - 1), u24le(height - 1));
    rest = data.subarray(12);
  }
  const body = concat(ascii("WEBP"), head, rest, xmpChunk);
  return concat(ascii("RIFF"), u32le(body.length), body);
}

/**
 * MP4: a top-level uuid box with the XMP UUID, appended: no offset inside the file moves. Only for a file whose
 * top-level boxes add up to its length; a last box “to the end of the file” (size 0) would swallow the label.
 */
function mp4(data: Uint8Array): Uint8Array | null {
  if (data.length < 12 || !startsWith(data, 4, "ftyp")) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let at = 0; at < data.length; ) {
    if (at + 8 > data.length) return null;
    let size = view.getUint32(at);
    if (size === 1) {
      if (at + 16 > data.length) return null;
      size = Number(view.getBigUint64(at + 8));
    }
    if (size < 8 || at + size > data.length) return null;
    at += size;
  }
  const uuid = new Uint8Array([0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac]);
  const box = concat(u32be(8 + uuid.length + XMP_BYTES.length), ascii("uuid"), uuid, XMP_BYTES);
  return concat(data, box);
}

const BY_TYPE: Record<string, (data: Uint8Array) => Uint8Array | null> = {
  "image/png": png,
  "image/jpeg": jpeg,
  "image/webp": webp,
  "video/mp4": mp4,
};

/** The result with its AI label, or the same bytes when it has one, carries C2PA or cannot be read safely. */
export function labelAiOutput(data: Uint8Array, contentType: string): Uint8Array {
  const write = BY_TYPE[contentType];
  if (!write || contains(data, "c2pa") || contains(data, "trainedAlgorithmicMedia")) return data;
  return write(data) ?? data;
}
