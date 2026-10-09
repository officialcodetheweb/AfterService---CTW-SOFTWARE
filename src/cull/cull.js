/* =====================================================================
   After Service — photo checker (runs in a hidden window, fully offline)
   For every picture it measures:
     • sharpness   — how crisp the sharpest parts are (Laplacian variance per tile) and how crisp each face is
     • exposure    — too dark / blown out
     • fingerprint — a tiny "look" of the picture to find duplicates and near-identical burst shots
     • faces/eyes  — face landmarks (Human, MIT licence) → how open each eye is (eye aspect ratio)
   ===================================================================== */
import { Human } from './vendor/human.esm.js';

const CONFIG = {
  modelBasePath: './vendor/models/', wasmPath: new URL('./vendor/', location.href).href, wasmPlatformFetch: false, debug: false, async: true, warmup: 'none', cacheSensitivity: 0, filter: { enabled: false },
  face: {
    enabled: true,
    detector: { modelPath: 'blazeface.json', rotation: true, maxDetected: 25, minConfidence: 0.35, skipFrames: 0, skipTime: 0, return: false, iouThreshold: 0.1 },
    mesh: { enabled: true, modelPath: 'facemesh.json' },
    iris: { enabled: true, modelPath: 'iris.json', skipFrames: 0, skipTime: 0 },
    emotion: { enabled: false }, description: { enabled: false }, antispoof: { enabled: false }, liveness: { enabled: false }, attention: { enabled: false }, gear: { enabled: false }
  },
  body: { enabled: false }, hand: { enabled: false }, object: { enabled: false }, segmentation: { enabled: false }, gesture: { enabled: true }
};
let human = null, backend = '';

async function init() {
  let err = null; const tried = [];
  // Only try the graphics card when it really answers — a failed WebGL start makes tfjs try the
  // other engines on its own (from the wrong place), which would then refuse to start properly.
  let gl = false; try { const c = new OffscreenCanvas(8, 8); gl = !!(c.getContext('webgl2') || c.getContext('webgl')); } catch {}
  for (const b of gl ? ['webgl', 'wasm', 'cpu'] : ['wasm', 'cpu']) {
    try {
      const h = new Human({ ...CONFIG, backend: b });
      try { h.tf.setWasmPaths(CONFIG.wasmPath); } catch {}     // before any engine starts, so the WebAssembly files are found
      await h.load(); await h.tf.ready();
      if (h.tf.getBackend() !== b && b !== 'cpu') throw new Error('backend ' + b + ' unavailable');
      human = h; backend = h.tf.getBackend(); break;
    } catch (e) { err = e; tried.push(b + ': ' + String(e && e.message || e)); }
  }
  cullHost.ready({ ok: !!human, backend, tried, error: human ? null : String(err && err.message || err) });
}

