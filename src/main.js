const { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard, protocol } = require('electron');
const { Readable } = require('stream');
const path = require('path'), fs = require('fs'), zlib = require('zlib'), crypto = require('crypto');
const { spawn } = require('child_process');

if (!app.requestSingleInstanceLock()) { app.quit(); }
// asmedia:// streams local video/audio to the editor with seeking (Range) support and CORS, so the preview can mix the sound.
protocol.registerSchemesAsPrivileged([{ scheme: 'asmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  { scheme: 'ascull', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);   // offline photo checker (auto-cull)
app.disableHardwareAcceleration();
app.setName('After Service');
app.setPath('userData', path.join(app.getPath('appData'), 'After Service'));
const UD = app.getPath('userData');
const CFG = path.join(UD, 'config.json');
const NAME_FILE = path.join(UD, 'workspace-name.txt');
const CACHE = path.join(UD, 'cache');
const IMG = /\.(jpe?g|png|webp|bmp)$/i;
const VID = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'wmv', 'mts', 'm2ts', '3gp'];
const AUD = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma', 'opus'];
const PRESET_EXT = '.aspreset';
const clean = s => String(s || '').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60);
const pad = n => String(n).padStart(2, '0');
const stamp = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`; };
let win, cfg = null, pendingOpen = null, history = null, reframe = null;
const logSvc = item => { try { history && cfg && cfg.root && history.log(item); } catch {} };
const refocus = () => { if (!win || win.isDestroyed()) return; if (!win.isFocused()) win.focus(); win.webContents.focus(); };

/* ---------------- Video engine (bundled ffmpeg) ---------------- */
let FFMPEG = null;
try { FFMPEG = require('ffmpeg-static'); if (FFMPEG) FFMPEG = FFMPEG.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep); if (!fs.existsSync(FFMPEG)) FFMPEG = null; } catch { FFMPEG = null; }

function ff(args, { onOut, onErr, keep, cwd } = {}) {
  return new Promise((res, rej) => {
    if (!FFMPEG) return rej(new Error('The video engine (ffmpeg) is missing. Reinstall After Service.'));
    const p = spawn(FFMPEG, args, { windowsHide: true, cwd: cwd || undefined });
    const out = [], err = [];
    p.stdout.on('data', d => { onOut ? onOut(d) : out.push(d); });
    p.stderr.on('data', d => { err.push(d); onErr && onErr(d); });
    if (keep) keep(p);
    p.on('error', rej);
    p.on('close', code => res({ code, out: Buffer.concat(out), err: Buffer.concat(err).toString() }));
  });
}
async function probe(file) {
  const { err } = await ff(['-hide_banner', '-i', file]);
  const d = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const v = err.match(/Stream #[^\n]*?Video:\s*([a-z0-9_]+)[^\n]*?,\s*(\d{2,5})x(\d{2,5})/i);
  const rot = /rotation of -?90|rotate\s*:\s*(90|270)/i.test(err);
  const fps = (err.match(/(\d+(?:\.\d+)?)\s*fps/) || [])[1];
  return {
    dur: d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : 0,
    hasVideo: !!v, vcodec: v ? v[1].toLowerCase() : null,
    w: v ? +(rot ? v[3] : v[2]) : 0, h: v ? +(rot ? v[2] : v[3]) : 0,
    fps: fps ? parseFloat(fps) : 30, hasAudio: /Stream #[^\n]*?Audio:/.test(err)
  };
}
async function thumbs(file, dur, n = 8) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = Math.max(0, Math.min(dur - 0.1, (i + 0.5) / n * dur));
    const r = await ff(['-hide_banner', '-loglevel', 'error', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-vf', 'scale=-2:96', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '6', 'pipe:1']);
    out.push(r.out.length ? 'data:image/jpeg;base64,' + r.out.toString('base64') : null);
  }
  return out;
}
async function peaks(file, perSec = 50) {
  const r = await ff(['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '4000', '-f', 's16le', 'pipe:1']);
  const s = new Int16Array(r.out.buffer, r.out.byteOffset, Math.floor(r.out.length / 2)), step = 4000 / perSec, res = [];
  for (let i = 0; i < s.length; i += step) { let m = 0; for (let j = i; j < Math.min(s.length, i + step); j++) { const a = Math.abs(s[j]); if (a > m) m = a; } res.push(Math.round(m / 327.68)); }
  return res;
}
const PLAYABLE = ['h264', 'vp8', 'vp9', 'av1'], PLAY_EXT = ['mp4', 'm4v', 'mov', 'webm'];
let proxyProc = null;
async function proxyFor(file, info, send) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const big = info.w * info.h > 1920 * 1080 * 1.1;
  if (PLAYABLE.includes(info.vcodec) && PLAY_EXT.includes(ext) && !big) return null;
  const st = fs.statSync(file), key = crypto.createHash('md5').update(file + st.size + st.mtimeMs).digest('hex');
  fs.mkdirSync(CACHE, { recursive: true });
  const out = path.join(CACHE, key + '.mp4');
  if (fs.existsSync(out)) return out;
  const tmp = out + '.part.mp4';
  const r = await ff(['-hide_banner', '-y', '-i', file, '-vf', "scale='if(gt(iw,ih),-2,720)':'if(gt(iw,ih),720,-2)'", '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '25', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', tmp],
    { onOut: d => { const m = String(d).match(/out_time_us=(\d+)/); if (m && info.dur) send(Math.min(1, +m[1] / 1e6 / info.dur)); }, keep: p => proxyProc = p });
  proxyProc = null;
  if (r.code !== 0) { try { fs.unlinkSync(tmp); } catch {} throw new Error('Could not prepare this video for editing.'); }
  fs.renameSync(tmp, out); return out;
}

/* ---------------- Workspace ---------------- */
const WS_DIRS = ['Presets', 'Overlays', 'Exports', 'Sounds'];
function setupWorkspace(rawName) {
  const name = clean(rawName); if (!name) return null;
  const root = path.join(app.getPath('documents'), name);
  WS_DIRS.forEach(d => fs.mkdirSync(path.join(root, d), { recursive: true }));
  cfg = { ...(cfg || {}), name, root };
  fs.mkdirSync(UD, { recursive: true });
  fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2));
  migratePresets();
  return cfg;
}

/* ---------------- Sound library (Documents\<Workspace>\Sounds) ----------------
   Any audio file placed in this folder (or a sub-folder, used as a category) shows up in the
   video editor automatically. The folder is watched, so new downloads appear without restarting. */
const soundsDir = () => path.join(cfg.root, 'Sounds');
const AUD_RE = new RegExp('\\.(' + AUD.join('|') + ')$', 'i');
const durCache = new Map();
function seedSounds() {
  // Copy the starter sounds that ship with the app once; deleted ones are not brought back.
  if (!cfg || cfg.soundsSeeded) return;
  const src = path.join(__dirname, '..', 'assets', 'sounds'), dest = path.join(soundsDir(), 'After Service Starter');
  try {
    if (fs.existsSync(src)) { fs.mkdirSync(dest, { recursive: true }); for (const f of fs.readdirSync(src)) if (AUD_RE.test(f) && !fs.existsSync(path.join(dest, f))) fs.copyFileSync(path.join(src, f), path.join(dest, f)); }
    cfg.soundsSeeded = true; fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2));
  } catch {}
}
function listSounds() {
  const root = soundsDir(), out = [];
  const walk = (dir, depth) => {
    let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (e.isFile() && AUD_RE.test(e.name)) {
        const st = fs.statSync(p), rel = path.relative(root, dir);
        out.push({ name: e.name.replace(/\.[^.]+$/, ''), file: e.name, path: p, folder: rel ? rel.split(path.sep).join(' / ') : '', mtime: st.mtimeMs, size: st.size, dur: (durCache.get(p + st.mtimeMs) ?? null) });
      }
    }
  };
  walk(root, 0);
  return out.sort((a, b) => (a.folder || '\uffff').localeCompare(b.folder || '\uffff') || a.name.localeCompare(b.name, undefined, { numeric: true }));
}
function uniqueDest(dir, file) {
  const ext = path.extname(file), base = path.basename(file, ext); let d = path.join(dir, file), k = 2;
  while (fs.existsSync(d)) d = path.join(dir, `${base} (${k++})${ext}`);
  return d;
}
function importSounds(files) {
  const dir = soundsDir(), added = [];
  for (const f of files || []) {
    try {
      if (!AUD_RE.test(f) || !fs.statSync(f).isFile()) continue;
      if (path.resolve(f).toLowerCase().startsWith(path.resolve(dir).toLowerCase() + path.sep)) { added.push(f); continue; }
      const d = uniqueDest(dir, path.basename(f)); fs.copyFileSync(f, d); added.push(d);
    } catch {}
  }
  return added;
}
let soundWatch = null, soundTimer = null;
function watchSounds() {
  if (soundWatch) { try { soundWatch.close(); } catch {} soundWatch = null; }
  if (!cfg) return;
  const ping = () => { clearTimeout(soundTimer); soundTimer = setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.send('snd:changed'); }, 400); };
  try { soundWatch = fs.watch(soundsDir(), { recursive: true }, ping); }
  catch { try { soundWatch = fs.watch(soundsDir(), ping); } catch {} }
}
function loadCfg() {
  try { cfg = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch { cfg = null; }
  if (!cfg && fs.existsSync(NAME_FILE)) setupWorkspace(fs.readFileSync(NAME_FILE, 'utf8'));
  if (cfg) { WS_DIRS.forEach(d => fs.mkdirSync(path.join(cfg.root, d), { recursive: true })); migratePresets(); }
}

/* ---------------- After Service preset file (.aspreset) ----------------
   Layout: "ASPRESET" magic (8 bytes) + version (1 byte) + scrambled gzip payload.
   Only After Service can read it; the overlay picture is packed inside so a preset works on any PC. */
const MAGIC = Buffer.from('ASPRESET'), KEY = Buffer.from('CTW>AfterService<Preset#v1');
const scramble = b => { const o = Buffer.from(b); for (let i = 0; i < o.length; i++) o[i] ^= KEY[i % KEY.length] ^ (i * 31 & 255); return o; };
function encodePreset(obj) { return Buffer.concat([MAGIC, Buffer.from([1]), scramble(zlib.gzipSync(Buffer.from(JSON.stringify(obj)), { level: 9 }))]); }
function decodePreset(buf) {
  if (buf.length < 10 || !buf.subarray(0, 8).equals(MAGIC)) throw new Error('This is not an After Service preset.');
  const o = JSON.parse(zlib.gunzipSync(scramble(buf.subarray(9))).toString('utf8'));
  if (o.format !== 'after-service-preset') throw new Error('This preset file is damaged.');
  return o;
}
const presetDir = () => path.join(cfg.root, 'Presets');
function packPreset(name, data) {
  const ov = data.overlay ? { ...data.overlay } : null;
  if (ov && ov.path && fs.existsSync(ov.path)) { ov.file = path.basename(ov.path); ov.data = fs.readFileSync(ov.path).toString('base64'); }
  if (ov) delete ov.path;
  return { format: 'after-service-preset', app: 'After Service', name, saved: new Date().toISOString(), params: data.params || {}, look: data.look || '', overlay: ov };
}
function unpackPreset(o, name) {
  const p = { name: name || o.name, saved: o.saved, params: o.params, look: o.look, overlay: null };
  if (o.overlay) {
    const ov = { cx: o.overlay.cx, cy: o.overlay.cy, w: o.overlay.w, op: o.overlay.op };
    if (o.overlay.data && o.overlay.file) {
      const dest = path.join(cfg.root, 'Overlays', clean(o.overlay.file) || 'overlay.png'), buf = Buffer.from(o.overlay.data, 'base64');
      if (!fs.existsSync(dest) || fs.statSync(dest).size !== buf.length) fs.writeFileSync(dest, buf);
      ov.path = dest;
    } else if (o.overlay.path) ov.path = o.overlay.path;
    if (ov.path) p.overlay = ov;
  }
  return p;
}
function migratePresets() {
  if (!cfg) return;
  const d = presetDir();
  for (const f of fs.readdirSync(d).filter(f => f.toLowerCase().endsWith('.json'))) {
    try {
      const o = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')), n = clean(o.name || f.replace(/\.json$/i, ''));
      const packed = packPreset(n, o); packed.saved = o.saved || packed.saved;
      fs.writeFileSync(path.join(d, n + PRESET_EXT), encodePreset(packed)); fs.unlinkSync(path.join(d, f));
    } catch {}
  }
}
function importPresetFile(src) {
  const o = decodePreset(fs.readFileSync(src));
  let n = clean(path.basename(src, path.extname(src))) || clean(o.name) || 'Preset';
  const dest = path.join(presetDir(), n + PRESET_EXT);
  if (path.resolve(src).toLowerCase() !== path.resolve(dest).toLowerCase()) {
    let k = 2, d = dest; while (fs.existsSync(d)) d = path.join(presetDir(), `${n} (${k++})${PRESET_EXT}`);
    fs.copyFileSync(src, d); n = path.basename(d, PRESET_EXT);
  }
  return unpackPreset(o, n);
}
const presetArg = argv => argv.slice(1).find(a => a && a.toLowerCase().endsWith(PRESET_EXT) && fs.existsSync(a));
function handleOpenFile(file) {
  if (!file) return;
  if (win && !win.isDestroyed() && cfg) {
    try { win.webContents.send('preset:opened', importPresetFile(file)); } catch (e) { win.webContents.send('preset:opened', { error: e.message }); }
  } else pendingOpen = file;
}

let lic = null;
app.on('second-instance', (_, argv) => {
  if (!lic || !lic.isOk()) { if (lic) lic.focusLock(); return; }   // nothing opens until the licence is valid
  if (converter && converter.wantsConverter(argv)) return converter.openConverter(converter.fileArgs(argv));
  if (player && player.wantsPlayer(argv)) return player.openPlayer(player.mediaArgs(argv));
  const fresh = !win || win.isDestroyed(), f = presetArg(argv);
  openMainWindow();
  if (fresh) pendingOpen = f || pendingOpen; else handleOpenFile(f);
});
let player = null, converter = null, media = null, devices = null, wifi = null, cull = null, speech = null;
function openMainWindow() {
  if (!win || win.isDestroyed()) { createWindow(); win.webContents.once('did-finish-load', () => setTimeout(refocus, 150)); return win; }
  if (win.isMinimized()) win.restore(); win.show(); win.focus(); win.webContents.focus(); return win;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1180, minHeight: 720, backgroundColor: '#0b0a09',
    title: 'After Service — CTW Software', icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, devTools: !app.isPackaged && !!process.env.AS_DEVTOOLS, autoplayPolicy: 'no-user-gesture-required' }
  });
  Menu.setApplicationMenu(null);
  if (app.isPackaged || !process.env.AS_DEVTOOLS) win.webContents.on('devtools-opened', () => win.webContents.closeDevTools());
  win.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 2) console.log('[renderer]', msg, src + ':' + line); });
  win.webContents.on('preload-error', (e, file, err) => console.log('[preload-error]', file, err));
  win.webContents.on('did-fail-load', (e, code, desc) => console.log('[did-fail-load]', code, desc));
  win.loadFile(path.join(__dirname, 'index.html'));
  if (devices) devices.start();                         // watch for phones / cameras while the editor is open
  win.on('closed', () => { if (devices) devices.stop(); if (cull) cull.dispose(); });   // the hidden photo checker must not keep the app alive
}

app.whenReady().then(() => {
  loadCfg();
  const MIME = { opus: 'audio/ogg', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', webm: 'video/webm', mkv: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac' };
  protocol.handle('asmedia', req => {
    try {
      const file = decodeURIComponent(new URL(req.url).pathname.slice(1)), ext = path.extname(file).slice(1).toLowerCase();
      if (![...VID, ...AUD].includes(ext)) return new Response('Not allowed', { status: 403 });
      const size = fs.statSync(file).size, type = MIME[ext] || 'application/octet-stream';
      const h = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
      if (m) {
        let start = m[1] ? +m[1] : size - +m[2], end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
        if (start >= size) return new Response(null, { status: 416, headers: { ...h, 'Content-Range': `bytes */${size}` } });
        return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status: 206, headers: { ...h, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
      }
      return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...h, 'Content-Length': String(size) } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  pendingOpen = presetArg(process.argv) || null;
  history = require('./services')({ root: () => cfg && cfg.root, getWin: () => win });
  // a small error log next to the settings (…\AppData\Roaming\After Service\errors.log) — send it to CTW when something breaks
  const ERRLOG = path.join(UD, 'errors.log');
  const logLine = msg => { try { if (fs.existsSync(ERRLOG) && fs.statSync(ERRLOG).size > 2e6) fs.renameSync(ERRLOG, ERRLOG + '.old'); fs.appendFileSync(ERRLOG, `[${new Date().toISOString()}] v${app.getVersion()} ${String(msg).slice(0, 4000)}\n`); } catch {} };
  ipcMain.handle('log:error', (_, msg) => { logLine(msg); return true; });
  process.on('uncaughtException', e => logLine('main: ' + (e && e.stack || e)));
  ipcMain.handle('cfg:get', () => cfg);
  ipcMain.handle('cfg:setup', (_, name) => { const c = setupWorkspace(name); if (c) { seedSounds(); watchSounds(); } return c; });
  ipcMain.handle('cfg:save', (_, patch) => { cfg = { ...cfg, ...patch }; fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2)); return cfg; });
  ipcMain.handle('dlg:folder', async (_, def) => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose the folder with your pictures', defaultPath: def || undefined, properties: ['openDirectory'] });
    refocus(); return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('dlg:pick', async (_, dir) => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose the pictures to edit', defaultPath: dir, properties: ['openFile', 'multiSelections'], filters: [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }] });
    refocus(); return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('dlg:overlay', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose your overlay image (PNG recommended)', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'webp', 'jpg', 'jpeg'] }] });
    refocus(); if (r.canceled) return null;
    const src = r.filePaths[0], dest = path.join(cfg.root, 'Overlays', path.basename(src));
    if (path.resolve(src) !== path.resolve(dest)) fs.copyFileSync(src, dest);
    return dest;
  });
  ipcMain.handle('fs:scan', (_, dir) => fs.readdirSync(dir).filter(f => IMG.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(f => ({ name: f, path: path.join(dir, f) })));
  ipcMain.handle('fs:read', (_, p) => fs.readFileSync(p));
  // Delete pictures: moved to the Recycle Bin so a mistake can be undone from Windows.
  ipcMain.handle('fs:trash', async (_, files) => {
    const done = [], failed = [];
    for (const f of files || []) {
      try { if (!IMG.test(f) || !fs.statSync(f).isFile()) throw 0; await shell.trashItem(path.resolve(f)); done.push(f); } catch { failed.push(f); }
    }
    return { done, failed };
  });

  // Presets
  ipcMain.handle('preset:list', () => {
    const d = presetDir();
    return fs.readdirSync(d).filter(f => f.toLowerCase().endsWith(PRESET_EXT)).map(f => {
      try { return unpackPreset(decodePreset(fs.readFileSync(path.join(d, f))), f.slice(0, -PRESET_EXT.length)); } catch { return null; }
    }).filter(Boolean).sort((a, b) => (b.saved || '').localeCompare(a.saved || ''));
  });
  ipcMain.handle('preset:save', (_, name, data) => {
    const n = clean(name) || 'Preset';
    fs.writeFileSync(path.join(presetDir(), n + PRESET_EXT), encodePreset(packPreset(n, data)));
    return n;
  });
  ipcMain.handle('preset:delete', (_, name) => { try { fs.unlinkSync(path.join(presetDir(), clean(name) + PRESET_EXT)); } catch {} return true; });
  ipcMain.handle('preset:reveal', (_, name) => shell.showItemInFolder(path.join(presetDir(), clean(name) + PRESET_EXT)));
  ipcMain.handle('preset:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Import an After Service preset', properties: ['openFile'], filters: [{ name: 'After Service Preset', extensions: ['aspreset'] }] });
    refocus(); if (r.canceled) return null;
    try { return importPresetFile(r.filePaths[0]); } catch (e) { return { error: e.message }; }
  });
  ipcMain.handle('preset:pending', () => { const f = pendingOpen; pendingOpen = null; if (!f) return null; try { return importPresetFile(f); } catch (e) { return { error: e.message }; } });

  ipcMain.handle('export:begin', (_, name) => {
    const nice = name ? String(name).replace(/[\\/:*?"<>|\r\n]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    let label = nice || 'AfterService_' + stamp(); for (let k = 2; nice && fs.existsSync(path.join(cfg.root, 'Exports', label)); k++) label = `${nice} (${k})`;
    const dir = path.join(cfg.root, 'Exports', label); fs.mkdirSync(dir, { recursive: true });
    logSvc({ kind: 'export', path: dir, label: nice ? label : 'Edited photos' });
    return { dir, label };
  });
  ipcMain.handle('export:write', (_, dir, name, data) => {
    const out = path.join(dir, name); if (!path.resolve(out).startsWith(path.resolve(dir))) return false;
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, Buffer.from(data)); return out;
  });
  // designs & cut-outs: <workspace>/Designs, never overwriting an older file
  ipcMain.handle('design:save', (_, name, ext, data) => {
    const dir = path.join(cfg.root, 'Designs'); fs.mkdirSync(dir, { recursive: true });
    const base = String(name).replace(/[\\/:*?"<>|\r\n]/g, '').trim().slice(0, 80) || 'Design';
    let out = path.join(dir, `${base}.${ext}`); for (let k = 2; fs.existsSync(out); k++) out = path.join(dir, `${base} (${k}).${ext}`);
    fs.writeFileSync(out, Buffer.from(data)); logSvc({ kind: 'design', path: out, label: base }); return out;
  });
  ipcMain.handle('clip:read', () => clipboard.readText());
  ipcMain.handle('shell:open', (_, p) => shell.openPath(p));
  ipcMain.handle('shell:reveal', (_, p) => shell.showItemInFolder(p));

  /* ---------------- Video IPC ---------------- */
  ipcMain.handle('vid:engine', () => !!FFMPEG);
  ipcMain.handle('vid:pickVideos', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Add videos', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Videos', extensions: VID }] });
    refocus(); return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('vid:pickAudio', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Add sound or music', defaultPath: soundsDir(), properties: ['openFile'], filters: [{ name: 'Audio', extensions: AUD }] });
    refocus(); if (r.canceled) return null;
    return importSounds([r.filePaths[0]])[0] || r.filePaths[0];   // keep a copy in the Sound library
  });
  ipcMain.handle('snd:list', () => listSounds());
  ipcMain.handle('snd:dir', () => soundsDir());
  ipcMain.handle('snd:open', () => shell.openPath(soundsDir()));
  ipcMain.handle('snd:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Add sounds to your library', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: AUD }] });
    refocus(); return r.canceled ? [] : importSounds(r.filePaths);
  });
  ipcMain.handle('snd:importPaths', (_, files) => importSounds(files));
  ipcMain.handle('snd:dur', async (_, p, mtime) => {
    const k = p + mtime; if (durCache.has(k)) return durCache.get(k);
    try { const d = (await probe(p)).dur || 0; durCache.set(k, d); return d; } catch { return 0; }
  });
  ipcMain.handle('snd:trash', async (_, p) => {
    if (!AUD_RE.test(p) || !path.resolve(p).toLowerCase().startsWith(path.resolve(soundsDir()).toLowerCase() + path.sep)) return false;
    try { await shell.trashItem(path.resolve(p)); return true; } catch { return false; }
  });
  ipcMain.handle('vid:pickImage', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Add an image overlay', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'webp', 'jpg', 'jpeg'] }] });
    refocus(); return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('vid:probe', (_, f) => probe(f));
  ipcMain.handle('vid:thumbs', (_, f, dur) => thumbs(f, dur));
  ipcMain.handle('vid:peaks', (_, f) => peaks(f));
  ipcMain.handle('vid:proxy', async (e, f, info) => proxyFor(f, info, p => e.sender.send('vid:proxyProgress', f, p)));
  ipcMain.handle('vid:forceProxy', async (e, f, info) => proxyFor(f, { ...info, vcodec: 'force' }, p => e.sender.send('vid:proxyProgress', f, p)));

  let job = null;
  ipcMain.handle('vid:tmpdir', () => { const d = path.join(CACHE, 'export_' + Date.now()); fs.mkdirSync(d, { recursive: true }); return d; });
  ipcMain.handle('vid:writeTmp', (_, dir, name, data) => { const p = path.join(dir, name); fs.writeFileSync(p, Buffer.from(data)); return p; });
  ipcMain.handle('vid:export', async (e, plan) => {
    // a batch (e.g. sermon clips) goes into its own sub-folder with readable names
    const outDir = path.join(cfg.root, 'Exports', ...(plan.folder ? [plan.folder.replace(/[\\/:*?"<>|]/g, '').slice(0, 80)] : [])); fs.mkdirSync(outDir, { recursive: true });
    const nice = plan.name ? plan.name.replace(/[\\/:*?"<>|\r\n]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90) : '';
    let out = path.join(outDir, nice ? `${nice}.mp4` : `AfterService_Video_${plan.label}_${stamp()}.mp4`);
    for (let k = 2; nice && fs.existsSync(out); k++) out = path.join(outDir, `${nice} (${k}).mp4`);
    // auto-reframe: a small timed list of crop positions per clip (moves the crop while the video plays)
    const { pathAt } = require('./reframe');
    plan.clips.forEach((c, i) => {
      if (plan.fit !== 'follow' || !c.follow || !c.follow.kf || !c.follow.sw) return;
      const SW = Math.round(c.follow.sw * plan.H / c.follow.sh / 2) * 2; if (SW <= plan.W) { c.follow = null; return; }
      c.follow.SW = SW; let last = null, lines = [];
      for (let t = 0; t <= c.dur + 1e-6; t += 1 / plan.fps) {
        const x = Math.round(Math.max(0, Math.min(SW - plan.W, pathAt(c.follow.kf, c.in + t) * SW - plan.W / 2)));
        if (x !== last) { lines.push(`${t.toFixed(3)} rf${i} x ${x};`); last = x; }
      }
      c.follow.x0 = Math.round(Math.max(0, Math.min(SW - plan.W, pathAt(c.follow.kf, c.in) * SW - plan.W / 2)));
      fs.writeFileSync(path.join(plan.tmp, `follow_${i}.txt`), lines.join('\n') + '\n');
    });
    // size limit (WhatsApp Status: under 16 MB) — pick the bitrate from the length, check, and retry smaller if needed
    const partLen = plan.segment ? Math.min(plan.segment, plan.duration) : plan.duration;
    if (plan.maxMB) plan.vb = Math.max(300, Math.min(plan.vbMax || 3500, Math.floor(plan.maxMB * .93 * 8 * 1024 / partLen - (plan.ab || 128))));
    const partsOut = () => { if (!plan.segment) return [out]; const dir = path.dirname(out), base = path.basename(out, '.mp4'); return fs.readdirSync(dir).filter(f => f.startsWith(base + ' part ') && f.endsWith('.mp4')).sort((a, b) => parseInt(a.slice(base.length + 6)) - parseInt(b.slice(base.length + 6))).map(f => path.join(dir, f)); };
    let cancelled = false, tail = '', r = { code: 0 };
    // loudness levelling: listen to the finished sound once to measure it
    if (plan.clean && plan.clean.loud) {
      e.sender.send('vid:exportStatus', 'Measuring the loudness…');
      const m = await ff(buildExportArgs(plan, out, { audioOnly: true }), { cwd: plan.tmp, keep: p => job = { p, cancel: () => { cancelled = true; p.kill(); } } });
      const js = (m.err.match(/\{[^{}]*"input_i"[^{}]*\}/) || [])[0];
      try { plan.ln = JSON.parse(js); if (!isFinite(+plan.ln.input_i)) plan.ln = null; } catch { plan.ln = null; }
      e.sender.send('vid:exportStatus', null);
    }
    for (let attempt = 0; attempt < 4 && !cancelled; attempt++) {
      for (const f of plan.segment ? partsOut() : []) try { fs.unlinkSync(f); } catch {}
      const args = buildExportArgs(plan, out);
      tail = '';
      r = await ff(args, {
        onOut: d => { const m = String(d).match(/out_time_us=(\d+)/); if (m) e.sender.send('vid:exportProgress', Math.min(1, +m[1] / 1e6 / plan.duration)); },
        onErr: d => { tail = (tail + d).slice(-3000); },
        cwd: plan.tmp,
        keep: p => job = { p, cancel: () => { cancelled = true; p.kill(); } }
      });
      if (cancelled || r.code !== 0 || !plan.maxMB) break;
      const big = partsOut().some(f => fs.statSync(f).size > plan.maxMB * 1024 * 1024);
      if (!big) break;
      plan.vb = Math.floor(plan.vb * .82); e.sender.send('vid:exportProgress', 0);
    }
    job = null;
    try { fs.rmSync(plan.tmp, { recursive: true, force: true }); } catch {}
    if (cancelled) { for (const f of partsOut()) try { fs.unlinkSync(f); } catch {} return { cancelled: true }; }
    if (r.code !== 0) { for (const f of partsOut()) try { fs.unlinkSync(f); } catch {} console.log(tail); return { error: (tail.split('\n').filter(Boolean).slice(-3).join('\n')) || 'Export failed' }; }
    let files = partsOut();
    // name the parts "part 1 of 3" so they are posted in order
    if (plan.segment) {
      if (files.length === 1) { const one = out; try { fs.renameSync(files[0], one); } catch {} files = [one]; }
      else files = files.map((f, k) => { const to = f.replace(/ part \d+\.mp4$/, ` part ${k + 1} of ${files.length}.mp4`); try { fs.renameSync(f, to); } catch { return f; } return to; });
    }
    out = files[0];
    logSvc({ kind: plan.folder ? 'clips' : 'video', path: plan.folder ? path.dirname(out) : out, label: plan.folder || nice || 'Video' });
    return { file: out, files, sizes: files.map(f => { try { return fs.statSync(f).size; } catch { return 0; } }) };
  });
  ipcMain.handle('vid:cancel', () => { if (job) job.cancel(); if (proxyProc) proxyProc.kill(); return true; });

  if (cfg) { seedSounds(); watchSounds(); }
  /* ---------------- After Service Player ---------------- */
  player = require('./player-main')({ ff, probe, proxyFor, CACHE, UD, VID, AUD, getCfg: () => cfg, openMainWindow });
  ipcMain.handle('player:open', () => { player.openPlayer(); return true; });
  ipcMain.handle('player:installed', () => { try { return fs.readFileSync(path.join(UD, 'player-installed.txt'), 'utf8').trim() !== '0'; } catch { return true; } });
  /* ---------------- Conversion engine, phone/camera import, Converter app ---------------- */
  media = require('./media-tools')({ ff, probe, CACHE });
  devices = require('./device-import')({ media, getCfg: () => cfg, UD, getWin: () => win });
  converter = require('./converter-main')({ media, ff, UD, openMainWindow });
  cull = require('./cull-main')({ media, ff, UD, CACHE });
  require('./vision')({ cull, UD, getWin: () => win });
  reframe = require('./reframe')({ ff, cull, CACHE, getWin: () => win });
  require('./scripture')();
  require('./multicam')({ ff, probe, reframe, getWin: () => win, CACHE });
  require('./team')({ root: () => cfg && cfg.root, UD, getWin: () => win, wsName: () => (cfg && cfg.name) || 'Workspace' });
  require('./montage')({ ff, root: () => cfg.root, getWin: () => win, stamp, log: logSvc });
  speech = require('./speech')({ ff, UD, CACHE, getWin: () => win });
  // Sermon clip finder: listen to the whole video once (fast mode), measure loudness, pick the best moments
  ipcMain.handle('clips:find', async (_, file, opts = {}) => {
    try {
      const info = await probe(file);
      const tr = await speech.transcribe({ path: file, in: 0, dur: info.dur || 0, fileDur: info.dur || 0, mode: 'fast', lang: opts.lang });
      if (tr.error) return tr;
      const rms = await speech.loudness(file).catch(() => []);
      const r = require('./clip-finder').findClips(tr, rms, opts);
      return { ...r, dur: info.dur, lang: tr.lang, words: tr.segments.reduce((a, x) => a + x.words.length, 0) };
    } catch (e) { return { error: e.message === 'NO_MODEL' ? 'NO_MODEL' : e.message }; }
  });
  // "Follow the speaker": where is the main face, left-to-right, across a clip? (0 = left edge, 1 = right edge)
  ipcMain.handle('reframe:focus', async (_, file, a, b) => {
    try {
      const xs = [], n = 6;
      for (let i = 0; i < n; i++) {
        const t = a + (b - a) * (i + .5) / n;
        const r = await ff(['-hide_banner', '-loglevel', 'error', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-vf', "scale='min(960,iw)':-2", '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '4', 'pipe:1']);
        if (!r.out.length) continue;
        const res = await cull.checkJpeg(r.out);
        const f = (res.faces || []).filter(x => x.score > .5).sort((x, y) => y.box[2] * y.box[3] - x.box[2] * x.box[3])[0];
        if (f) xs.push(f.box[0] + f.box[2] / 2);
      }
      if (!xs.length) return null;
      xs.sort((x, y) => x - y); return +xs[xs.length >> 1].toFixed(3);
    } catch { return null; }
  });
  wifi = require('./wifi-share')({ media, ff, getCfg: () => cfg, UD, CACHE, getWin: () => win, iconFile: path.join(__dirname, '..', 'assets', 'icon.png') });
  player.setMedia && player.setMedia(media);
  ipcMain.handle('converter:open', (_, files) => { converter.openConverter(files || []); return true; });
  ipcMain.handle('converter:installed', () => { try { return fs.readFileSync(path.join(UD, 'converter-installed.txt'), 'utf8').trim() !== '0'; } catch { return true; } });
  app.on('before-quit', () => media.stopWorkers());
  /* ---------------- Licence gate ---------------- */
  lic = require('./license')({ UD });
  // online: licence check-in, extensions / cancellations and updates (works also while locked, so an extension unlocks)
  const online = require('./online')({ UD, lic: lic.api, getWin: () => win });
  lic.api.setRevoked(online.revokedFor);
  const startApp = () => {
    if (converter.wantsConverter(process.argv)) converter.openConverter(converter.fileArgs(process.argv));
    else if (player.wantsPlayer(process.argv)) player.openPlayer(player.mediaArgs(process.argv));
    else { createWindow(); win.webContents.once('did-finish-load', () => setTimeout(refocus, 150)); }
  };
  lic.gate(startApp, () => { if (job) job.cancel(); });
});
app.on('window-all-closed', () => app.quit());

/* ---------------- Export graph ----------------
   plan = { W, H, fps, fit:'fit'|'fill', duration, clips:[{path,in,dur,vol,muted,hasAudio}], trackMute, trackVol,
            nr:{on,strength}, music:{path,in,dur,start,vol,fadeOut}|null, layers:[{png,start,end,fadeIn,fadeOut}], tmp } */
function buildExportArgs(P, out, opt = {}) {
  const AO = !!opt.audioOnly;     // loudness measuring pass: sound only, nothing written
  const a = ['-hide_banner', '-y'], f = [], T = P.duration.toFixed(3);
  let k = 0;
  const fillScale = `scale=${P.W}:${P.H}:force_original_aspect_ratio=increase,crop=${P.W}:${P.H}`;
  const vScale = P.fit === 'fill'
    ? `scale=${P.W}:${P.H}:force_original_aspect_ratio=increase,crop=${P.W}:${P.H}`
    : `scale=${P.W}:${P.H}:force_original_aspect_ratio=decrease,pad=${P.W}:${P.H}:(ow-iw)/2:(oh-ih)/2:color=black`;
  const cat = [];
  // "follow the speaker": in Fill mode a clip can keep a chosen point (the preacher) in frame instead of the centre
  const fillFocus = fx => `scale=${P.W}:${P.H}:force_original_aspect_ratio=increase,crop=${P.W}:${P.H}:max(0\\,min(iw-${P.W}\\,iw*${fx.toFixed(3)}-${P.W}/2)):(ih-${P.H})/2`;
  P.clips.forEach((c, i) => {
    a.push('-ss', c.in.toFixed(3), '-t', c.dur.toFixed(3), '-i', c.path); const ix = k++;
    if (!AO) {
    const follow = P.fit === 'follow' && c.follow && c.follow.SW ? `scale=${c.follow.SW}:${P.H},setsar=1,sendcmd=f=follow_${i}.txt,crop@rf${i}=w=${P.W}:h=${P.H}:x=${c.follow.x0}:y=0` : null;
    f.push(`[${ix}:v]${follow || ((P.fit === 'fill' || P.fit === 'follow') && c.focus != null ? fillFocus(c.focus) : P.fit === 'follow' ? fillScale : vScale)},setsar=1,fps=${P.fps},settb=1/${P.fps}${c.lut ? `,format=rgb24,lut3d=file=${c.lut}:interp=tetrahedral` : ''},format=yuv420p,trim=duration=${c.dur.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
    }
    const gain = (P.trackMute || c.muted) ? 0 : c.vol * P.trackVol;
    if (c.hasAudio && gain > 0) f.push(`[${ix}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${gain.toFixed(3)},apad,atrim=duration=${c.dur.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
    else f.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${c.dur.toFixed(3)},aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    cat.push(AO ? `[a${i}]` : `[v${i}][a${i}]`);
  });
  if (P.clips.some(c => c.td > 0)) {
    // Transitions: chain the clips with xfade (video) and acrossfade (sound); plain cuts in between use concat.
    let cv = 'v0', ca = 'a0';
    for (let i = 1; i < P.clips.length; i++) {
      const c = P.clips[i];
      if (c.td > 0) {
        if (!AO) f.push(`[${cv}][v${i}]xfade=transition=${c.xf}:duration=${c.td.toFixed(3)}:offset=${c.start.toFixed(3)}[xv${i}]`);
        f.push(`[${ca}][a${i}]acrossfade=d=${c.td.toFixed(3)}:c1=tri:c2=tri[xa${i}]`);
      } else {
        if (!AO) f.push(`[${cv}][v${i}]concat=n=2:v=1:a=0[xv${i}]`);
        f.push(`[${ca}][a${i}]concat=n=2:v=0:a=1[xa${i}]`);
      }
      cv = 'xv' + i; ca = 'xa' + i;
    }
    if (!AO) f.push(`[${cv}]null[cv]`); f.push(`[${ca}]anull[ca]`);
  } else f.push(AO ? `${cat.join('')}concat=n=${P.clips.length}:v=0:a=1[ca]` : `${cat.join('')}concat=n=${P.clips.length}:v=1:a=1[cv][ca]`);
  let v = 'cv';
  if (!AO) P.layers.forEach((L, i) => {
    if (L.seq) {   // captions: one timed picture sequence (concat list) instead of hundreds of separate layers
      a.push('-f', 'concat', '-safe', '0', '-i', L.seq); const ix = k++;
      f.push(`[${ix}:v]fps=${P.fps},format=rgba${L.opacity < 1 ? `,colorchannelmixer=aa=${L.opacity.toFixed(3)}` : ''}[l${i}]`);
      f.push(`[${v}][l${i}]overlay=0:0:format=auto:eof_action=pass[o${i}]`); v = `o${i}`; return;
    }
    a.push('-loop', '1', '-framerate', String(P.fps), '-t', T, '-i', L.png); const ix = k++;
    let chain = `[${ix}:v]format=rgba`;
    if (L.fadeIn > 0) chain += `,fade=t=in:st=${L.start.toFixed(3)}:d=${L.fadeIn.toFixed(3)}:alpha=1`;
    if (L.fadeOut > 0) chain += `,fade=t=out:st=${Math.max(0, L.end - L.fadeOut).toFixed(3)}:d=${L.fadeOut.toFixed(3)}:alpha=1`;
    f.push(`${chain}[l${i}]`);
    f.push(`[${v}][l${i}]overlay=0:0:format=auto:enable='between(t,${L.start.toFixed(3)},${L.end.toFixed(3)})'[o${i}]`);
    v = `o${i}`;
  });
  if (!AO) f.push(`[${v}]format=yuv420p[vout]`);
  let au = 'ca';
  const C = P.clean || {};
  if (P.nr && P.nr.on) {
    const s = Math.max(0, Math.min(100, P.nr.strength)) / 100, nr = (8 + s * 30).toFixed(1), nf = (-50 + s * 20).toFixed(0);
    f.push(`[${au}]highpass=f=${Math.round(70 + s * 50)},afftdn=nr=${nr}:nf=${nf}:tn=1,lowpass=f=${Math.round(16000 - s * 6000)}[cn]`); au = 'cn';
  }
  // hum: mains hum is 50 Hz (Africa, Europe…) or 60 Hz (Americas…) and its overtones — narrow notches leave the voice untouched
  if (C.hum) { f.push(`[${au}]highpass=f=70,${[50, 100, 150, 200, 250, 60, 120, 180, 240].map(hz => `bandreject=f=${hz}:width_type=q:w=12`).join(',')}[ch]`); au = 'ch'; }
  // echo: the room's ring between words is pulled down (an expander) and the boomy low-mids are tidied
  if (C.echo) { f.push(`[${au}]agate=threshold=0.02:ratio=3:attack=4:release=180:range=0.18:knee=3,equalizer=f=280:t=q:w=1.2:g=-3,equalizer=f=3200:t=q:w=1:g=2[ce]`); au = 'ce'; }
  let mixed;
  if (P.music) {
    const m = P.music; a.push('-ss', m.in.toFixed(3), '-t', m.dur.toFixed(3), '-i', m.path); const ix = k++;
    const ms = Math.round(m.start * 1000);
    let chain = `[${ix}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${m.vol.toFixed(3)}`;
    if (m.fadeIn > 0) chain += `,afade=t=in:st=0:d=${m.fadeIn.toFixed(2)}`;
    if (m.fadeOut > 0) chain += `,afade=t=out:st=${Math.max(0, m.dur - m.fadeOut).toFixed(3)}:d=${m.fadeOut.toFixed(2)}`;
    chain += `,adelay=${ms}|${ms}`;
    f.push(`${chain}[mu]`);
    let mu = 'mu', sp = au;
    // music ducking: the voice "presses" the music down while someone speaks
    if (C.duck && !m.multicam) {
      const amt = Math.max(0, Math.min(100, C.duckAmt ?? 60)) / 100;
      f.push(`[${au}]asplit=2[spk][key]`, `[mu][key]sidechaincompress=threshold=0.015:ratio=${(2 + amt * 14).toFixed(1)}:attack=60:release=900:knee=4:makeup=1[mud]`);
      sp = 'spk'; mu = 'mud';
    }
    f.push(`[${sp}][${mu}]amix=inputs=2:duration=first:normalize=0[mix]`); mixed = 'mix';
  } else mixed = au;
  // loudness: the standard level for social media (−14 LUFS, peaks under −1.5 dB). Measured first, then applied exactly.
  if (C.loud && AO) f.push(`[${mixed}]loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json[aout]`);
  else if (C.loud && P.ln) f.push(`[${mixed}]loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${P.ln.input_i}:measured_TP=${P.ln.input_tp}:measured_LRA=${P.ln.input_lra}:measured_thresh=${P.ln.input_thresh}:offset=${P.ln.target_offset}:linear=true,aresample=48000[aout]`);
  else f.push(P.music ? `[${mixed}]alimiter=limit=0.95[aout]` : `[${mixed}]anull[aout]`);
  au = 'aout';
  if (AO) { a.push('-filter_complex', f.join(';'), '-map', `[${au}]`, '-t', T, '-f', 'null', '-'); return a; }
  a.push('-filter_complex', f.join(';'), '-map', '[vout]', '-map', `[${au}]`, '-t', T,
    '-c:v', 'libx264', '-preset', 'veryfast', ...(P.vb ? ['-b:v', P.vb + 'k', '-maxrate', Math.round(P.vb * 1.15) + 'k', '-bufsize', Math.round(P.vb * 1.5) + 'k'] : ['-crf', String(P.crf || (P.H >= 1080 || P.W >= 1080 ? 20 : 22)), ...(P.maxrate ? ['-maxrate', P.maxrate + 'k', '-bufsize', P.maxrate * 2 + 'k'] : [])]),
    '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(P.fps),
    '-c:a', 'aac', '-b:a', (P.ab || 192) + 'k', '-ar', '48000', '-progress', 'pipe:1', '-nostats');
  // WhatsApp Status: one file per 60 s part, each starting on a keyframe
  if (P.segment) a.push('-force_key_frames', `expr:gte(t,n_forced*${P.segment})`, '-f', 'segment', '-segment_time', String(P.segment), '-reset_timestamps', '1', '-segment_format', 'mp4', '-segment_format_options', 'movflags=+faststart', out.replace(/\.mp4$/, ' part %d.mp4'));
  else a.push('-movflags', '+faststart', out);
  return a;
}
