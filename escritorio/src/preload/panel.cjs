// Presentazo para escritorio: funciones que el panel puede pedir al proceso principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('presentazo', {
  get: () => ipcRenderer.invoke('panel:get'),
  onUpdate: (fn) => ipcRenderer.on('panel:update', (_e, snap) => fn(snap)),
  onShow: (fn) => ipcRenderer.on('panel:show', (_e, view) => fn(view)),
  newCode: () => ipcRenderer.invoke('panel:new-code'),
  kick: (id) => ipcRenderer.invoke('panel:kick', String(id)),
  setSettings: (patch) => ipcRenderer.invoke('panel:settings', patch),
  askPermission: () => ipcRenderer.invoke('panel:permission'),
  copyLink: () => ipcRenderer.invoke('panel:copy'),
  open: (url) => ipcRenderer.invoke('panel:open', String(url)),
  sources: (kind) => ipcRenderer.invoke('panel:sources', String(kind)),
  setTarget: (sel) => ipcRenderer.invoke('panel:target', sel),
  identify: (id) => ipcRenderer.invoke('panel:identify', String(id)),
});