/* ---------- measurements ---------- */
function grayOf(d, n) { const g = new Float32Array(n); for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = d[j] * .299 + d[j + 1] * .587 + d[j + 2] * .114; return g; }
// Laplacian variance of a rectangle, on a lightly smoothed copy so sensor noise does not look like detail
function lapVar(g, W, x0, y0, x1, y1) {
  let s = 0, s2 = 0, n = 0;
  x0 = Math.max(2, x0 | 0); y0 = Math.max(2, y0 | 0); x1 = Math.min(W - 2, x1 | 0); y1 = Math.min(((g.length / W) | 0) - 2, y1 | 0);
  for (let y = y0; y < y1; y++) {
    const r = y * W;
    for (let x = x0; x < x1; x++) {
      const i = r + x, v = g[i - 1] + g[i + 1] + g[i - W] + g[i + W] - 4 * g[i];
      s += v; s2 += v * v; n++;
    }
  }
  return n ? s2 / n - (s / n) ** 2 : 0;
}
function smooth(g, W, H) { // 3x3 box blur
  const o = new Float32Array(g.length);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    o[i] = (g[i - W - 1] + g[i - W] + g[i - W + 1] + g[i - 1] + g[i] + g[i + 1] + g[i + W - 1] + g[i + W] + g[i + W + 1]) / 9;
  }
  return o;
}
function tileVar(g, W, x0, y0, x1, y1) { let s = 0, s2 = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const v = g[y * W + x]; s += v; s2 += v * v; n++; } return n ? s2 / n - (s / n) ** 2 : 0; }
// sharp  = detail in the crispest 10% of the picture (raw)
// sharpN = the same detail divided by local contrast, so dark or low-contrast photos are not mistaken for blurry
function sharpness(g, W, H) {
  const T = 64, tiles = [];
  for (let y = 0; y + T <= H; y += T) for (let x = 0; x + T <= W; x += T) { const l = lapVar(g, W, x, y, x + T, y + T), v = tileVar(g, W, x, y, x + T, y + T); tiles.push({ l, r: l / (v + 12) }); }
  tiles.sort((a, b) => b.l - a.l);
  const top = tiles.slice(0, Math.max(1, Math.round(tiles.length * .1)));
  return { sharp: top.reduce((a, t) => a + t.l, 0) / top.length, sharpN: +(100 * top.reduce((a, t) => a + t.r, 0) / top.length).toFixed(2), sharpAll: lapVar(g, W, 0, 0, W, H) };
}
function exposure(d, n) {
  let sum = 0, dark = 0, hi = 0;
  for (let j = 0; j < n * 4; j += 4) { const l = d[j] * .299 + d[j + 1] * .587 + d[j + 2] * .114; sum += l; if (l < 22) dark++; if (d[j] > 250 && d[j + 1] > 250 && d[j + 2] > 250) hi++; }
  return { lum: sum / n, pDark: dark / n, pClip: hi / n };
}
// area-averaged tiny versions: 9x8 gray for dHash, 8x8 colour for "same scene" check
function tiny(d, W, H, tw, th) {
  const out = new Float32Array(tw * th * 3), cnt = new Float32Array(tw * th);
  for (let y = 0; y < H; y++) { const ty = Math.min(th - 1, (y * th / H) | 0); for (let x = 0; x < W; x++) { const tx = Math.min(tw - 1, (x * tw / W) | 0), k = ty * tw + tx, j = (y * W + x) * 4; out[k * 3] += d[j]; out[k * 3 + 1] += d[j + 1]; out[k * 3 + 2] += d[j + 2]; cnt[k]++; } }
  for (let k = 0; k < tw * th; k++) for (let c = 0; c < 3; c++) out[k * 3 + c] /= cnt[k] || 1;
  return out;
}
function dhash(d, W, H) {
  const t = tiny(d, W, H, 9, 8); let bits = '';
  const L = k => t[k * 3] * .299 + t[k * 3 + 1] * .587 + t[k * 3 + 2] * .114;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += L(y * 9 + x) > L(y * 9 + x + 1) ? '1' : '0';
  let hex = ''; for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// eye aspect ratio: eyelid opening ÷ eye width (≈0.3 open, <0.15 closed)
function ear(mesh, [p1, p2, p3, p4, p5, p6]) { const w = dist(mesh[p1], mesh[p4]); return w > 0 ? (dist(mesh[p2], mesh[p6]) + dist(mesh[p3], mesh[p5])) / (2 * w) : 0; }
const LEFT = [33, 160, 158, 133, 153, 144], RIGHT = [362, 385, 387, 263, 373, 380];

async function analyze(job) {
  const t0 = performance.now();
  const bmp = await createImageBitmap(new Blob([job.jpeg], { type: 'image/jpeg' }));
  const W = bmp.width, H = bmp.height, cv = new OffscreenCanvas(W, H), cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0); bmp.close();
  const img = cx.getImageData(0, 0, W, H), d = img.data, n = W * H;
  const g = smooth(grayOf(d, n), W, H);
  const res = { id: job.id, w: W, h: H, ...sharpness(g, W, H), ...exposure(d, n), hash: dhash(d, W, H), look: Array.from(tiny(d, W, H, 8, 8), v => Math.round(v)), faces: [] };
  res.tMeasure = Math.round(performance.now() - t0); res.backend = backend;
  if (human) {
    try {
      const r = await human.detect(cv);
      const blinks = new Map(); (r.gesture || []).forEach(x => { if (x.face != null && /blink/.test(x.gesture)) blinks.set(x.face, (blinks.get(x.face) || 0) + 1); });
      for (const f of r.face || []) {
        const [x, y, w, h] = f.box; if (!f.mesh || f.mesh.length < 468) continue;
        const rot = (f.rotation && f.rotation.angle) || {};
        res.faces.push({
          box: [x / W, y / H, w / W, h / H], score: +(f.faceScore || f.score || 0).toFixed(3),
          earL: +ear(f.mesh, LEFT).toFixed(3), earR: +ear(f.mesh, RIGHT).toFixed(3),
          blink: blinks.get(f.id) || 0,
          yaw: +(rot.yaw || 0).toFixed(2), pitch: +(rot.pitch || 0).toFixed(2),
          sharp: +lapVar(g, W, x + w * .15, y + h * .15, x + w * .85, y + h * .85).toFixed(1),
          sharpN: +(100 * lapVar(g, W, x + w * .15, y + h * .15, x + w * .85, y + h * .85) / (tileVar(g, W, Math.max(0, x + w * .15 | 0), Math.max(0, y + h * .15 | 0), Math.min(W, x + w * .85 | 0), Math.min(H, y + h * .85 | 0)) + 12)).toFixed(2)
        });
      }
    } catch (e) { res.faceError = String(e.message || e); }
  }
  res.ms = Math.round(performance.now() - t0);
  return res;
}

