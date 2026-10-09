/* =====================================================================
   Multi-camera sync — line up two or three phone recordings of the same service by their sound.
   1. rough: the "loudness changes" of each recording (100 per second) are compared at every offset (FFT)
   2. exact: around that offset the actual sound is compared again, to well under one video frame
   ===================================================================== */
const { ipcMain } = require('electron');

function fft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
const SR = 4000, ER = 100;   // sound samples per second, envelope values per second
// "how fast is the loudness changing" — survives different phones, distances and volume
function envelope(x) {
  const hop = SR / ER, n = Math.floor(x.length / hop), e = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < hop; j++) { const v = x[i * hop + j]; s += v * v; } const l = Math.log(1e-6 + s / hop); e[i] = Math.max(0, l - prev); prev = l; }
  let m = 0; for (const v of e) m += v; m /= n || 1; let sd = 0; for (const v of e) sd += (v - m) ** 2; sd = Math.sqrt(sd / (n || 1)) || 1;
  for (let i = 0; i < n; i++) e[i] = (e[i] - m) / sd;
  return e;
}
// best lag L (in samples) so that b[i + L] ≈ a[i]
function xcorr(a, b, maxLag) {
  let N = 1; while (N < a.length + b.length) N <<= 1;
  const ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N);
  ar.set(a); br.set(b); fft(ar, ai); fft(br, bi);
  for (let k = 0; k < N; k++) { const r = br[k] * ar[k] + bi[k] * ai[k], i = bi[k] * ar[k] - br[k] * ai[k]; ar[k] = r; ai[k] = i; }   // B · conj(A)
  fft(ar, ai, true);
  let best = 0, bv = -Infinity, second = -Infinity;
  const score = [];
  for (let L = -maxLag; L <= maxLag; L++) { const v = ar[(L + N) % N]; score.push([L, v]); if (v > bv) { bv = v; best = L; } }
  for (const [L, v] of score) if (Math.abs(L - best) > 50 && v > second) second = v;
  return { lag: best, conf: second > 0 ? bv / second : 9 };
}

module.exports = function initMulticam({ ff, probe, reframe, getWin, CACHE }) {
  const send = (ch, x) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, x); };
  async function pcm(file, from = 0, dur = 0) {
    const args = ['-hide_banner', '-loglevel', 'error'];
    if (from) args.push('-ss', from.toFixed(3)); if (dur) args.push('-t', dur.toFixed(3));
    args.push('-i', file, '-vn', '-ac', '1', '-ar', String(SR), '-af', 'highpass=f=120,lowpass=f=1800', '-f', 'f32le', 'pipe:1');
    const r = await ff(args); const n = Math.floor(r.out.length / 4);
    return new Float32Array(r.out.buffer.slice(r.out.byteOffset, r.out.byteOffset + n * 4));
  }
  // offsets: how many seconds into each file the same moment happens, compared to the first file
  async function sync(files) {
    const infos = [], env = [];
    for (let i = 0; i < files.length; i++) {
      send('mc:progress', { step: 'listen', i, n: files.length });
      const info = await probe(files[i]); if (!info.hasAudio) throw new Error(`“${files[i].split(/[\\/]/).pop()}” has no sound, so it cannot be lined up`);
      infos.push(info); env.push(envelope(await pcm(files[i])));
    }
    const out = [{ off: 0, conf: 9 }];
    for (let i = 1; i < files.length; i++) {
      send('mc:progress', { step: 'match', i, n: files.length });
      const maxLag = Math.max(env[0].length, env[i].length);
      const r = xcorr(env[0], env[i], maxLag);       // env[i][k + lag] ≈ env[0][k]  → file i is "lag" ahead
      let off = r.lag / ER;
      // exact: compare the real sound around the middle of the overlap, ±60 ms
      try {
        const ov0 = Math.max(0, -off), ov1 = Math.min(infos[0].dur, infos[i].dur - off), mid = (ov0 + ov1) / 2, win = Math.min(40, (ov1 - ov0) * .8);
        if (win > 4) {
          const a = await pcm(files[0], Math.max(0, mid - win / 2), win), b = await pcm(files[i], Math.max(0, mid - win / 2 + off - .1), win + .2);
          let best = 0, bv = -Infinity; const base = Math.round(.1 * SR), step = 1;
          for (let L = -Math.round(.06 * SR); L <= Math.round(.06 * SR); L += step) {
            let s = 0; for (let k = 0; k < a.length; k += 2) { const j = k + base + L; if (j >= 0 && j < b.length) s += a[k] * b[j]; }
            if (s > bv) { bv = s; best = L; }
          }
          off += best / SR;
        }
      } catch {}
      out.push({ off: +off.toFixed(4), conf: +r.conf.toFixed(2) });
    }
    // the stretch where every camera was recording
    const t0 = Math.max(...out.map(o => -o.off), 0), t1 = Math.min(...out.map((o, i) => infos[i].dur - o.off));
    return { cams: files.map((f, i) => ({ path: f, off: out[i].off, conf: out[i].conf, dur: infos[i].dur, w: infos[i].w, h: infos[i].h })), start: t0, end: t1 };
  }
  // how "good" each camera looks over time: a big face that is talking scores high (for automatic switching)
  async function activity(file, a, b, id) {
    const d = await reframe.track(file, a, b, p => send('mc:progress', { step: 'look', id, p }));
    return reframe.samplesIn(d, a, b).map(s => {
      const f = s.faces.slice().sort((x, y) => y.w - x.w)[0];
      return { t: s.t, face: f ? +f.w.toFixed(3) : 0, n: s.faces.length, mar: f ? f.mar : 0 };
    });
  }
  // the camera whose sound is used for the whole video becomes its own sound file (so picture and sound play independently)
  ipcMain.handle('mc:extractAudio', async (_, file) => {
    try {
      const fs = require('fs'), path = require('path'), crypto = require('crypto'), st = fs.statSync(file);
      const dir = path.join(CACHE, 'multicam'); fs.mkdirSync(dir, { recursive: true });
      const out = path.join(dir, path.basename(file).replace(/\.[^.]+$/, '') + ' sound ' + crypto.createHash('md5').update(file + st.size + st.mtimeMs).digest('hex').slice(0, 6) + '.m4a');
      if (!fs.existsSync(out)) { const r = await ff(['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vn', '-c:a', 'aac', '-b:a', '192k', out]); if (r.code !== 0) throw new Error('Could not take the sound out of that video'); }
      return { path: out };
    } catch (e) { return { error: e.message }; }
  });
  ipcMain.handle('mc:sync', async (_, files) => { try { return await sync(files); } catch (e) { return { error: e.message }; } });
  ipcMain.handle('mc:activity', async (_, file, a, b, id) => { try { return await activity(file, a, b, id); } catch (e) { return { error: e.message }; } });
  return { sync };
};
module.exports.envelope = envelope; module.exports.xcorr = xcorr;
