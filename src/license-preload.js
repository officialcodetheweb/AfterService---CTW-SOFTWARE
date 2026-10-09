const { contextBridge, ipcRenderer: r } = require('electron');
contextBridge.exposeInMainWorld('lic', {
  onState: fn => r.on('lic:state', (_, s) => fn(s)),
  activate: k => r.invoke('lic:activate', k), file: () => r.invoke('lic:file'), copy: t => r.invoke('lic:copy', t), quit: () => r.invoke('lic:quit'), paste: () => r.invoke('lic:paste')
});
