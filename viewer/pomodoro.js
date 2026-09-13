// 番茄时钟窗口：显示主进程推送的状态 + 控制按钮
const $ = (id) => document.getElementById(id)
const phaseEl = $('phase')
const clockEl = $('clock')
const dotsEl = $('dots')
const toggleEl = $('toggle')

function fmt(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  const ss = s % 60
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function render(s) {
  if (!s) return
  phaseEl.textContent = s.phase === 'work' ? '专注中' : (s.round > 0 && s.round % 4 === 0 ? '长休息' : '休息中')
  clockEl.textContent = fmt(s.remainingMs)
  toggleEl.textContent = s.running ? '暂停' : '开始'
  dotsEl.textContent = s.round > 0 ? '🍅'.repeat(Math.min(s.round % 4 === 0 && s.round > 0 ? 4 : s.round % 4, 4)) + ` 已完成 ${s.round}` : ''
  // 配置框只在未开始时才覆盖，避免打断用户输入
  if (document.activeElement !== $('workMin')) $('workMin').value = s.workMin
  if (document.activeElement !== $('breakMin')) $('breakMin').value = s.breakMin
  if (document.activeElement !== $('longBreakMin')) $('longBreakMin').value = s.longBreakMin
}

let current = null
window.pomoAPI.get().then(render)
window.pomoAPI.onState((s) => { current = s; render(s) })

toggleEl.addEventListener('click', () => {
  if (current && current.running) window.pomoAPI.pause()
  else window.pomoAPI.start()
})
$('skip').addEventListener('click', () => window.pomoAPI.skip())
$('reset').addEventListener('click', () => window.pomoAPI.reset())
$('close').addEventListener('click', () => window.pomoAPI.close())

function pushCfg() {
  const n = (id) => parseInt($(id).value, 10)
  window.pomoAPI.set({ workMin: n('workMin'), breakMin: n('breakMin'), longBreakMin: n('longBreakMin') })
}
;['workMin', 'breakMin', 'longBreakMin'].forEach((id) => {
  $(id).addEventListener('change', pushCfg)
})
