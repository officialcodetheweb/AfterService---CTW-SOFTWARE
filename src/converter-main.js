/* =====================================================================
   After Service Converter — main process (window + jobs)
   Launched with "After Service.exe --converter [files]" (own Start-menu/desktop shortcut, chosen at install),
   or from the "Converter" button in the editor.
   ===================================================================== */
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path'), fs = require('fs');

module.exports = function initConverter({ media, ff, UD, openMainWindow }) {
  let cWin = null, pending = [], running = 0, queue = [], procs = new Map(), cancelled = new Set();
  const icon = () => { const p = path.join(__dirname, '..', 'assets', 'converter.png'); return fs.existsSync(p) ? nativeImage.createFromPath(p) : undefined; };
  const fileArgs = argv => argv.slice(1).filter(a => a && !a.startsWith('-') && media.kindOf(a) && fs.existsSync(a));
  const wantsConverter = argv => argv.includes('--converter');

  function openConverter(files = []) {
    if (files.length) pending.push(...files);
    if (cWin && !cWin.isDestroyed()) { if (pending.length) cWin.webContents.send('conv:add', pending.splice(0)); if (cWin.isMinimized()) cWin.restore(); cWin.show(); cWin.focus(); return cWin; }
    cWin = new BrowserWindow({
      width: 1120, height: 760, minWidth: 900, minHeight: 600, backgroundColor: '#0b0a09', show: false, title: 'After Service Converter', icon: icon(),
      titleBarStyle: 'hidden', titleBarOverlay: { color: '#110e0b', symbolColor: '#ffb35c', height: 40 },
      webPreferences: { preload: path.join(__dirname, 'converter', 'preload.js'), contextIsolation: true, nodeIntegration: false, devTools: !app.isPackaged && !!process.env.AS_DEVTOOLS }
    });
    cWin.loadFile(path.join(__dirname, 'converter', 'converter.html'));
    cWin.once('ready-to-show', () => cWin.show());
    cWin.on('closed', () => { cWin = null; for (const p of procs.values()) try { p.kill(); } catch {} });
    return cWin;
  }
  const send = (...a) => { if (cWin && !cWin.isDestroyed()) cWin.webContents.send(...a); };

  /* ---------------- job queue (2 at a time) ---------------- */
  function pump() {
    while (running < 2 && queue.length) {
      const j = queue.shift(); if (cancelled.has(j.id)) { send('conv:done', { id: j.id, cancelled: true }); continue; }
      running++; send('conv:state', { id: j.id, state: 'working', progress: 0 });
      media.convert(j.path, j.fmt, j.opts, p => send('conv:state', { id: j.id, state: 'working', progress: p }), p => procs.set(j.id, p))
        .then(out => { let size = 0; try { size = fs.statSync(out).size; } catch {} send('conv:done', { id: j.id, out, size }); })
        .catch(e => send('conv:done', { id: j.id, error: cancelled.has(j.id) ? null : e.message, cancelled: cancelled.has(j.id) }))
        .finally(() => { running--; procs.delete(j.id); pump(); });
    }
  }
  ipcMain.handle('conv:init', () => ({ files: pending.splice(0), EXT: media.EXT, OUT: media.OUT, docs: app.getPath('documents') }));
  ipcMain.handle('conv:info', async (_, files) => files.map(f => { let size = 0; try { size = fs.statSync(f).size; } catch {} return { path: f, name: path.basename(f), kind: media.kindOf(f), ext: path.extname(f).slice(1).toLowerCase(), size }; }).filter(x => x.kind));
  ipcMain.handle('conv:thumb', async (_, f) => {
    try {
      let src = f;
      if (media.isHeic(f)) { const t = path.join(UD, 'cache', 'thumb_' + Buffer.from(f).toString('base64url').slice(-40) + '.jpg'); fs.mkdirSync(path.dirname(t), { recursive: true }); if (!fs.existsSync(t)) await media.heic(f, t, { format: 'JPEG', quality: .7 }); src = t; }
      const kind = media.kindOf(f);
      if (kind === 'audio') return null;
      const r = await ff(['-hide_banner', '-loglevel', 'error', ...(kind === 'video' ? ['-ss', '1'] : []), '-i', src, '-frames:v', '1', '-vf', "scale='min(160,iw)':-2", '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '5', 'pipe:1']);
      return r.out.length ? 'data:image/jpeg;base64,' + r.out.toString('base64') : null;
    } catch { return null; }
  });
  ipcMain.handle('conv:start', (_, jobs) => { for (const j of jobs) { cancelled.delete(j.id); queue.push(j); } pump(); return true; });
  ipcMain.handle('conv:cancel', (_, ids) => { for (const id of ids) { cancelled.add(id); const p = procs.get(id); if (p) try { p.kill(); } catch {} } return true; });
  ipcMain.handle('conv:pdfAll', async (_, files, outDir) => {
    try {
      const dir = outDir || path.dirname(files[0]); const out = media.uniqueOut(dir, 'Pictures ' + new Date().toISOString().slice(0, 10), 'pdf');
      const tmp = [];
      for (const f of files) if (media.isHeic(f)) { const t = path.join(UD, 'cache', 'pdf_' + tmp.length + '.jpg'); await media.heic(f, t, { format: 'JPEG', quality: .9 }); tmp.push(t); } else tmp.push(f);
      await media.imagesToPdf(tmp, out); return { out };
    } catch (e) { return { error: e.message }; }
  });
  ipcMain.handle('conv:addFiles', async () => {
    const r = await dialog.showOpenDialog(cWin, { title: 'Add files to convert', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Pictures, videos & audio', extensions: [...media.EXT.image, ...media.EXT.video, ...media.EXT.audio] }, { name: 'All files', extensions: ['*'] }] });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('conv:addFolder', async () => {
    const r = await dialog.showOpenDialog(cWin, { title: 'Add every picture, video and song in a folder', properties: ['openDirectory'] });
    if (r.canceled) return [];
    const out = []; const walk = (d, n) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory() && n < 3) walk(p, n + 1); else if (e.isFile() && media.kindOf(p)) out.push(p); if (out.length > 2000) return; } };
    walk(r.filePaths[0], 0); return out;
  });
  ipcMain.handle('conv:outDir', async () => { const r = await dialog.showOpenDialog(cWin, { title: 'Save converted files in…', properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
  ipcMain.handle('conv:reveal', (_, p) => shell.showItemInFolder(p));
  ipcMain.handle('conv:openPath', (_, p) => shell.openPath(p));
  ipcMain.handle('conv:editor', () => { openMainWindow(); return true; });

  return { openConverter, wantsConverter, fileArgs, isOpen: () => !!cWin };
};
