/* =====================================================================
   After Service — import photos & videos from a phone or camera (USB cable)
   - iPhone / Android phones connect as "portable devices" (MTP) and are read through the Windows Shell
     (the same way File Explorer does it) by a small PowerShell helper.
   - Memory cards / cameras that show up as a drive letter are read directly.
   - HEIC photos are converted to JPG (EXIF kept); every other file is copied unchanged.
   - Files already imported from the same device are skipped next time.
   ===================================================================== */
const { app, ipcMain, dialog } = require('electron');
const path = require('path'), fs = require('fs'), { spawn } = require('child_process');

const MEDIA = /\.(heic|heif|jpe?g|png|gif|webp|bmp|tiff?|dng|raw|cr2|cr3|nef|arw|mov|mp4|m4v|3gp|avi|mts|m2ts|mkv|hevc)$/i;
const VIDEO = /\.(mov|mp4|m4v|3gp|avi|mts|m2ts|mkv|hevc)$/i;
const HEIC = /\.(heic|heif)$/i;

const PS = String.raw`
param([string]$Mode, [string]$Dev = '', [string]$ListFile = '', [string]$Dest = '')
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$sh = New-Object -ComObject Shell.Application
function J($o) { $o | ConvertTo-Json -Compress -Depth 4 }
function Kids($it) { $r = @(); try { $f = $it.GetFolder; if ($f) { foreach ($c in $f.Items()) { $r += ,$c } } } catch {}; return $r }   # always use as @(Kids x)
function Is-Apple($it) { return ($it.Name -match 'iPhone|iPad|iPod|Apple') }
function Get-Devs {
  $list = @()
  # a fresh Shell every time: Windows keeps an old "locked" view of a phone otherwise
  $sh = New-Object -ComObject Shell.Application
  foreach ($it in $sh.NameSpace(17).Items()) {
    if ($it.IsFileSystem) { continue }
    if ($it.Path -notmatch '\\\\\?\\') { continue }                     # portable devices only (WPD/MTP)
    $n = @(Kids $it).Count
    if ($n -eq 0) { try { $ns = $sh.NameSpace($it.Path); if ($ns) { $n = @($ns.Items()).Count } } catch {} }
    $list += [pscustomobject]@{ kind = 'mtp'; id = $it.Path; name = $it.Name; ready = ($n -gt 0); apple = [bool](Is-Apple $it) }
  }
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($sh)
  foreach ($d in [System.IO.DriveInfo]::GetDrives()) {
    if (-not $d.IsReady) { continue }
    if ($d.DriveType -ne 'Removable' -and $d.DriveType -ne 'Fixed') { continue }
    if ($d.RootDirectory.FullName -eq ($env:SystemDrive + '\')) { continue }
    $dcim = Join-Path $d.RootDirectory.FullName 'DCIM'
    if (-not (Test-Path -LiteralPath $dcim)) { continue }
    $label = $d.VolumeLabel; if (-not $label) { $label = 'Memory card' }
    $list += [pscustomobject]@{ kind = 'drive'; id = 'drive:' + $d.Name; name = ($label + ' (' + $d.Name.TrimEnd('\') + ')'); root = $d.RootDirectory.FullName; ready = $true }
  }
  ,$list
}
function Find-Dev($id) { foreach ($it in $sh.NameSpace(17).Items()) { if ($it.Path -eq $id) { return $it } }; return $null }
function FName($item) { $n = $item.ExtendedProperty('System.FileName'); if (-not $n) { $n = $item.Name }; return $n }
# phone storage ("Internal Storage", "Internal shared storage") is not always reported as a folder, so look inside anything that opens
function Is-Dir($c) {
  if ($c.IsFolder) { return $true }
  try { $f = $c.GetFolder; if ($f) { return $true } } catch {}
  return $false
}
function Media-Roots($dev) {
  $roots = @()
  $tops = @(Kids $dev)
  # some iPhones show DCIM straight away, without an "Internal Storage" level
  foreach ($c in $tops) { if ((FName $c) -ieq 'DCIM' -and (Is-Dir $c)) { $roots += ,@($c, 'DCIM') } }
  if ($roots.Count) { return ,$roots }
  foreach ($st in $tops) {
    if (-not (Is-Dir $st)) { continue }
    $kids = @(Kids $st); $found = $false
    foreach ($c in $kids) { if ((FName $c) -ieq 'DCIM' -and (Is-Dir $c)) { $roots += ,@($c, ((FName $st) + '/DCIM')); $found = $true } }
    if (-not $found) { foreach ($c in $kids) { $nm = FName $c; if ((Is-Dir $c) -and @('Pictures','Movies','Videos','Camera','WhatsApp') -icontains $nm) { $roots += ,@($c, ((FName $st) + '/' + $nm)) } } }
  }
  ,$roots
}
function Walk($folder, $rel, $depth) {
  foreach ($c in @(Kids $folder)) {
    $nm = FName $c
    if (Is-Dir $c) { if ($depth -lt 6) { Walk $c ($rel + '/' + $nm) ($depth + 1) } ; continue }
    $sz = $c.ExtendedProperty('System.Size'); if (-not $sz) { $sz = $c.Size }
    $dt = $c.ModifyDate; $ds = ''; try { $ds = ([DateTime]$dt).ToUniversalTime().ToString('o') } catch {}
    [Console]::Out.WriteLine((J ([pscustomobject]@{ rel = ($rel + '/' + $nm); size = [int64]$sz; mtime = $ds })))
  }
}
if ($Mode -eq 'watch') {
  $last = ''
  while ($true) {
    $j = J (Get-Devs); if ($j -ne $last) { [Console]::Out.WriteLine('DEVS ' + $j); [Console]::Out.Flush(); $last = $j }
    Start-Sleep -Seconds 3
  }
}
if ($Mode -eq 'list') {
  $dev = $null; $roots = @()
  for ($try = 0; $try -lt 4; $try++) {
    $sh = New-Object -ComObject Shell.Application
    $dev = Find-Dev $Dev
    if ($dev) { $roots = Media-Roots $dev; if ($roots.Count -gt 0) { break } }
    Start-Sleep -Seconds 2
  }
  if (-not $dev) { [Console]::Out.WriteLine('ERR not-found'); exit 2 }
  if ($roots.Count -eq 0) {
    $tops = @(Kids $dev)
    if ($tops.Count -eq 0) { [Console]::Out.WriteLine('ERR locked'); exit 3 }
    [Console]::Out.WriteLine('ERR nophotos ' + (($tops | ForEach-Object { FName $_ }) -join ', ')); exit 4
  }
  foreach ($r in $roots) { Walk $r[0] $r[1] 0 }
  [Console]::Out.WriteLine('END'); exit 0
}
if ($Mode -eq 'copy') {
  $dev = Find-Dev $Dev; if (-not $dev) { [Console]::Out.WriteLine('ERR not-found'); exit 2 }
  $stage = Join-Path $Dest '.incoming'; New-Item -ItemType Directory -Force -Path $stage | Out-Null
  Get-ChildItem -LiteralPath $stage -File | Remove-Item -Force
  $target = $sh.NameSpace($stage)
  foreach ($line in [System.IO.File]::ReadAllLines($ListFile, [System.Text.Encoding]::UTF8)) {
    if (-not $line) { continue }
    $parts = $line.Split([char]9); $rel = $parts[0]; $expect = [int64]$parts[1]; $outName = $parts[2]
    $folder = $dev; $item = $null; $segs = $rel.Split('/')
    for ($i = 0; $i -lt $segs.Count; $i++) {
      $next = $null; foreach ($c in @(Kids $folder)) { if ((FName $c) -ieq $segs[$i]) { $next = $c; break } }
      if (-not $next) { break }; if ($i -eq $segs.Count - 1) { $item = $next } else { $folder = $next }
    }
    if (-not $item) { [Console]::Out.WriteLine('FAIL ' + $rel + [char]9 + 'missing on device'); [Console]::Out.Flush(); continue }
    $target.CopyHere($item, 1556)
    $limit = (Get-Date).AddSeconds(60 + [Math]::Ceiling($expect / 2MB)); $prev = -1; $stable = 0; $got = $null
    while ((Get-Date) -lt $limit) {
      Start-Sleep -Milliseconds 400
      $f = Get-ChildItem -LiteralPath $stage -File | Select-Object -First 1
      if (-not $f) { continue }
      if ($f.Length -gt 0 -and $f.Length -eq $prev) { $stable++ } else { $stable = 0 }
      $prev = $f.Length
      if (($expect -gt 0 -and $f.Length -ge $expect -and $stable -ge 1) -or $stable -ge 4) { $got = $f; break }
    }
    if (-not $got) { [Console]::Out.WriteLine('FAIL ' + $rel + [char]9 + 'timed out'); [Console]::Out.Flush(); Get-ChildItem -LiteralPath $stage -File | Remove-Item -Force; continue }
    $final = Join-Path $Dest $outName; $k = 2
    $base = [System.IO.Path]::GetFileNameWithoutExtension($outName); $ext = [System.IO.Path]::GetExtension($got.Name)
    $final = Join-Path $Dest ($base + $ext)
    while (Test-Path -LiteralPath $final) { $final = Join-Path $Dest ($base + ' (' + $k + ')' + $ext); $k++ }
    $moved = $false; for ($t = 0; $t -lt 25 -and -not $moved; $t++) { try { Move-Item -LiteralPath $got.FullName -Destination $final -ErrorAction Stop; $moved = $true } catch { Start-Sleep -Milliseconds 400 } }
    if ($moved) { [Console]::Out.WriteLine('OK ' + $rel + [char]9 + $final) } else { [Console]::Out.WriteLine('FAIL ' + $rel + [char]9 + 'could not save') }
    [Console]::Out.Flush()
  }
  Remove-Item -LiteralPath $stage -Recurse -Force
  [Console]::Out.WriteLine('END'); exit 0
}
`;

