// Hidden photo-checker window: receives decoded pictures from the main process, returns measurements.
const { contextBridge, ipcRenderer: r } = require('electron');
contextBridge.exposeInMainWorld('cullHost', {
  onJob: fn => r.on('cull:job', (_, j) => fn(j)),
  result: res => r.send('cull:result', res),
  ready: info => r.send('cull:ready', info)
});
