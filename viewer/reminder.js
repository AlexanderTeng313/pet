// 提醒窗口前端逻辑：时间 + 重复 + 内容 → 提交 → 刷新待办列表
const $ = (id) => document.getElementById(id)
const timeEl = $('time')
const repeatEl = $('repeat')
const input = $('text')
const msg = $('msg')
const listEl = $('list')

function fmt(ts) {
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 默认填当前时间 + 30 分钟，省去手动调表
(function initDefaultTime() {
  const d = new Date(Date.now() + 30 * 60 * 1000)
  const p = (n) => String(n).padStart(2, '0')
  timeEl.value = `${p(d.getHours())}:${p(d.getMinutes())}`
})()

async function refresh() {
  try {
    const items = await window.reminderAPI.list()
    if (!items || items.length === 0) {
      listEl.innerHTML = '<div class="empty">暂无提醒</div>'
      return
    }
    listEl.innerHTML = items
      .slice()
      .sort((a, b) => a.at - b.at)
      .map((r) => {
        const rep = r.repeat === 'daily' ? '（每天）' : r.repeat === 'weekly' ? '（每周）' : ''
        return `<div class="item"><span class="t">${fmt(r.at)}</span> ${escapeHtml(r.text)}${rep}
          <button class="del" data-id="${r.id}" title="删除">✕</button></div>`
      })
      .join('')
    listEl.querySelectorAll('.del').forEach((b) => {
      b.addEventListener('click', async () => {
        await window.reminderAPI.del(b.dataset.id)
        refresh()
      })
    })
  } catch (e) {
    listEl.innerHTML = '<div class="empty">读取失败</div>'
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

async function submit() {
  const t = timeEl.value
  if (!t) {
    msg.textContent = '请先填时间'
    return
  }
  const [h, m] = t.split(':').map(Number)
  const d = new Date()
  d.setHours(h || 0, m || 0, 0, 0)
  if (d.getTime() <= Date.now() + 1000) d.setDate(d.getDate() + 1) // 已过 → 明天同一时刻
  const text = input.value.trim() || '该办正事啦！'
  msg.textContent = '设置中…'
  const res = await window.reminderAPI.submitSpec({ at: d.getTime(), repeat: repeatEl.value || 'none', text })
  if (res && res.error) {
    msg.textContent = res.error
    return
  }
  input.value = ''
  msg.textContent = `已设置 ✔ ${fmt(d.getTime())}`
  refresh()
  setTimeout(() => window.reminderAPI.close(), 700)
}

$('ok').addEventListener('click', submit)
$('cancel').addEventListener('click', () => window.reminderAPI.close())
$('close').addEventListener('click', () => window.reminderAPI.close())
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit()
  else if (e.key === 'Escape') window.reminderAPI.close()
})
refresh()
