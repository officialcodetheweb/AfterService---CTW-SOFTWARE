/* =====================================================================
   Auto-cull — main process
   Decodes each picture with ffmpeg (fast, rotation applied, 1024 px), hands it to the hidden
   photo-checker window, caches the measurements and makes the suggestions (cull-decide.js).
   Removing is always the user's choice: "Rejected" folder (undo) or the Recycle Bin.
   ===================================================================== */
const { app, BrowserWindow, ipcMain, protocol, shell } = require('electron');
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const { decide } = require('./cull-decide');
const { exifDate } = require('./heic-core');

const DIR = path.join(__dirname, 'cull');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.bin': 'application/octet-stream', '.wasm': 'application/wasm' };
const PIC = /\.(jpe?g|png|webp|bmp|heic|heif|tiff?)$/i;
const REJECT_DIR = 'Rejected';

function jpegExifDate(file) {
  try {
    const fd = fs.openSync(file, 'r'), b = Buffer.alloc(256 * 1024), n = fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd);
    if (b[0] !== 0xFF || b[1] !== 0xD8) return null;
    let o = 2;
    while (o + 4 < n && b[o] === 0xFF) {
      const m = b[o + 1], len = b.readUInt16BE(o + 2);
      if (m === 0xE1 && b.toString('latin1', o + 4, o + 10) === 'Exif\0\0') return exifDate(b.subarray(o + 10, Math.min(n, o + 2 + len)));
      if (m === 0xDA) break; o += 2 + len;
    }
  } catch {}
  return null;
}

