// Minimal 16-bit grayscale PNG writer.
//
// Why not sharp: sharp's raw-input `depth: 'ushort'` option does not round-trip
// here — a Uint16Array fed in that way is read back as 8-bit bytes, silently
// destroying the top byte of every sample (verified in verify.mjs, which caught
// this). The drying-height raster is the whole point of the pipeline, so it is
// encoded explicitly: PNG colour type 0 (grayscale), bit depth 16, big-endian
// samples, filter type 0 on every scanline.
import zlib from 'zlib';

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** @param {Uint16Array} samples length width*height, row-major */
export function encodeGray16(samples, width, height) {
  if (samples.length !== width * height) throw new Error('sample count mismatch');
  const stride = width * 2;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const off = y * (stride + 1);
    raw[off] = 0;                       // filter: None
    for (let x = 0; x < width; x++) {
      const v = samples[y * width + x];
      raw[off + 1 + x * 2] = (v >>> 8) & 0xff;   // big-endian
      raw[off + 2 + x * 2] = v & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 16;   // bit depth
  ihdr[9] = 0;    // colour type: grayscale
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Decode a 16-bit grayscale PNG written by encodeGray16 (used by verify.mjs). */
export function decodeGray16(buf) {
  let p = 8, width = 0, height = 0, bitDepth = 0, colourType = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colourType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bitDepth !== 16 || colourType !== 0) throw new Error(`not 16-bit grayscale (depth ${bitDepth}, type ${colourType})`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 2;
  const out = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) {
    const off = y * (stride + 1);
    if (raw[off] !== 0) throw new Error(`unexpected filter ${raw[off]} on row ${y}`);
    for (let x = 0; x < width; x++) out[y * width + x] = (raw[off + 1 + x * 2] << 8) | raw[off + 2 + x * 2];
  }
  return { data: out, width, height, bitDepth, colourType };
}