module.exports = function initDevices({ media, getCfg, UD, getWin }) {
  const psFile = path.join(UD, 'device-helper.ps1');
  try { fs.mkdirSync(UD, { recursive: true }); fs.writeFileSync(psFile, '\ufeff' + PS); } catch {}
  const runPS = (args, onLine) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', psFile, ...args], { windowsHide: true });
    let buf = ''; p.stdout.setEncoding('utf8');
    p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); if (l) onLine(l); } });
    return p;
  };
  let devices = [], watcher = null, job = null;
  const send = (ch, ...a) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, ...a); };

  /* ---------------- watching for devices ---------------- */
  function setDevices(list) {
    const test = process.env.AS_TEST_DEVICE_DIR;
    if (test && fs.existsSync(test)) list = [...list, { kind: 'drive', id: 'test:' + test, name: process.env.AS_TEST_DEVICE_NAME || 'Test camera', root: test, ready: true }];
    if (JSON.stringify(list) === JSON.stringify(devices)) return;
    devices = list; send('dev:list', devices);
  }
  function start() {
    if (watcher) return;
    if (process.platform !== 'win32') { setDevices([]); watcher = { kill() {} }; return; }
    watcher = runPS(['watch'], l => { if (l.startsWith('DEVS')) { try { const t = l.slice(4).trim(); let d = t ? JSON.parse(t) : []; if (!Array.isArray(d)) d = d ? [d] : []; setDevices(d); } catch {} } });
    watcher.on('exit', () => { watcher = null; });
  }
  function stop() { if (watcher) { try { watcher.kill(); } catch {} watcher = null; } }
  app.on('before-quit', () => { stop(); if (job && job.ps) try { job.ps.kill(); } catch {} });

  /* ---------------- listing files ---------------- */
  function walkDrive(root) {
    const out = [], base = fs.existsSync(path.join(root, 'DCIM')) ? path.join(root, 'DCIM') : root;
    const walk = (dir, depth) => {
      let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (depth < 6 && !e.name.startsWith('.')) walk(p, depth + 1); continue; }
        if (!MEDIA.test(e.name)) continue;
        let st; try { st = fs.statSync(p); } catch { continue; }
        out.push({ rel: path.relative(root, p).split(path.sep).join('/'), size: st.size, mtime: st.mtime.toISOString(), abs: p });
      }
    };
    walk(base, 0); return out;
  }
  function listMtp(dev, onCount) {
    return new Promise((res, rej) => {
      const files = []; let err = null;
      const p = runPS(['list', '-Dev', dev.id], l => {
        if (l.startsWith('ERR ')) err = l.slice(4);
        else if (l === 'END') {}
        else { try { const f = JSON.parse(l); if (MEDIA.test(f.rel)) { files.push(f); if (files.length % 25 === 0) onCount(files.length); } } catch {} }
      });
      p.on('exit', () => err === 'locked' ? rej(new Error('locked')) : err && err.startsWith('nophotos') ? rej(new Error(err)) : err ? rej(new Error(err)) : res(files));
    });
  }
  const devKey = dev => dev.kind === 'mtp' ? 'mtp:' + dev.name + '|' + (String(dev.id).match(/usb#[^#]+#([^#]+)/i) || [, dev.id])[1] : 'drive:' + dev.name.replace(/\s*\([A-Z]:\)$/, '');
  const importsRoot = () => { const c = getCfg(); return path.join(c && c.root ? c.root : app.getPath('pictures'), 'Imports'); };
  const indexFile = () => path.join(importsRoot(), '.after-service-imports.json');
  const readIndex = () => { try { return JSON.parse(fs.readFileSync(indexFile(), 'utf8')); } catch { return {}; } };
  const fileKey = f => f.rel.toLowerCase() + '|' + f.size;

  // a watched folder (hot folder) works like a memory card that is always plugged in
  const devOf = id => devices.find(d => d.id === id) || (String(id).startsWith('hot:') && fs.existsSync(id.slice(4)) ? { kind: 'drive', id, name: path.basename(id.slice(4)) || 'Hot folder', root: id.slice(4), ready: true, hot: true } : null);
  async function scan(devId) {
    const dev = devOf(devId); if (!dev) throw new Error('The device was disconnected.');
    const files = dev.kind === 'mtp' ? await listMtp(dev, n => send('dev:scanCount', n)) : walkDrive(dev.root);
    const done = readIndex()[devKey(dev)] || {};
    files.forEach(f => { f.isNew = !done[fileKey(f)]; f.heic = HEIC.test(f.rel); f.video = VIDEO.test(f.rel); });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const label = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')} ${dev.name.replace(/[\\/:*?"<>|]/g, '').replace(/\s*\(\w:\)$/, '')}`.trim();
    return { dev, files, dest: path.join(importsRoot(), label) };
  }

  /* ---------------- importing ---------------- */
  async function runImport(devId, files, opts) {
    const dev = devOf(devId); if (!dev) throw new Error('The device was disconnected.');
    const dest = opts.dest; fs.mkdirSync(dest, { recursive: true });
    const idx = readIndex(), key = devKey(dev); idx[key] = idx[key] || {};
    const res = { copied: 0, converted: 0, failed: [], pictures: [], videos: [], dest, total: files.length };
    job = { cancel: false, ps: null };
    const progress = (phase, extra = {}) => send('dev:progress', { phase, done: res.copied, total: files.length, converted: res.converted, failed: res.failed.length, ...extra });
    const converts = [];
    const finishFile = async (f, saved) => {
      idx[key][fileKey(f)] = path.basename(saved);
      if (opts.mtime !== false && f.mtime) { const d = new Date(f.mtime); if (!isNaN(d)) try { fs.utimesSync(saved, d, d); } catch {} }
      if (HEIC.test(saved) && opts.convertHeic) {
        const jpg = media.uniqueOut(path.dirname(saved), path.basename(saved, path.extname(saved)), 'jpg');
        converts.push(media.heic(saved, jpg, { format: 'JPEG', quality: (opts.quality || 92) / 100 }).then(() => {
          res.converted++; res.pictures.push(jpg);
          if (opts.keepHeic) { const od = path.join(dest, 'HEIC originals'); fs.mkdirSync(od, { recursive: true }); try { fs.renameSync(saved, media.uniqueOut(od, path.basename(saved, path.extname(saved)), path.extname(saved).slice(1))); } catch {} }
          else try { fs.unlinkSync(saved); } catch {}
          progress('copy', { file: path.basename(jpg) });
        }).catch(e => { res.failed.push({ rel: f.rel, error: 'HEIC conversion: ' + e.message }); res.pictures.push(saved); }));
      } else (VIDEO.test(saved) ? res.videos : res.pictures).push(saved);
    };
    const outName = f => path.basename(f.rel);
    try {
      if (dev.kind === 'mtp') {
        const list = path.join(dest, '.import-list.txt');
        fs.writeFileSync(list, files.map(f => [f.rel, f.size, outName(f)].join('\t')).join('\r\n'), 'utf8');
        await new Promise(resolve => {
          job.ps = runPS(['copy', '-Dev', dev.id, '-ListFile', list, '-Dest', dest], l => {
            const [head, info] = l.split('\t'), sp = head.indexOf(' '), tag = head.slice(0, sp), rel = head.slice(sp + 1), f = files.find(x => x.rel === rel);
            if (tag === 'OK' && f) { res.copied++; finishFile(f, info); progress('copy', { file: path.basename(info) }); }
            else if (tag === 'FAIL') { res.failed.push({ rel, error: info }); progress('copy', { file: rel }); }
          });
          job.ps.on('exit', resolve);
        });
        try { fs.unlinkSync(list); } catch {}
      } else {
        for (const f of files) {
          if (job.cancel) break;
          const src = f.abs || path.join(dev.root, ...f.rel.split('/'));
          const target = media.uniqueOut(dest, path.basename(f.rel, path.extname(f.rel)), path.extname(f.rel).slice(1));
          try { await fs.promises.copyFile(src, target); res.copied++; await finishFile(f, target); } catch (e) { res.failed.push({ rel: f.rel, error: e.message }); }
          progress('copy', { file: path.basename(f.rel) });
        }
      }
      if (converts.length) { progress('convert', { pending: converts.length }); await Promise.all(converts); }
    } finally {
      try { fs.mkdirSync(path.dirname(indexFile()), { recursive: true }); fs.writeFileSync(indexFile(), JSON.stringify(idx)); } catch {}
      res.cancelled = !!job.cancel; job = null;
    }
    return res;
  }

  /* ---------------- convert HEIC files already in a folder (picture editor) ---------------- */
  async function convertFolderHeic(dir, keepOriginals = true) {
    const list = fs.readdirSync(dir).filter(f => HEIC.test(f)); let ok = 0, n = 0; const fail = [];
    await Promise.all(list.map(async f => {
      const src = path.join(dir, f), jpg = media.uniqueOut(dir, path.basename(f, path.extname(f)), 'jpg');
      try {
        await media.heic(src, jpg, { format: 'JPEG', quality: .92 }); ok++;
        if (keepOriginals) { const od = path.join(dir, 'HEIC originals'); fs.mkdirSync(od, { recursive: true }); fs.renameSync(src, media.uniqueOut(od, path.basename(f, path.extname(f)), path.extname(f).slice(1))); }
      } catch (e) { fail.push(f + ': ' + e.message); }
      send('dev:heicProgress', { done: ++n, total: list.length });
    }));
    return { ok, fail };
  }

  /* ---------------- IPC ---------------- */
  ipcMain.handle('dev:list', () => devices);
  ipcMain.handle('dev:scan', (_, id) => scan(id).catch(e => ({ error: e.message })));
  ipcMain.handle('dev:import', (_, id, files, opts) => runImport(id, files, opts).catch(e => ({ error: e.message })));
  ipcMain.handle('dev:cancel', () => { if (job) { job.cancel = true; if (job.ps) try { job.ps.kill(); } catch {} } return true; });
  ipcMain.handle('dev:pickFolder', async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Choose a folder or memory card to import from', properties: ['openDirectory'] });
    if (r.canceled) return null;
    const root = r.filePaths[0], id = 'folder:' + root;
    devices = devices.filter(d => !String(d.id).startsWith('folder:')).concat([{ kind: 'drive', id, name: path.basename(root) || root, root, ready: true, manual: true }]);
    send('dev:list', devices); return id;
  });
  ipcMain.handle('fs:heicCount', (_, dir) => { try { return fs.readdirSync(dir).filter(f => HEIC.test(f)).length; } catch { return 0; } });
  ipcMain.handle('fs:convertHeic', (_, dir, keep) => convertFolderHeic(dir, keep));
  ipcMain.handle('dev:watch', () => { start(); return devices; });

  return { start, stop, scan, runImport };
};
