// Stops the Windows build early if the licence system is not set up (run "npm run license" once first).
const fs = require('fs'), path = require('path'), R = path.join(__dirname, '..');
const need = [['src/license-pub.json', 'Run  npm run license  once to create your licence keys.'], ['build/license-pub.nsh', 'Run  npm run license  once to create your licence keys.'], ['build/aslic.exe', 'build\\aslic.exe is missing (copy it from tools\\aslic\\aslic.exe).']];
let bad = false; for (const [f, m] of need) if (!fs.existsSync(path.join(R, f))) { console.error('✖ ' + f + ' — ' + m); bad = true; }
if (bad) process.exit(1); console.log('Licence setup OK');
