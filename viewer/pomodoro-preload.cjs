// PetPet 番茄时钟 - preload 桥接（最小暴露面）
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pomoAPI', {
  get: () => ipcRenderer.invoke('pomodoro:get'),
  onState: (cb) => ipcRenderer.on('pomodoro:state', (_e, s) => cb(s)),
  start: () => ipcRenderer.send('pomodoro:start'),
  pause: () => ipcRenderer.send('pomodoro:pause'),
  reset: () => ipcRenderer.send('pomodoro:reset'),
  skip: () => ipcRenderer.send('pomodoro:skip'),
  set: (cfg) => ipcRenderer.send('pomodoro:set', cfg),
  close: () => ipcRenderer.send('pomodoro:close')
})
