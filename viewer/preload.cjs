// PetPet 桌宠查看器 - preload 桥接
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('petAPI', {
  listPets: () => ipcRenderer.invoke('pet:list'),
  loadPet: (petId) => ipcRenderer.invoke('pet:load', petId),
  getFile: (petId, relPath) => ipcRenderer.invoke('pet:file', petId, relPath),
  setWindowSize: (w, h) => ipcRenderer.send('view:setSize', w, h),
  moveWindow: (x, y) => ipcRenderer.send('view:move', x, y),
  setIgnoreMouse: (ignore, forward) => ipcRenderer.send('pet:setIgnoreMouse', ignore, forward),
  getWindowPosition: () => ipcRenderer.invoke('view:getPos'),
  notifyPetLoaded: (petId) => ipcRenderer.send('pet:loaded', petId),
  onPetSwitch: (cb) => ipcRenderer.on('pet:switch', (_e, id) => cb(id)),
  onAction: (cb) => ipcRenderer.on('pet:action', (_e, name) => cb(name)),
  onZoom: (cb) => ipcRenderer.on('view:zoom', (_e, factor) => cb(factor)),
  onReset: (cb) => ipcRenderer.on('view:reset', () => cb()),
  // 2026-09-13 鼠标靠近检测：主进程轮询全局光标，靠近宠物时通知渲染层（穿透窗口收不到窗口外事件）
  onProximity: (cb) => ipcRenderer.on('pet:proximity', (_e, info) => cb(info)),
  // 上报狗身体在窗口内的可见范围（alpha 边界），供主进程做精准靠近判定
  setDogBox: (box) => ipcRenderer.send('pet:dogbox', box),
  onTestAction: (cb) => ipcRenderer.on('test:action', (_e, name) => cb(name)),
  setReminder: (spec) => ipcRenderer.invoke('reminder:set', spec),
  onReminderFire: (cb) => ipcRenderer.on('reminder:fire', (_e, r) => cb(r)),
  // 独立提醒窗口：主进程转来的文本 → 本窗口解析后回执
  onReminderParseRequest: (cb) => ipcRenderer.on('reminder:parseRequest', (_e, payload) => cb(payload)),
  // 2026-09-13 番茄钟阶段结束通知（主进程计时）
  onPomodoroPhase: (cb) => ipcRenderer.on('pomodoro:phase', (_e, info) => cb(info)),
  // 番茄钟状态推送（每秒），用于头顶气泡常驻倒计时
  onPomodoroState: (cb) => ipcRenderer.on('pomodoro:state', (_e, s) => cb(s)),
  onSwitchInterval: (cb) => ipcRenderer.on('view:switchInterval', (_e, ms) => cb(ms)),
  reportSwitchInterval: (ms) => ipcRenderer.send('view:switchIntervalReport', ms),
  replyReminderParse: (reqId, result) => ipcRenderer.invoke('reminder:parseResult:' + reqId, result),
  appendActivity: (entry) => ipcRenderer.send('pet:activity', entry),
  listActivity: (petId) => ipcRenderer.invoke('pet:activity:list', petId),
  showContextMenu: (x, y, dogRect) => ipcRenderer.invoke('menu:showContext', x, y, dogRect),
  notifyAction: (info) => ipcRenderer.send('pet:action:notify', info),
  openDiary: (petId) => ipcRenderer.send('diary:open', petId),
  onOpenReminder: (cb) => ipcRenderer.on('open:reminder', () => cb()),
  onVisibility: (cb) => ipcRenderer.on('pet:visibility', (_e, visible) => cb(visible)),  // P2-5: 隐藏时暂停动画
})
