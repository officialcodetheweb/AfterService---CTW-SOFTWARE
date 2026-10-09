const { contextBridge, ipcRenderer: r } = require('electron');
contextBridge.exposeInMainWorld('mini', {
  onState: fn => r.on('mini:state', (_, s) => fn(s)), onLevels: fn => r.on('mini:levels', (_, l) => fn(l)), cmd: c => r.send('mini:cmd', c)
});
