/* make-favicon.js — box-downsample a PNG to <size> and write RGBA PNG.
   Usage: node scripts/make-favicon.js <in.png> <out.png> <size> */
const fs = require('fs');
const zlib = require('zlib');
const { decode } = require('./png-probe');

const [,, inPath, outPath, sizeArg] = process.argv;
const size = parseInt(sizeArg || '96', 10);
const { w, h, px } = decode(inPath);

const out = Buffer.alloc(size * size * 4);
const sx = w / size, sy = h / size;
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    // box sample: average the source area
    const x0 = Math.floor(x * sx), x1 = Math.max(x0, Math.floor((x + 1) * sx) - 1);
    const y0 = Math.floor(y * sy), y1 = Math.max(y0, Math.floor((y + 1) * sy) - 1);
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const o = (yy * w + xx) * 4;
        const al = px[o + 3] / 255;
        r += px[o] * al; g += px[o + 1] * al; b += px[o + 2] * al; a += al; n++;
      }
    }
    const o = (y * size + x) * 4;
    const na = (a / n) * 255;
    if (na > 0) {
      out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a;
    }
    out[o + 3] = Math.round(na);
  }
}

const crcTable = [];
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); crcTable[n] = c >>> 0; }
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; out.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${size}x${size}, ${png.length} bytes)`);
