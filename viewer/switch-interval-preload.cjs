// PetPet 动画切换间隔 - preload 桥接（最小暴露面）
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('switchAPI', {
  get: () => ipcRenderer.invoke('switchinterval:get'),
  apply: (ms) => ipcRenderer.send('switchinterval:apply', ms),
  close: () => ipcRenderer.send('switchinterval:close')
})
