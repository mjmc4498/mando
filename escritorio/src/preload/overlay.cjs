// Presentazo para escritorio: la capa del puntero recibe órdenes y avisa cuando queda vacía.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('presentazo', {
  onCommand: (fn) => ipcRenderer.on('overlay:cmd', (_e, cmd) => fn(cmd)),
  ready: () => ipcRenderer.send('overlay:ready'),
  idle: () => ipcRenderer.send('overlay:idle'),
});
