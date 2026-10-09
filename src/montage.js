/* =====================================================================
   Beat-synced montage (main process)
   - beats(song): finds the tempo and every beat of a song (offline, no internet)
   - a render session: the window draws each frame, we pipe them into ffmpeg with the song
   ===================================================================== */
const { ipcMain, dialog } = require('electron');
const path = require('path'), fs = require('fs');

/* ---------- small FFT (radix-2, in place) ---------- */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/* ---------- beat tracking (onset strength → tempo → dynamic programming, after Ellis 2007) ---------- */
function analyse(x, sr) {
  const N = 1024, hop = 256, nb = N / 2, frames = Math.max(0, Math.floor((x.length - N) / hop) + 1);
  if (frames < 50) throw new Error('This song is too short');
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = .5 - .5 * Math.cos(2 * Math.PI * i / N);
  const hiBin = Math.min(nb, Math.round(8000 / sr * N)), lowBin = Math.max(2, Math.round(160 / sr * N));
  const on = new Float32Array(frames), low = new Float32Array(frames), rms = new Float32Array(frames);
  let prev = new Float32Array(hiBin), cur = new Float32Array(hiBin);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = 0; i < N; i++) { const v = x[f * hop + i]; re[i] = v * win[i]; im[i] = 0; e += v * v; }
    rms[f] = Math.sqrt(e / N);
    fft(re, im);
    let flux = 0, lf = 0;
    for (let k = 1; k < hiBin; k++) {
      const m = Math.log1p(100 * Math.hypot(re[k], im[k])); cur[k] = m;
      const d = m - prev[k]; if (d > 0) { flux += d; if (k <= lowBin) lf += d; }
    }
    on[f] = f ? flux : 0; low[f] = f ? lf : 0;
    const t = prev; prev = cur; cur = t;
  }
  // remove the slow trend, keep the hits
  const fps = sr / hop, W = Math.round(fps * .4);
  const detrend = a => {
    const n = a.length, ps = new Float64Array(n + 1); for (let i = 0; i < n; i++) ps[i + 1] = ps[i] + a[i];
    const o = new Float32Array(n); let m = 0;
    for (let i = 0; i < n; i++) { const l = Math.max(0, i - W), r = Math.min(n, i + W + 1); o[i] = Math.max(0, a[i] - (ps[r] - ps[l]) / (r - l)); m += o[i]; }
    m /= n; let v = 0; for (let i = 0; i < n; i++) v += (o[i] - m) ** 2; const sd = Math.sqrt(v / n) || 1;
    for (let i = 0; i < n; i++) o[i] /= sd; return o;
  };
  const O = detrend(on), L = detrend(low);

  // tempo: autocorrelation of the onset curve, gently preferring ~120 BPM
  const minLag = Math.floor(fps * 60 / 200), maxLag = Math.ceil(fps * 60 / 55), span = Math.min(O.length, Math.round(fps * 90));
  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) { let s = 0; for (let i = lag; i < span; i++) s += O[i] * O[i - lag]; ac[lag] = s; }
  let best = minLag, bs = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) { const bpm = 60 * fps / lag, w = Math.exp(-.5 * (Math.log2(bpm / 120) / .9) ** 2), s = ac[lag] * w; if (s > bs) { bs = s; best = lag; } }
  const a0 = ac[best - 1], a1 = ac[best], a2 = ac[best + 1], dn = a0 - 2 * a1 + a2, shift = dn ? .5 * (a0 - a2) / dn : 0;
  const period = best + Math.max(-.5, Math.min(.5, shift)), bpm = 60 * fps / period;

  // dynamic programming: beats land on strong onsets AND keep a steady spacing
  const n = O.length, local = new Float32Array(n), P = period, K = Math.round(P);
  const gw = []; for (let k = -K; k <= K; k++) gw.push(Math.exp(-.5 * (k * 32 / P) ** 2));
  for (let i = 0; i < n; i++) { let s = 0; for (let k = -K; k <= K; k++) { const j = i + k; if (j >= 0 && j < n) s += gw[k + K] * O[j]; } local[i] = s; }
  const cum = new Float32Array(n), back = new Int32Array(n).fill(-1), lo = Math.round(2 * P), hi = Math.round(P / 2);
  for (let i = 0; i < n; i++) {
    let bv = -Infinity, bj = -1;
    for (let j = Math.max(0, i - lo); j <= i - hi; j++) { const v = cum[j] - 100 * Math.log((i - j) / P) ** 2; if (v > bv) { bv = v; bj = j; } }
    cum[i] = local[i] + (bj >= 0 ? Math.max(0, bv) : 0); back[i] = bv > 0 ? bj : -1;
  }
  const peaks = []; for (let i = 1; i < n - 1; i++) if (cum[i] >= cum[i - 1] && cum[i] >= cum[i + 1]) peaks.push(cum[i]);
  const med = peaks.slice().sort((a, b) => a - b)[peaks.length >> 1] || 0;
  let last = n - 1; for (let i = n - 2; i > 0; i--) if (cum[i] >= cum[i - 1] && cum[i] >= cum[i + 1] && cum[i] > .5 * med) { last = i; break; }
  const fr = []; for (let i = last; i >= 0; i = back[i]) { fr.push(i); if (back[i] < 0) break; }
  fr.reverse();
  // drop weak beats at the very start/end (silence, fade-outs)
  const lv = fr.map(f => local[f]), thr = .3 * (lv.slice().sort((a, b) => a - b)[lv.length >> 1] || 0);
  let a = 0, b = fr.length - 1; while (a < b && lv[a] < thr) a++; while (b > a && lv[b] < thr) b--;
  const keep = fr.slice(a, b + 1), t = f => (f * hop + N / 2) / sr;
  const beats = keep.map(t), strength = keep.map(f => +local[f].toFixed(3));
  const lowAt = keep.map(f => { let s = 0; for (let k = -2; k <= 2; k++) s += L[f + k] || 0; return +s.toFixed(3); });
  // loudness per beat (for "busy" vs "calm" parts)
  const loud = keep.map((f, i) => { const e = i + 1 < keep.length ? keep[i + 1] : Math.min(n, f + K); let s = 0, c = 0; for (let j = f; j < e; j++) { s += rms[j]; c++; } return c ? s / c : 0; });
  const lmax = Math.max(1e-6, ...loud);
  return { bpm: +bpm.toFixed(1), beats: beats.map(v => +v.toFixed(3)), strength, low: lowAt, loud: loud.map(v => +(v / lmax).toFixed(3)), dur: x.length / sr };
}

