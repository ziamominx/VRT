/* png-probe.js — correct, minimal PNG decoder (8-bit, color types 0/2/3/6)
   Used to reliably inspect an image's background & colors. */
const fs = require('fs');
const zlib = require('zlib');

function decode(path) {
  const b = fs.readFileSync(path);
  let off = 8, w = 0, h = 0, ct = 0, bd = 0;
  const idat = [];
  let plte = null;
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('ascii', off + 4, off + 8);
    if (type === 'IHDR') { w = b.readUInt32BE(off + 8); h = b.readUInt32BE(off + 12); bd = b[off + 16]; ct = b[off + 17]; }
    else if (type === 'PLTE') plte = b.slice(off + 8, off + 8 + len);
    else if (type === 'IDAT') idat.push(b.slice(off + 8, off + 8 + len));
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = ct === 6 ? 4 : (ct === 2 ? 3 : 1);
  const stride = w * bpp + 1;
  const px = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(w * bpp); // reconstructed previous row

  for (let y = 0; y < h; y++) {
    const row = raw.slice(y * stride, (y + 1) * stride);
    const f = row[0];
    const recon = Buffer.alloc(w * bpp);
    for (let i = 0; i < w * bpp; i++) {
      const cur = row[1 + i];
      const a = prev[i] || 0;
      const bb = i >= bpp ? recon[i - bpp] : 0;
      const c = i >= bpp ? (prev[i - bpp] || 0) : 0;
      let v;
      switch (f) {
        case 0: v = cur; break;
        case 1: v = cur + bb; break; // Sub: + left
        case 2: v = cur + a; break;  // Up: + above
        case 3: v = cur + ((a + bb) >> 1); break;
        case 4: {
          const p = a + bb - c, pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c);
          v = cur + (pa <= pb && pa <= pc ? a : (pb <= pc ? bb : c));
          break;
        }
        default: v = cur;
      }
      recon[i] = v & 255;
    }
    prev = recon;
    // write RGBA
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (ct === 6) { for (let c2 = 0; c2 < 4; c2++) px[o + c2] = recon[x * 4 + c2]; }
      else if (ct === 2) { px[o] = recon[x * 3]; px[o + 1] = recon[x * 3 + 1]; px[o + 2] = recon[x * 3 + 2]; px[o + 3] = 255; }
      else if (ct === 3) { const i3 = recon[x] * 3; px[o] = plte[i3]; px[o + 1] = plte[i3 + 1]; px[o + 2] = plte[i3 + 2]; px[o + 3] = 255; }
      else { px[o] = px[o + 1] = px[o + 2] = recon[x]; px[o + 3] = 255; }
    }
  }
  return { w, h, ct, px };
}

module.exports = { decode };

if (require.main !== module) return;

const { w, h, ct, px } = decode(process.argv[2]);
const at = (x, y) => { const o = (Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))) * 4; return [px[o], px[o + 1], px[o + 2], px[o + 3]]; };
console.log(`size ${w}x${h} colorType ${ct}`);

// corners + edges (several px deep to survive antialiasing)
const spots = {
  'TL(8,8)': at(8, 8), 'TR(w-9,8)': at(w - 9, 8), 'BL(8,h-9)': at(8, h - 9), 'BR(w-9,h-9)': at(w - 9, h - 9),
  'TL(40,40)': at(40, 40), 'TR(w-41,40)': at(w - 41, 40), 'BL(40,h-41)': at(40, h - 41), 'BR(w-41,h-41)': at(w - 41, h - 41),
  'center': at(w / 2, h / 2)
};
for (const k in spots) console.log(' ', k, spots[k].join(','));

// most frequent colors over a coarse sample of the full canvas
const freq = new Map();
for (let y = 0; y < h; y += 6) for (let x = 0; x < w; x += 6) {
  const o = (y * w + x) * 4; const k = px[o] + ',' + px[o + 1] + ',' + px[o + 2] + ',' + px[o + 3];
  freq.set(k, (freq.get(k) || 0) + 1);
}
const top = [...freq.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 8);
console.log('top colors (sample every 6px):');
for (const [k, n] of top) console.log('  rgba(' + k + ')  x' + n);

// run along row 20 (inside any border) to look for a checker/banding pattern
const run = [];
for (let x = 0; x < w && run.length < 32; x += Math.max(1, Math.floor(w / 64))) run.push(at(x, 20).slice(0, 3).join(','));
console.log('row20 sample:', run.join(' | '));

// luminance distribution of the whole image
let dark = 0, light = 0, mid = 0, trans = 0;
for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) {
  const o = (y * w + x) * 4;
  if (px[o + 3] < 10) { trans++; continue; }
  const lum = (px[o] * 299 + px[o + 1] * 587 + px[o + 2] * 114) / 1000;
  if (lum < 40) dark++; else if (lum > 215) light++; else mid++;
}
console.log(`pixel tone: dark ${dark}  light ${light}  mid ${mid}  transparent ${trans}`);