module.exports = function initCull({ media, ff, UD, CACHE }) {
  /* the checker page is served from its own private scheme so its modules and model files load offline */
  protocol.handle('ascull', req => {
    try {
      const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, ''), file = path.normalize(path.join(DIR, rel));
      if (!file.startsWith(DIR + path.sep)) return new Response('no', { status: 403 });
      return new Response(fs.readFileSync(file), { headers: { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' } });
    } catch { return new Response('not found', { status: 404 }); }
  });

  const CACHE_FILE = path.join(UD, 'cull-cache.json'), THUMBS = path.join(CACHE, 'cull');
  let cache = {}; try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); if (cache.v !== 2) cache = { v: 2 }; } catch { cache = { v: 2 }; }
  let cacheDirty = false; const saveCache = () => { if (!cacheDirty) return; cacheDirty = false; try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch {} };

  let wkr = null, wkrReady = null, wkrInfo = null, idleT = null, waiting = new Map(), job = null, last = null;
  function worker() {
    clearTimeout(idleT);
    if (wkr && !wkr.isDestroyed()) return wkrReady;
    wkr = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { preload: path.join(DIR, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, devTools: !app.isPackaged } });
    wkrReady = new Promise(res => { const h = (e, info) => { if (e.sender === wkr.webContents) { ipcMain.removeListener('cull:ready', h); wkrInfo = info; res(info); } }; ipcMain.on('cull:ready', h); });
    wkr.on('closed', () => { wkr = null; for (const w of waiting.values()) w.rej(new Error('checker closed')); waiting.clear(); });
    wkr.webContents.on('render-process-gone', () => { try { wkr.destroy(); } catch {} });
    wkr.loadURL('ascull://app/cull.html');
    return wkrReady;
  }
  ipcMain.on('cull:result', (e, r) => { const w = waiting.get(r.id); if (w) { waiting.delete(r.id); w.res(r); } });
  function dispose() { clearTimeout(idleT); if (wkr && !wkr.isDestroyed()) wkr.destroy(); wkr = null; saveCache(); }
  const idle = () => { clearTimeout(idleT); idleT = setTimeout(dispose, 90 * 1000); };
  app.on('before-quit', dispose);

  const keyOf = (p, st) => p + '|' + st.size + '|' + Math.round(st.mtimeMs);
  const thumbOf = k => path.join(THUMBS, crypto.createHash('md5').update(k).digest('hex') + '.jpg');

  async function decode(file, thumb) {
    let src = file, tmp = null;
    if (/\.(heic|heif)$/i.test(file)) { tmp = path.join(THUMBS, 'heic_' + crypto.randomBytes(5).toString('hex') + '.jpg'); await media.heic(file, tmp, { format: 'JPEG', quality: .85 }); src = tmp; }
    const fc = "[0:v]scale=w='min(1024,iw)':h='min(1024,ih)':force_original_aspect_ratio=decrease,format=yuvj420p,split=2[a][b];[b]scale=w=360:h=360:force_original_aspect_ratio=decrease[t]";
    const r = await ff(['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-filter_complex', fc, '-map', '[a]', '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '2', 'pipe:1', '-map', '[t]', '-frames:v', '1', '-q:v', '4', thumb]);
    if (tmp) try { fs.unlinkSync(tmp); } catch {}
    if (!r.out || !r.out.length) throw new Error('could not read this picture');
    return r.out;
  }

  async function run(paths, onProgress) {
    fs.mkdirSync(THUMBS, { recursive: true });
    const items = [], todo = [];
    for (const p of paths) {
      let st; try { st = fs.statSync(p); } catch { continue; }
      const k = keyOf(p, st), exif = /\.jpe?g$/i.test(p) ? jpegExifDate(p) : null;
      const it = { path: p, name: path.basename(p), size: st.size, time: (exif || st.mtime).getTime(), timeExif: !!exif, key: k, thumb: thumbOf(k), r: cache[k] || null };
      if (it.r && !fs.existsSync(it.thumb)) it.r = null;
      items.push(it); if (!it.r) todo.push(it);
    }
    job = { cancel: false };
    const myJob = job, total = items.length; let done = items.length - todo.length; const t0 = Date.now();
    const report = () => onProgress({ done, total, eta: done > (total - todo.length) ? Math.round((Date.now() - t0) / (done - (total - todo.length)) * (total - done) / 1000) : null });
    report();
    if (todo.length) {
      const info = await worker();
      if (!info.ok || process.env.AS_DEVTOOLS) console.log('photo checker:', JSON.stringify(info));
      let next = 0, seq = 0;
      const lane = async () => {
        while (next < todo.length && !myJob.cancel) {
          const it = todo[next++];
          try {
            const jpeg = await decode(it.path, it.thumb);
            if (myJob.cancel) break;
            const id = ++seq + ':' + it.key;
            const r = await new Promise((res, rej) => { waiting.set(id, { res, rej }); wkr.webContents.send('cull:job', { id, jpeg }); });
            delete r.id; it.r = r; if (!r.error) { cache[it.key] = r; cacheDirty = true; }
          } catch (e) { it.r = { error: e.message }; }
          done++; report();
          if (done % 25 === 0) saveCache();
        }
      };
      await Promise.all([lane(), lane(), lane()]);
      saveCache(); idle();
    }
    return { items, cancelled: myJob.cancel, faceCheck: wkrInfo ? wkrInfo.ok : true, backend: wkrInfo && wkrInfo.backend };
  }

  /* ---------- IPC ---------- */
  const strip = it => ({ path: it.path, name: it.name, thumb: it.thumb, time: it.time, w: it.r && it.r.w, h: it.r && it.r.h, faces: it.r && it.r.faces, sharp: it.r && it.r.sharp, error: it.r && it.r.error });
  ipcMain.handle('cull:start', async (e, paths, opts) => {
    try {
      const list = (paths || []).filter(p => PIC.test(p));
      const r = await run(list, p => { if (!e.sender.isDestroyed()) e.sender.send('cull:progress', p); });
      last = r.items;
      return { cancelled: r.cancelled, faceCheck: r.faceCheck, backend: r.backend, items: r.items.map(strip), ...decide(r.items, opts) };
    } catch (err) { return { error: err.message }; }
  });
  ipcMain.handle('cull:decide', (_, opts) => last ? decide(last, opts) : null);
  ipcMain.handle('cull:cancel', () => { if (job) job.cancel = true; return true; });
  // Move to "<folder>/Rejected" — reversible from inside the app (Undo) or by hand
  ipcMain.handle('cull:reject', async (_, paths) => {
    const moves = [], failed = [];
    for (const p of paths) {
      try { const dir = path.join(path.dirname(p), REJECT_DIR); fs.mkdirSync(dir, { recursive: true }); const to = media.uniqueOut(dir, path.basename(p, path.extname(p)), path.extname(p).slice(1)); fs.renameSync(p, to); moves.push({ from: p, to }); } catch (e) { failed.push(p); }
    }
    return { moves, failed };
  });
  ipcMain.handle('cull:restore', async (_, moves) => {
    let n = 0; for (const m of moves) { try { if (!fs.existsSync(m.from)) { fs.renameSync(m.to, m.from); n++; } } catch {} }
    for (const d of new Set(moves.map(m => path.dirname(m.to)))) { try { if (!fs.readdirSync(d).length) fs.rmdirSync(d); } catch {} }
    return n;
  });
  ipcMain.handle('cull:openRejected', (_, folder) => { const d = path.join(folder, REJECT_DIR); return fs.existsSync(d) ? shell.openPath(d) : ''; });

  // one picture straight to the checker (used by "follow the speaker" when making vertical clips)
  async function checkJpeg(jpeg) {
    await worker();
    const id = 'f' + Date.now() + Math.random();
    const r = await new Promise((res, rej) => { waiting.set(id, { res, rej }); wkr.webContents.send('cull:job', { id, jpeg }); });
    idle(); return r;
  }
  /* ---------- generic jobs for the vision features (cut-outs, people) ---------- */
  async function visionJob(type, jpeg, extra = {}) {
    await worker();
    const id = type + Date.now() + Math.random();
    const r = await new Promise((res, rej) => { waiting.set(id, { res, rej }); wkr.webContents.send('cull:job', { id, type, jpeg, ...extra }); });
    idle(); if (r.error) throw new Error(r.error); return r;
  }
  async function decodeMax(file, max) {
    let src = file, tmp = null;
    if (/\.(heic|heif)$/i.test(file)) { tmp = path.join(THUMBS, 'heic_' + crypto.randomBytes(5).toString('hex') + '.jpg'); fs.mkdirSync(THUMBS, { recursive: true }); await media.heic(file, tmp, { format: 'JPEG', quality: .9 }); src = tmp; }
    const r = await ff(['-hide_banner', '-loglevel', 'error', '-i', src, '-frames:v', '1', '-vf', `scale=w='min(${max},iw)':h='min(${max},ih)':force_original_aspect_ratio=decrease,format=yuvj420p`, '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '2', 'pipe:1']);
    if (tmp) try { fs.unlinkSync(tmp); } catch {}
    if (!r.out.length) throw new Error('could not read this picture'); return r.out;
  }
  const keyStat = p => { const st = fs.statSync(p); return p + '|' + st.size + '|' + Math.round(st.mtimeMs); };
  // Cut-out: returns the person mask (PNG, white + alpha) at up to 2048 px, cached
  const CUT = path.join(CACHE, 'cutouts');
  async function cutout(file) {
    fs.mkdirSync(CUT, { recursive: true });
    const k = crypto.createHash('md5').update(keyStat(file)).digest('hex'), mf = path.join(CUT, k + '.png'), jf = path.join(CUT, k + '.jpg'), inf = path.join(CUT, k + '.json');
    if (fs.existsSync(mf) && fs.existsSync(jf) && fs.existsSync(inf)) return { mask: mf, image: jf, ...JSON.parse(fs.readFileSync(inf, 'utf8')), cached: true };
    const jpeg = await decodeMax(file, 2048); fs.writeFileSync(jf, jpeg);
    const r = await visionJob('segment', jpeg);
    fs.writeFileSync(mf, Buffer.from(r.mask)); const info = { w: r.w, h: r.h, people: r.people, faces: r.faces }; fs.writeFileSync(inf, JSON.stringify(info));
    return { mask: mf, image: jf, ...info };
  }
  // People: face fingerprints per photo (cached), then grouped into people
  const PFILE = path.join(UD, 'people-cache.json');
  let pcache = {}; try { pcache = JSON.parse(fs.readFileSync(PFILE, 'utf8')); } catch {}
  async function people(files, onProgress) {
    let done = 0; const out = [];
    for (const f of files) {
      let k; try { k = keyStat(f); } catch { continue; }
      if (!pcache[k]) {
        try { const r = await visionJob('people', await decodeMax(f, 1600)); pcache[k] = r.faces; } catch (e) { pcache[k] = []; }
        if (++done % 10 === 0) try { fs.writeFileSync(PFILE, JSON.stringify(pcache)); } catch {}
      }
      out.push({ path: f, faces: pcache[k] });
      onProgress && onProgress(out.length, files.length);
    }
    try { fs.writeFileSync(PFILE, JSON.stringify(pcache)); } catch {}
    return out;
  }
  return { dispose, run, checkJpeg, visionJob, cutout, people, decide: opts => last && decide(last, opts) };
};