/* ===================== Cut-outs (background removal) =====================
   MediaPipe Selfie segmentation (Apache 2.0) gives a soft person mask. To make it good enough for flyers:
   • every person (found by their face) is segmented in their own crop, so group photos work too
   • the mask edge is refined against the real photo with a guided filter (hair, shoulders follow the true edge) */
let hSeg = null, hDesc = null;
async function extra(kind) {
  const cfg = kind === 'seg'
    ? { ...CONFIG, backend, face: { enabled: false }, gesture: { enabled: false }, segmentation: { enabled: true, modelPath: 'selfie.json', mode: 'alpha' } }
    : { ...CONFIG, backend, gesture: { enabled: false }, face: { ...CONFIG.face, iris: { enabled: false }, description: { enabled: true, modelPath: 'faceres.json', skipFrames: 0, skipTime: 0 } } };
  const h = new Human(cfg); try { h.tf.setWasmPaths(CONFIG.wasmPath); } catch {} await h.load(); return h;
}
async function maskOf(canvas) {
  hSeg = hSeg || await extra('seg');
  const t = await hSeg.segmentation(canvas); if (!t) return null;
  const d = await t.data(); const [h, w] = t.shape; hSeg.tf.dispose(t);
  return { d, w, h };
}
function boxBlur(src, W, H, r) {           // mean filter via integral image
  const I = new Float64Array((W + 1) * (H + 1)), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += src[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; } }
  for (let y = 0; y < H; y++) { const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1); for (let x = 0; x < W; x++) { const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
    out[y * W + x] = (I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0]) / ((y1 - y0) * (x1 - x0)); } }
  return out;
}
function guided(I, p, W, H, r, eps) {
  const n = W * H, Ip = new Float32Array(n), II = new Float32Array(n);
  for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mI = boxBlur(I, W, H, r), mp = boxBlur(p, W, H, r), mIp = boxBlur(Ip, W, H, r), mII = boxBlur(II, W, H, r), a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = mII[i] - mI[i] * mI[i], c = mIp[i] - mI[i] * mp[i]; a[i] = c / (v + eps); b[i] = mp[i] - a[i] * mI[i]; }
  const ma = boxBlur(a, W, H, r), mb = boxBlur(b, W, H, r), q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}
