const { contextBridge, ipcRenderer: r, webUtils } = require('electron');
const c = ch => (...a) => r.invoke(ch, ...a), on = ch => fn => r.on(ch, (_, ...a) => fn(...a));
contextBridge.exposeInMainWorld('conv', {
  init: c('conv:init'), info: c('conv:info'), thumb: c('conv:thumb'), start: c('conv:start'), cancel: c('conv:cancel'), pdfAll: c('conv:pdfAll'),
  addFiles: c('conv:addFiles'), addFolder: c('conv:addFolder'), outDir: c('conv:outDir'), reveal: c('conv:reveal'), openPath: c('conv:openPath'), editor: c('conv:editor'),
  onAdd: on('conv:add'), onState: on('conv:state'), onDone: on('conv:done'),
  pathFor: f => { try { return webUtils.getPathForFile(f); } catch { return ''; } }
});
