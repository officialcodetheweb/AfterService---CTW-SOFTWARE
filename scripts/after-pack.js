// Hardens the packaged Windows app (electron-builder afterPack hook):
//  - the app only loads from app.asar (a loose, edited copy of the code next to it is ignored)
//  (Embedded asar integrity validation is NOT enabled: with electron-builder 25.1.8 + Electron 33 the
//   packaged app then fails to start with "Failed to find file integrity info for resources\\app.asar".)
//  - the program can't be used as a plain Node.js runner or started with debugging flags
// Set AS_NO_FUSES=1 to skip this step (for troubleshooting a build).
const path = require('path');
exports.default = async ctx => {
  if (ctx.electronPlatformName !== 'win32' || process.env.AS_NO_FUSES) return;
  const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
  const exe = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  await flipFuses(exe, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true
  });
  console.log('  • security fuses applied  file=' + path.basename(exe));
};