async function segment(job) {
  const bmp = await createImageBitmap(new Blob([job.jpeg], { type: 'image/jpeg' }));
  const W = bmp.width, H = bmp.height, cv = new OffscreenCanvas(W, H), cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0); bmp.close();
  const full = new Float32Array(W * H);
  // people: find faces, segment each person in a generous crop around them
  let faces = [];
  if (human) { try { const r = await human.detect(cv); faces = (r.face || []).filter(f => f.score > .5 && f.box[2] > W * .035).sort((a, b) => b.box[2] - a.box[2]).slice(0, 8); } catch {} }
  const regions = faces.length && !(faces.length === 1 && faces[0].box[2] > W * .28)
    ? faces.map(f => { const [x, y, w, h] = f.box; const cw = w * 4.2, top = y - h * .9; return [Math.max(0, x + w / 2 - cw / 2), Math.max(0, top), Math.min(W, x + w / 2 + cw / 2), Math.min(H, top + Math.max(h * 7.5, cw * 1.3))]; })
    : [[0, 0, W, H]];
  for (const [x0, y0, x1, y1] of regions) {
    const cw = Math.round(x1 - x0), ch = Math.round(y1 - y0); if (cw < 16 || ch < 16) continue;
    const c2 = new OffscreenCanvas(cw, ch); c2.getContext('2d').drawImage(cv, x0, y0, cw, ch, 0, 0, cw, ch);
    const m = await maskOf(c2); if (!m) continue;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const gx = Math.round(x0) + x, gy = Math.round(y0) + y; if (gx >= W || gy >= H) continue;
      const v = m.d[Math.min(m.h - 1, Math.floor(y * m.h / ch)) * m.w + Math.min(m.w - 1, Math.floor(x * m.w / cw))] / 255;
      const i = gy * W + gx; if (v > full[i]) full[i] = v;
    }
  }
  // refine the edge with the photo itself as the guide
  const px = cx.getImageData(0, 0, W, H).data, I = new Float32Array(W * H);
  for (let i = 0, j = 0; i < W * H; i++, j += 4) I[i] = (px[j] * .299 + px[j + 1] * .587 + px[j + 2] * .114) / 255;
  const r = Math.max(4, Math.round(Math.max(W, H) / 220));
  const q = guided(I, full, W, H, r, 1e-3);
  const out = new ImageData(W, H), od = out.data, lo = job.lo ?? .3, hi = job.hi ?? .7;
  for (let i = 0, j = 0; i < W * H; i++, j += 4) { let a = (q[i] - lo) / (hi - lo); a = a < 0 ? 0 : a > 1 ? 1 : a * a * (3 - 2 * a); od[j] = od[j + 1] = od[j + 2] = 255; od[j + 3] = Math.round(a * 255); }
  const oc = new OffscreenCanvas(W, H); oc.getContext('2d').putImageData(out, 0, 0);
  const png = new Uint8Array(await (await oc.convertToBlob({ type: 'image/png' })).arrayBuffer());
  return { id: job.id, w: W, h: H, mask: png, people: faces.length, faces: faces.map(f => ({ box: [f.box[0] / W, f.box[1] / H, f.box[2] / W, f.box[3] / H], score: f.score })) };
}
/* ===================== Face fingerprints (for "people" groups) ===================== */
async function people(job) {
  hDesc = hDesc || await extra('desc');
  const bmp = await createImageBitmap(new Blob([job.jpeg], { type: 'image/jpeg' }));
  const W = bmp.width, H = bmp.height, cv = new OffscreenCanvas(W, H); cv.getContext('2d').drawImage(bmp, 0, 0); bmp.close();
  const r = await hDesc.detect(cv);
  return { id: job.id, w: W, h: H, faces: (r.face || []).filter(f => f.embedding && f.embedding.length && f.score > .5 && f.box[2] > W * .03).map(f => ({ box: [f.box[0] / W, f.box[1] / H, f.box[2] / W, f.box[3] / H], score: +f.score.toFixed(3), emb: Array.from(f.embedding, v => +v.toFixed(4)) })) };
}


// Auto-reframe / multi-camera: just the faces and how open each mouth is (who is talking), on a small frame
async function track(job) {
  const bmp = await createImageBitmap(new Blob([job.jpeg], { type: 'image/jpeg' }));
  const W = bmp.width, H = bmp.height, cv = new OffscreenCanvas(W, H); cv.getContext('2d').drawImage(bmp, 0, 0); bmp.close();
  const out = { id: job.id, w: W, h: H, faces: [] }; if (!human) return out;
  const r = await human.detect(cv);
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  for (const f of r.face || []) {
    const sc = f.faceScore || f.score || 0; if (sc < .45) continue;
    const m = f.mesh && f.mesh.length >= 468 ? f.mesh : null;
    const mar = m ? d(m[13], m[14]) / Math.max(1, d(m[78], m[308])) : 0;
    out.faces.push({ x: (f.box[0] + f.box[2] / 2) / W, y: (f.box[1] + f.box[3] / 2) / H, w: f.box[2] / W, h: f.box[3] / H, s: +sc.toFixed(2), mar: +mar.toFixed(3) });
  }
  return out;
}

let q = Promise.resolve();
const RUN = { analyze, segment, people, track };
cullHost.onJob(job => { q = q.then(() => (RUN[job.type || 'analyze'])(job).then(r => cullHost.result(r), e => cullHost.result({ id: job.id, error: String(e && e.message || e) }))); });
init();