module.exports = function initMontage({ ff, root, getWin, stamp, log }) {
  const cache = new Map();
  async function beats(file) {
    const st = fs.statSync(file), key = file + '|' + st.mtimeMs;
    if (cache.has(key)) return cache.get(key);
    const sr = 22050;
    const r = await ff(['-hide_banner', '-loglevel', 'error', '-t', '400', '-i', file, '-vn', '-ac', '1', '-ar', String(sr), '-f', 'f32le', 'pipe:1']);
    const n = Math.floor(r.out.length / 4); if (n < sr) throw new Error('Could not read the sound in this song');
    const x = new Float32Array(r.out.buffer.slice(r.out.byteOffset, r.out.byteOffset + n * 4));
    const out = analyse(x, sr); cache.set(key, out); return out;
  }
  ipcMain.handle('montage:beats', async (_, file) => { try { return await beats(file); } catch (e) { return { error: e.message || String(e) }; } });
  ipcMain.handle('montage:pickPhotos', async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Choose photos for the montage', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Photos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }] });
    return r.canceled ? [] : r.filePaths;
  });

  /* ---------- render session: raw frames in → mp4 with the song out ---------- */
  const jobs = new Map(); let seq = 0;
  ipcMain.handle('montage:start', (_, o) => {
    const dir = path.join(root(), 'Exports', 'Beat montages'); fs.mkdirSync(dir, { recursive: true });
    const nice = String(o.name || 'Beat montage').replace(/[\\/:*?"<>|\r\n]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Beat montage';
    let out = path.join(dir, `${nice}.mp4`); for (let k = 2; fs.existsSync(out); k++) out = path.join(dir, `${nice} (${k}).mp4`);
    const fade = Math.min(2, o.dur / 4);
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-video_size', `${o.W}x${o.H}`, '-framerate', String(o.fps), '-i', 'pipe:0'];
    if (o.song) args.push('-ss', Math.max(0, o.songIn).toFixed(3), '-t', o.dur.toFixed(3), '-i', o.song);
    args.push('-map', '0:v');
    if (o.song) args.push('-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-af', `afade=t=in:d=0.03,afade=t=out:st=${Math.max(0, o.dur - fade).toFixed(3)}:d=${fade.toFixed(3)}`);
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(o.fps), '-t', o.dur.toFixed(3), '-movflags', '+faststart', out);
    const id = ++seq, J = { out, err: '', proc: null, done: null, dead: false };
    J.done = ff(args, { keep: p => { J.proc = p; p.stdin.on('error', () => {}); }, onErr: d => { J.err = (J.err + d).slice(-2000); } });
    jobs.set(id, J); return { id, out };
  });
  ipcMain.handle('montage:frame', (_, id, data) => new Promise(res => {
    const J = jobs.get(id); if (!J || !J.proc || J.dead) return res(false);
    const ok = J.proc.stdin.write(Buffer.from(data.buffer || data, data.byteOffset || 0, data.byteLength)); if (ok) res(true); else J.proc.stdin.once('drain', () => res(true));
  }));
  ipcMain.handle('montage:end', async (_, id) => {
    const J = jobs.get(id); if (!J) return { error: 'Nothing to finish' };
    try { J.proc.stdin.end(); } catch {}
    const r = await J.done; jobs.delete(id);
    if (r.code !== 0 || !fs.existsSync(J.out)) { try { fs.unlinkSync(J.out); } catch {} return { error: (J.err || r.err || 'The video could not be made').trim().split('\n').pop() }; }
    if (log) log({ kind: 'montage', path: J.out, label: path.basename(J.out, '.mp4') });
    return { file: J.out };
  });
  ipcMain.handle('montage:cancel', async (_, id) => {
    const J = jobs.get(id); if (!J) return true; J.dead = true;
    try { J.proc.kill(); } catch {} try { await J.done; } catch {} try { fs.unlinkSync(J.out); } catch {} jobs.delete(id); return true;
  });
  return { analyse, beats };
};
module.exports.analyse = analyse;
