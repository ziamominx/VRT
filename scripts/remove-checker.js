/* remove-checker.js — removes the baked-in light checkerboard background
   from a logo PNG, keeping logo pixels untouched.

   Method: 4-connected flood fill from the image border. A pixel counts as
   background when it is light (luminance >= 232) and near-neutral, which
   matches both checker tones (~254 white and ~241 gray). Logo whites are
   enclosed by dark strokes so the flood never reaches them.
   A soft alpha feather is applied to the antialiased rim between the
   checker and the logo so no light halo survives on dark pages.

   Usage: node scripts/remove-checker.js <in.png> <out.png>
*/
const fs = require('fs');
const zlib = require('zlib');
const { decode } = require('./png-probe');

const [,, inPath, outPath] = process.argv;
if (!inPath || !outPath) { console.error('usage: node scripts/remove-checker.js <in.png> <out.png>'); process.exit(1); }

const { w, h, px } = decode(inPath);
console.log(`decoded ${w}x${h}`);

// ---- identify background via border flood fill ----
const removed = new Uint8Array(w * h); // 1 = checker background
const isBg = (o) => {
  const r = px[o], g = px[o + 1], b = px[o + 2];
  const lum = (r * 299 + g * 587 + b * 114) / 1000;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  return lum >= 232 && spread <= 18;
};
const stack = [];
for (let x = 0; x < w; x++) { [0, h - 1].forEach(y => { const o = (y * w + x) * 4; if (isBg(o)) { const i = y * w + x; if (!removed[i]) { removed[i] = 1; stack.push(i); } } }); }
for (let y = 0; y < h; y++) { [0, w - 1].forEach(x => { const o = (y * w + x) * 4; if (isBg(o)) { const i = y * w + x; if (!removed[i]) { removed[i] = 1; stack.push(i); } } }); }

while (stack.length) {
  const i = stack.pop();
  const x = i % w, y = (i / w) | 0;
  const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
  for (const [nx, ny] of nb) {
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const ni = ny * w + nx;
    if (removed[ni]) continue;
    if (isBg(ni * 4)) { removed[ni] = 1; stack.push(ni); }
  }
}

let removedCount = 0;
for (let i = 0; i < w * h; i++) if (removed[i]) removedCount++;
console.log(`removed ${removedCount} bg pixels (${(removedCount / (w * h) * 100).toFixed(1)}%)`);

// ---- apply alpha: full for logo, feathered rim next to removed bg ----
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = y * w + x, o = i * 4;
    if (removed[i]) { px[o + 3] = 0; continue; }
    // rim pixel? (any 4-neighbour removed)
    let rim = false;
    const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of nb) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (removed[ny * w + nx]) { rim = true; break; }
    }
    if (rim) {
      const r = px[o], g = px[o + 1], b = px[o + 2];
      const lum = (r * 299 + g * 587 + b * 114) / 1000;
      // Pure-bright edge (white logo strokes) blends invisibly with the
      // near-white checker — keep it fully opaque. Mid tones are the
      // antialiased halo and get feathered toward transparent.
      if (lum >= 235) continue;
      if (lum >= 100) {
        px[o + 3] = Math.max(0, Math.min(255, Math.round((250 - lum) * 1.8)));
      }
    }
  }
}

// ---- encode RGBA PNG (filter 0 rows) ----
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const raw = Buffer.alloc((w * 4 + 1) * h);
for (let y = 0; y < h; y++) {
  raw[y * (w * 4 + 1)] = 0;
  px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${png.length} bytes)`);
