// PetPet 提醒面板 - preload 桥接（最小暴露面）
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('reminderAPI', {
  // 结构化提交（时间 + 重复 + 内容），不经过自然语言解析
  submitSpec: (spec) => ipcRenderer.invoke('reminder:submitSpec', spec),
  list: () => ipcRenderer.invoke('reminder:list'),
  del: (id) => ipcRenderer.invoke('reminder:del', id),
  close: () => ipcRenderer.send('reminder:close')
})
