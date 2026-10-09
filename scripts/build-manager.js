/* Builds the installer for the Licence Manager (CTW Software only):  npm run dist:manager
   The installer contains NO keys — on first start you import license-keys\private.pem (or it uses the project's
   license-keys folder when started from the project with  npm run license). */
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..'), APP = path.join(ROOT, 'tools', 'license-generator');
(async () => {
  fs.mkdirSync(path.join(APP, 'build'), { recursive: true });
  for (const f of ['icon.ico']) if (fs.existsSync(path.join(ROOT, 'build', f))) fs.copyFileSync(path.join(ROOT, 'build', f), path.join(APP, 'build', f));
  if (fs.existsSync(path.join(ROOT, 'assets', 'icon.png'))) fs.copyFileSync(path.join(ROOT, 'assets', 'icon.png'), path.join(APP, 'icon.png'));
  const electronVersion = require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version;
  const { build, Platform, Arch } = require('electron-builder');
  await build({
    projectDir: APP, targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish: 'never',
    config: {
      appId: 'com.ctw.afterservice.licencemanager', publish: [], productName: 'After Service Licence Manager', electronVersion,
      directories: { output: path.join(ROOT, 'dist', 'licence-manager'), buildResources: 'build' },
      files: ['main.js', 'preload.js', 'ui.js', 'index.html', 'icon.png', 'package.json'],
      win: { icon: 'build/icon.ico' },
      nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, shortcutName: 'After Service Licence Manager', artifactName: 'After Service Licence Manager Setup ${version}.exe' }
    }
  });
  const out = path.join(ROOT, 'dist', 'licence-manager'), exe = fs.readdirSync(out).find(f => /Setup .*\.exe$/.test(f));
  console.log(`\n✔ Licence Manager installer: ${path.join(out, exe || '')}\n  (keep it private — it is only for CTW Software)`);
})().catch(e => { console.error(e); process.exit(1); });
