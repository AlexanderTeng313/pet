// 动画切换间隔窗口：自定义任意秒/分/时的切换周期
const $ = (id) => document.getElementById(id)
const numEl = $('num')
const unitEl = $('unit')
const curEl = $('cur')

// 主进程当前间隔（毫秒）→ 尽量以「秒」呈现，保证 radio 档位（3/6/12/20 秒）是整数
function renderCurrent(ms) {
  if (!ms || ms < 1000) { curEl.textContent = '—'; return }
  if (ms % 3600000 === 0) curEl.textContent = `${ms / 3600000} 小时`
  else if (ms % 60000 === 0) curEl.textContent = `${ms / 60000} 分钟`
  else curEl.textContent = `${Math.round(ms / 1000)} 秒`
}

window.switchAPI.get().then(renderCurrent)

function apply() {
  const n = parseInt(numEl.value, 10)
  const factor = parseInt(unitEl.value, 10)
  if (!Number.isFinite(n) || n <= 0) { numEl.focus(); return }
  const ms = n * factor
  if (ms < 1000 || ms > 86400000) { // 限制 1 秒 ~ 24 小时
    alert('间隔需在 1 秒到 24 小时之间')
    return
  }
  window.switchAPI.apply(ms)
}

$('apply').addEventListener('click', apply)
numEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply() })
$('cancel').addEventListener('click', () => window.switchAPI.close())
$('close').addEventListener('click', () => window.switchAPI.close())
