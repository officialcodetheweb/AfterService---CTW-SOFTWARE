/* Builds the Windows installer, protected against "EBUSY: resource busy or locked".
   Windows briefly locks freshly written .exe files (Windows Defender scanning, OneDrive syncing the Desktop,
   or an After Service / Player window still running from dist\). This script:
     1. closes any After Service started from this project's dist\ folder (your installed copy is not touched)
     2. empties dist\win-unpacked, waiting for locks to clear
     3. runs electron-builder with automatic retries whenever a file is temporarily locked              */
const path = require('path'), fs = require('fs'), fsp = require('fs/promises'), { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..'), DIST = path.join(ROOT, 'dist'), UNPACKED = path.join(DIST, 'win-unpacked');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LOCKED = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']);

// --- 1. close copies running from dist\ ---------------------------------------------------------
if (process.platform === 'win32') {
  try {
    const ps = `Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith('${DIST.replace(/'/g, "''")}', 'OrdinalIgnoreCase') } | ForEach-Object { $_.Name + ' (' + $_.Id + ')'; Stop-Process -Id $_.Id -Force }`;
    const out = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out) console.log('  • closed running copies from dist\\: ' + out.split(/\r?\n/).join(', '));
  } catch {}
}

// --- 2. make file writes wait for temporary locks ------------------------------------------------
// electron-builder reads these functions from fs/promises at call time, so wrapping them here covers it.
let retried = 0;
const testFail = { n: +process.env.AS_TEST_EBUSY || 0 };   // test hook: simulate N locked writes
for (const name of ['writeFile', 'open', 'rename', 'copyFile', 'unlink', 'rm', 'utimes', 'chmod']) {
  const orig = fsp[name]; if (typeof orig !== 'function') continue;
  const wrapped = async function (...args) {
    for (let attempt = 1; ; attempt++) {
      try {
        if (testFail.n > 0 && name === 'writeFile' && String(args[0]).endsWith('.exe')) { testFail.n--; const e = new Error('EBUSY: resource busy or locked (simulated)'); e.code = 'EBUSY'; throw e; }
        return await orig.apply(this, args);
      } catch (e) {
        if (!LOCKED.has(e.code) || attempt >= 40) throw e;
        if (attempt === 1) console.log(`  • ${path.basename(String(args[0]))} is locked by Windows (antivirus / OneDrive / running app) — waiting…`);
        retried++; await sleep(Math.min(250 * attempt, 2000));
      }
    }
  };
  fsp[name] = wrapped; if (fs.promises[name] !== wrapped) fs.promises[name] = wrapped;
}

(async () => {
  // --- 3. clean the previous unpacked app -------------------------------------------------------
  if (fs.existsSync(UNPACKED)) {
    try { await fsp.rm(UNPACKED, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }); }
    catch (e) {
      console.error(`\n✖ Could not delete ${UNPACKED}\n  Something is still using it. Close After Service and After Service Player (check the tray icon near the clock),\n  close any File Explorer window showing the dist folder, then run the build again.\n`);
      process.exit(1);
    }
  }
  // --- 4. build, retrying the whole build once if a lock outlasts the per-file waits ---------------
  const { build, Platform } = require('electron-builder');
  for (let run = 1; run <= 3; run++) {
    try {
      await build({ targets: Platform.WINDOWS.createTarget('nsis'), publish: 'never' });
      const exe = fs.readdirSync(DIST).find(f => /Setup .*\.exe$/.test(f) && !f.endsWith('.blockmap'));
      console.log(`\n✔ Installer ready: ${path.join(DIST, exe || '')}` + (retried ? `  (waited for ${retried} locked file operation${retried === 1 ? '' : 's'})` : ''));
      return;
    } catch (e) {
      if (!LOCKED.has(e.code) || run === 3) {
        if (LOCKED.has(e.code)) console.error(`\n✖ A file stayed locked: ${e.path || e.message}\n  Tips: close After Service / the Player (tray icon), close Explorer windows on dist, pause OneDrive syncing,\n  or add this project folder to Windows Security → Virus & threat protection → Exclusions.\n`);
        else console.error(e);
        process.exit(1);
      }
      console.log(`  • build hit a locked file (${e.code}), retrying in 5 s… (attempt ${run + 1} of 3)`);
      await sleep(5000);
      try { await fsp.rm(UNPACKED, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }); } catch {}
    }
  }
})();
