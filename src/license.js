/* =====================================================================
   After Service — licence protection (main process)
   - Licence = signed by CTW Software's private key (ECDSA P-256), tied to one Device ID, with an expiry time.
   - Device ID comes from resources\aslic.exe (the same helper the installer uses), so both always agree.
   - install.bind (written by the installer) remembers which computer the program was installed on:
     a copied install folder started on another computer triggers a THEFT ALERT and nothing runs.
   - The system clock is watched so turning the date back does not extend a licence.
   ===================================================================== */
const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const path = require('path'), fs = require('fs'), crypto = require('crypto'), os = require('os');
const { execFile } = require('child_process');

const PUB_FILE = path.join(__dirname, 'license-pub.json');
const b64u = b => Buffer.from(b, 'base64url');
const fmtDate = s => new Date(s * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

module.exports = function initLicense({ UD }) {
  const LIC_FILE = path.join(UD, 'license.key'), STATE_FILE = path.join(UD, 'license.state'), LOG_FILE = path.join(UD, 'security.log');
  let pub = null; try { const j = JSON.parse(fs.readFileSync(PUB_FILE, 'utf8')); pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(j.x, 'hex').toString('base64url'), y: Buffer.from(j.y, 'hex').toString('base64url') }, format: 'jwk' }); } catch { pub = null; }
  let hwidCache = null, current = null, lockWin = null, timer = null, revokedFor = () => null, lastStart = null, lastOnLock = null;

  const helperPath = () => {
    const c = [app.isPackaged && path.join(process.resourcesPath, 'aslic.exe'), path.join(__dirname, '..', 'build', 'aslic.exe'), path.join(__dirname, '..', 'tools', 'aslic', 'aslic.exe')].filter(Boolean);
    return c.find(p => fs.existsSync(p));
  };
  function hwid() {
    if (hwidCache) return Promise.resolve(hwidCache);
    return new Promise(res => {
      const h = process.platform === 'win32' && helperPath();
      if (!h) {   // development on a non-Windows machine only
        const d = crypto.createHash('sha256').update('AS1|' + os.hostname() + '|' + os.cpus()[0].model + '|' + os.userInfo().username).digest();
        return res(hwidCache = d.subarray(0, 10).toString('hex').toUpperCase().match(/.{4}/g).join('-'));
      }
      execFile(h, ['hwid'], { windowsHide: true, timeout: 15000 }, (err, out) => res(hwidCache = (!err && /^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/.test(String(out).trim())) ? String(out).trim() : 'UNKNOWN'));
    });
  }

  function parse(key) {
    // Same rules as aslic.exe: use the LAST key in the text, ignore line breaks, signature = exactly 86 characters.
    const txt = String(key || ''), at = txt.lastIndexOf('ASL1.');
    if (at < 0) return { error: 'This is not an After Service licence key.' };
    const m = /^ASL1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{86})/.exec(txt.slice(at).replace(/[\s"]+/g, ''));
    if (!m) return { error: 'The licence key is incomplete. Copy it again exactly as you received it.' };
    const k = 'ASL1.' + m[1] + '.' + m[2];
    const payload = b64u(m[1]), sig = b64u(m[2]);
    if (!pub) return { error: 'Licence checking is not set up in this build.' };
    let ok = false; try { ok = sig.length === 64 && crypto.verify('sha256', payload, { key: pub, dsaEncoding: 'ieee-p1363' }, sig); } catch {}
    if (!ok) return { error: 'This licence key is not genuine.' };
    const f = Object.fromEntries(payload.toString('utf8').split(';').map(p => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
    return { key: k, hw: f.hw, exp: +f.exp, iss: +f.iss, name: f.name || '', id: f.id || '' };
  }
  const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } };
  const writeState = s => { try { fs.writeFileSync(STATE_FILE, JSON.stringify(s)); } catch {} };
  function logEvent(msg) { try { fs.mkdirSync(UD, { recursive: true }); fs.appendFileSync(LOG_FILE, `${new Date().toISOString()}  ${msg}\n`); } catch {} }

  /* Full check. Returns { ok } or { ok:false, kind:'theft'|'missing'|'invalid'|'device'|'expired'|'clock', ... } */
  async function check(keyOverride) {
    const me = await hwid(), now = Math.floor(Date.now() / 1000);
    // 1) theft: this installation was made on another computer
    if (app.isPackaged) {
      const bindFile = path.join(process.resourcesPath, 'install.bind');
      let bound = null; try { bound = fs.readFileSync(bindFile, 'utf8').replace(/[^0-9A-F-]/gi, '').toUpperCase(); } catch {}
      if (!bound) return { ok: false, kind: 'theft', me, reason: 'missing' };
      if (bound !== me) return { ok: false, kind: 'theft', me, bound };
    }
    // 2) licence
    let key = keyOverride; if (key == null) { try { key = fs.readFileSync(LIC_FILE, 'utf8'); } catch { key = ''; } }
    if (!String(key).trim()) return { ok: false, kind: 'missing', me };
    const L = parse(key); if (L.error) return { ok: false, kind: 'invalid', me, msg: L.error };
    if (String(L.hw).toUpperCase() !== me) return { ok: false, kind: 'device', me, lic: L };
    // 3) clock rolled back?
    const st = readState();
    if (st.last && now < st.last - 3 * 3600) return { ok: false, kind: 'clock', me, lic: L, last: st.last };
    if (now >= L.exp) return { ok: false, kind: 'expired', me, lic: L };
    // cancelled by CTW (a signed cancellation from the online service)
    const rv = revokedFor(L.id); if (rv) return { ok: false, kind: 'revoked', me, lic: L };
    return { ok: true, me, lic: L };
  }
  function touch() { const st = readState(), now = Math.floor(Date.now() / 1000); if (!st.last || now > st.last) { st.last = now; writeState(st); } }

  /* ---------------- windows ---------------- */
  function showLock(state, onActivated) {
    if (lockWin && !lockWin.isDestroyed()) { lockWin.webContents.send('lic:state', view(state)); lockWin.show(); lockWin.focus(); return lockWin; }
    const theft = state.kind === 'theft';
    lockWin = new BrowserWindow({
      width: theft ? 580 : 640, height: theft ? 580 : 660, useContentSize: true, resizable: false, maximizable: false, minimizable: !theft, backgroundColor: '#0b0a09', show: false,
      title: theft ? 'After Service — Security alert' : 'After Service — Activate', icon: path.join(__dirname, '..', 'assets', 'icon.png'), autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'license-preload.js'), contextIsolation: true, nodeIntegration: false, devTools: !app.isPackaged && !!process.env.AS_DEVTOOLS }
    });
    lockWin.setMenu(null);
    lockWin.loadFile(path.join(__dirname, 'license.html'));
    lockWin.webContents.once('did-finish-load', () => { lockWin.webContents.send('lic:state', view(state)); lockWin.show(); });
    lockWin.on('closed', () => { lockWin = null; if (!current || !current.ok) app.quit(); });
    lockWin._onActivated = onActivated;
    return lockWin;
  }
  function view(s) {
    const v = { kind: s.kind, me: s.me };
    if (s.lic) { v.name = s.lic.name; v.exp = fmtDate(s.lic.exp); v.licHw = s.lic.hw; }
    if (s.kind === 'theft') v.bound = s.bound || '';
    if (s.kind === 'invalid') v.msg = s.msg;
    if (s.kind === 'clock') v.last = fmtDate(s.last);
    if (s.kind === 'revoked') v.msg = 'CTW Software cancelled this licence. Contact CTW Software if you think this is a mistake.';
    return v;
  }

  ipcMain.handle('lic:activate', async (e, key) => {
    const r = await check(key);
    if (r.kind === 'theft') return { ok: false, msg: 'This copy of After Service belongs to another computer.' };
    if (!r.ok) {
      const msg = { missing: 'Please paste your licence key.', invalid: r.msg, device: `This licence was issued for another computer (${r.lic && r.lic.hw}). Your Device ID is ${r.me}.`, expired: `This licence expired on ${r.lic && fmtDate(r.lic.exp)}.`, revoked: 'This licence was cancelled by CTW Software.', clock: 'Your computer clock is wrong. Set the correct date and time, then try again.' }[r.kind];
      logEvent(`activation refused (${r.kind}) device=${r.me}`); return { ok: false, msg };
    }
    fs.mkdirSync(UD, { recursive: true }); fs.writeFileSync(LIC_FILE, r.lic.key); touch();
    logEvent(`licence activated id=${r.lic.id} device=${r.me} expires=${new Date(r.lic.exp * 1000).toISOString()}`);
    current = r; const w = lockWin, cb = w && w._onActivated;
    setTimeout(() => { if (cb) cb(r); if (w && !w.isDestroyed()) { w.removeAllListeners('closed'); w.destroy(); } if (lockWin === w) lockWin = null; }, 900);
    return { ok: true, msg: `Activated${r.lic.name ? ' for ' + r.lic.name : ''} — valid until ${fmtDate(r.lic.exp)}.` };
  });
  ipcMain.handle('lic:file', async () => {
    const r = await dialog.showOpenDialog(lockWin, { title: 'Open your licence file', properties: ['openFile'], filters: [{ name: 'After Service licence', extensions: ['aslicense', 'txt', 'key'] }] });
    if (r.canceled) return null; try { return fs.readFileSync(r.filePaths[0], 'utf8').trim(); } catch { return null; }
  });
  ipcMain.handle('lic:copy', (_, t) => { clipboard.writeText(String(t)); return true; });
  ipcMain.handle('lic:quit', () => app.quit());
  ipcMain.handle('lic:paste', () => clipboard.readText());
  ipcMain.handle('lic:info', async () => { const r = current && current.ok ? current : await check(); return r.ok ? { name: r.lic.name, exp: fmtDate(r.lic.exp), expTs: r.lic.exp, me: r.me, hoursLeft: Math.max(0, (r.lic.exp - Date.now() / 1000) / 3600) } : null; });

  /* Gate: run before any window opens. start() is called once the licence is valid. */
  async function gate(start, onLock) {
    if (!app.isPackaged && !process.env.AS_LICENSE) { current = { ok: true, dev: true }; return start(); }
    lastStart = start; lastOnLock = onLock;
    const r = await check();
    if (r.kind === 'theft') {
      logEvent(`THEFT ALERT — installation from device ${r.bound || '(missing fingerprint)'} started on device ${r.me} — ${process.execPath}`);
      return showLock(r, null);
    }
    lastStart = start; lastOnLock = onLock;
    if (!r.ok) { logEvent(`licence required (${r.kind}) device=${r.me}`); current = r; return showLock(r, () => { start(); watch(onLock, start); }); }
    current = r; touch(); start(); watch(onLock, start);
  }
  // Re-check every minute: an expiring licence (or a copied folder) stops the app straight away.
  function watch(onLock, start) {
    clearInterval(timer);
    timer = setInterval(async () => {
      touch();
      const r = await check();
      if (r.ok) { current = r; return; }
      current = r; logEvent(`locked while running (${r.kind}) device=${r.me}`);
      clearInterval(timer);
      showLock(r, r.kind === 'theft' ? null : () => { start(); watch(onLock, start); });
      onLock(r);
      BrowserWindow.getAllWindows().forEach(w => { if (w !== lockWin && !w.isDestroyed()) w.destroy(); });
    }, 60 * 1000);
  }
  /* ---------- for the online service ---------- */
  // the licence on this computer (also when expired or cancelled — so an extension can still arrive)
  async function currentLic() {
    let key = ''; try { key = fs.readFileSync(LIC_FILE, 'utf8'); } catch {}
    const L = parse(key); if (L.error) return null;
    const me = await hwid(); if (String(L.hw).toUpperCase() !== me) return null;
    return { id: L.id, hw: me, name: L.name, key: L.key, exp: L.exp };
  }
  // a newer key arrived (extension): install it, and unlock if the app was locked
  async function install(key) {
    const r = await check(key);
    if (!r.lic || r.kind === 'invalid' || r.kind === 'device' || r.kind === 'theft') return { ok: false };
    fs.writeFileSync(LIC_FILE, r.lic.key); logEvent(`licence updated online id=${r.lic.id} expires=${new Date(r.lic.exp * 1000).toISOString()}`);
    await recheck(); return { ok: true, until: fmtDate(r.lic.exp) };
  }
  // look again now (after an online change): lock straight away, or unlock
  async function recheck() {
    if (!app.isPackaged && !process.env.AS_LICENSE) return;
    const was = !!(current && current.ok), r = await check(); current = r.ok ? r : r;
    if (r.ok && !was) {
      logEvent('unlocked by an online change');
      // open the app first, then close the lock window (closing the last window would quit the app)
      const w = lockWin; lockWin = null;
      if (lastStart) { lastStart(); watch(lastOnLock || (() => {}), lastStart); }
      if (w && !w.isDestroyed()) { w.removeAllListeners('closed'); setTimeout(() => { if (!w.isDestroyed()) w.destroy(); }, 300); }
    } else if (!r.ok && was) {
      logEvent(`locked by an online change (${r.kind})`); clearInterval(timer);
      showLock(r, r.kind === 'theft' ? null : () => { lastStart && lastStart(); watch(lastOnLock || (() => {}), lastStart); });
      if (lastOnLock) lastOnLock(r);
      BrowserWindow.getAllWindows().forEach(w => { if (w !== lockWin && !w.isDestroyed()) w.destroy(); });
    } else if (!r.ok && lockWin && !lockWin.isDestroyed()) lockWin.webContents.send('lic:state', view(r));
  }
  const api = { current: currentLic, install, recheck, setRevoked: f => { revokedFor = f; }, locked: () => !!(current && !current.ok && current.kind !== 'theft') };
  const isOk = () => !!(current && current.ok);
  const focusLock = () => { if (lockWin && !lockWin.isDestroyed()) { lockWin.show(); lockWin.focus(); return true; } return false; };
  return { gate, check, hwid, isOk, focusLock, api };
};
