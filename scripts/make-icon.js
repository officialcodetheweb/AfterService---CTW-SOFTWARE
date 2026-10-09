// Generates build/icon.png, build/icon.ico, build/preset.ico (file icon for .aspreset) and build/installerSidebar.bmp (no dependencies)
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const out = path.join(__dirname, '..', 'build'); fs.mkdirSync(out, { recursive: true });
function px(u, v) {
  const cx = u - .5, cy = v - .5, hs = .46, rad = .2;
  const qx = Math.abs(cx) - (hs - rad), qy = Math.abs(cy) - (hs - rad);
  const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
  if (sd > 0) return [0, 0, 0, 0];
  let c = [36 + (14 - 36) * v, 24 + (10 - 24) * v, 14 + (8 - 14) * v];
  const d = Math.hypot(cx, cy), g = Math.max(0, 1 - d / .5) ** 2 * .35;
  c = c.map((x, i) => x + ([255, 138, 31][i] - x) * g);
  const ring = Math.abs(d - .33) < .02;
  const cross = (Math.abs(cx) < .035 && cy > -.2 && cy < .2) || (Math.abs(cy + .05) < .033 && Math.abs(cx) < .12);
  if (ring || cross) c = [255, 150, 40];
  return [c[0], c[1], c[2], 255];
}
function render(size, fn = px) {
  const buf = Buffer.alloc(size * size * 4), S = 3;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const p = fn((x + (i + .5) / S) / size, (y + (j + .5) / S) / size);
      r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]; a += p[3];
    }
    const o = (y * size + x) * 4;
    if (a > 0) { buf[o] = r / a; buf[o + 1] = g / a; buf[o + 2] = b / a; buf[o + 3] = a / (S * S); }
  }
  return buf;
}
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); }
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const h = Buffer.alloc(13); h.writeUInt32BE(size, 0); h.writeUInt32BE(size, 4); h[8] = 8; h[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', h), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Preset document icon: a page with a folded corner, orange adjustment sliders and the After Service mark
function presetPx(u, v) {
  const L = .16, R = .84, T = .06, B = .94, fold = .2;
  const inPage = u > L && u < R && v > T && v < B && !(u > R - fold && v < T + fold && (u - (R - fold)) > (v - T));
  const onFold = u > R - fold && v < T + fold && (u - (R - fold)) <= (v - T) && u < R && v > T;
  if (!inPage && !onFold) return [0, 0, 0, 0];
  if (onFold) return [255, 179, 92, 255];
  const edge = Math.min(u - L, R - u, v - T, B - v) < .025 || ((u - (R - fold)) > (v - T) - .035 && u > R - fold - .02 && v < T + fold + .02);
  if (edge) return [255, 138, 31, 255];
  let c = [40 - 22 * v, 28 - 16 * v, 18 - 10 * v];
  const rows = [[.40, .62], [.55, .36], [.70, .55]];
  for (const [y, k] of rows) {
    if (Math.abs(v - y) < .018 && u > .27 && u < .73) c = u < k ? [255, 150, 40] : [90, 70, 52];
    if (Math.hypot(u - k, v - y) < .045) c = [255, 255, 255];
  }
  const cx = u - .5, cy = v - .2, d = Math.hypot(cx, cy);
  if (Math.abs(d - .075) < .012 || (Math.abs(cx) < .011 && Math.abs(cy) < .05) || (Math.abs(cy + .012) < .011 && Math.abs(cx) < .032)) c = [255, 150, 40];
  return [c[0], c[1], c[2], 255];
}
function ico(fn, sizes = [16, 24, 32, 48, 64, 128, 256]) {
  const imgs = sizes.map(s => png(s, render(s, fn))), head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4); let off = head.length;
  sizes.forEach((s, i) => { const o = 6 + 16 * i; head[o] = s >= 256 ? 0 : s; head[o + 1] = s >= 256 ? 0 : s; head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6); head.writeUInt32LE(imgs[i].length, o + 8); head.writeUInt32LE(off, o + 12); off += imgs[i].length; });
  return Buffer.concat([head, ...imgs]);
}
// After Service Player icon: orange disc with a play triangle and sound bars
function playerPx(u, v) {
  const cx = u - .5, cy = v - .5, hs = .46, rad = .22;
  const qx = Math.abs(cx) - (hs - rad), qy = Math.abs(cy) - (hs - rad);
  if (Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad > 0) return [0, 0, 0, 0];
  let c = [32 - 16 * v, 22 - 12 * v, 13 - 7 * v];
  const d = Math.hypot(cx + .08, cy);
  if (d < .3) { const t = d / .3; c = [255 - 30 * t, 160 - 60 * t, 60 - 40 * t]; }
  const px = u - .34, py = v - .5;   // play triangle inside the disc
  if (px > 0 && px < .2 && Math.abs(py) < (.2 - px) * .62) c = [28, 13, 0];
  const bars = [[.76, .1], [.84, .18], [.92, .12]];
  for (const [bx, bh] of bars) if (Math.abs(u - bx) < .022 && Math.abs(v - .5) < bh) c = [255, 179, 92];
  return [c[0], c[1], c[2], 255];
}
// Converter icon: orange tile with two swap arrows
function convPx(u, v) {
  const cx = u - .5, cy = v - .5, hs = .46, rad = .22;
  const qx = Math.abs(cx) - (hs - rad), qy = Math.abs(cy) - (hs - rad);
  if (Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad > 0) return [0, 0, 0, 0];
  const t = (u + v) / 2; let c = [255 - 40 * t, 179 - 90 * t, 92 - 80 * t];
  const ink = [28, 13, 0], w = .045;
  const seg = (x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1, k = Math.max(0, Math.min(1, ((u - x1) * dx + (v - y1) * dy) / (dx * dx + dy * dy))); return Math.hypot(u - x1 - k * dx, v - y1 - k * dy) < w; };
  if (seg(.24, .36, .74, .36) || seg(.74, .36, .6, .22) || seg(.76, .64, .26, .64) || seg(.26, .64, .4, .78)) c = ink;
  return [c[0], c[1], c[2], 255];
}
fs.writeFileSync(path.join(out, 'converter.ico'), ico(convPx));
fs.writeFileSync(path.join(out, 'icon.png'), png(512, render(512)));
fs.writeFileSync(path.join(out, 'player.ico'), ico(playerPx));
const assets = path.join(__dirname, '..', 'assets'); fs.mkdirSync(assets, { recursive: true });
fs.writeFileSync(path.join(assets, 'icon.png'), png(256, render(256)));
fs.writeFileSync(path.join(assets, 'player.png'), png(256, render(256, playerPx)));
fs.writeFileSync(path.join(assets, 'converter.png'), png(256, render(256, convPx)));
fs.writeFileSync(path.join(assets, 'player-tray.png'), png(32, render(32, playerPx)));
fs.writeFileSync(path.join(out, 'icon.ico'), ico(px));
fs.writeFileSync(path.join(out, 'preset.ico'), ico(presetPx));
fs.writeFileSync(path.join(out, 'preset.png'), png(256, render(256, presetPx)));
const W = 164, H = 314, logo = render(120), px24 = Buffer.alloc(W * 3 * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let c = [27 + (8 - 27) * y / H, 36 + (11 - 36) * y / H, 64 + (20 - 64) * y / H];
  const lx = x - 22, ly = y - 40;
  if (lx >= 0 && lx < 120 && ly >= 0 && ly < 120) { const o = (ly * 120 + lx) * 4, a = logo[o + 3] / 255; c = [0, 1, 2].map(i => c[i] * (1 - a) + logo[o + i] * a); }
  const o = ((H - 1 - y) * W + x) * 3; px24[o] = c[2]; px24[o + 1] = c[1]; px24[o + 2] = c[0];
}
const bh = Buffer.alloc(54); bh.write('BM'); bh.writeUInt32LE(54 + px24.length, 2); bh.writeUInt32LE(54, 10); bh.writeUInt32LE(40, 14);
bh.writeInt32LE(W, 18); bh.writeInt32LE(H, 22); bh.writeUInt16LE(1, 26); bh.writeUInt16LE(24, 28); bh.writeUInt32LE(px24.length, 34);
fs.writeFileSync(path.join(out, 'installerSidebar.bmp'), Buffer.concat([bh, px24]));
console.log('Icons generated in build/');
