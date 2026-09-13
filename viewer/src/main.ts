// PetPet 桌宠查看器 - 渲染引擎（PixiJS v8）
// 功能：精灵表播放、动作切换、拖拽、缩放、气泡、随机行为
// 注意：Electron/CSP 环境下必须使用 unsafe-eval 模块（PixiJS v8 依赖）
import 'pixi.js/unsafe-eval'
import * as PIXI from 'pixi.js'
import { parseReminder } from './reminder'
import { shouldPlay } from './state-priority'
import { effectiveWeight } from './temperament' // V2-A: 气质调制器（2026-08-09）

// ================= 类型 =================
interface PetActionSpec {
  file?: string
  sprite?: string
  frames: number
  fps?: number
  loop?: boolean
  weight?: number
  pingpong?: boolean
  frameWidth?: number
  frameHeight?: number
  scale?: number
  transitions?: Record<string, number>
  label?: string // v3：菜单显示名（优先于内置映射）
  diary?: { mood: string; text: string } // v3：动作→日记心情文案（优先于内置映射）
  trigger?: 'click' | 'auto' | 'menu' | 'idle' // 触发方式：click=单击宠物触发；auto=随机行为池；menu=仅菜单；idle=待机循环组（由动画切换时间轮播）
}

interface PetJson {
  version: number
  id: string
  name: string
  theme?: string
  bubbles?: string[] // v3：互动气泡文案池（优先于内置 BUBBLE_TEXTS）
  // 2026-09-13 生活作息排班：时间段 → 按顺序循环播放的动作
  schedule?: { from: string; to: string; name?: string; actions: string[] }[]
  cellWidth: number
  cellHeight: number
  error?: string
  actions: Record<string, PetActionSpec>
  // V2-A: 身份+气质（2026-08-09，可选，缺省=中性，兼容旧包）
  identity?: {
    species?: string
    appearance?: Record<string, string>
    habits?: Record<string, boolean>
  }
  temperament?: {
    activity?: number
    clinginess?: number
    curiosity?: number
    independence?: number
  }
}

declare global {
  interface Window {
    petAPI: {
      listPets: () => Promise<string[]>
      loadPet: (id: string) => Promise<PetJson>
      getFile: (id: string, rel: string) => Promise<{ dataUrl?: string; error?: string }>
      setWindowSize: (w: number, h: number) => void
      moveWindow: (x: number, y: number) => void
      setIgnoreMouse: (ignore: boolean, forward?: boolean) => void
      getWindowPosition: () => Promise<{ x: number; y: number }>
      onZoom: (cb: (f: number) => void) => void
      onReset: (cb: () => void) => void
      // 2026-09-13 鼠标靠近检测（主进程轮询全局光标；穿透窗口收不到窗口外事件）
      // dx/dy：光标相对素材中心的原始像素偏移（渲染层据此算角度）
      onProximity: (cb: (info: { near: boolean; dx: number; dy: number }) => void) => void
      setDogBox: (box: { cx: number; cy: number; rx: number; ry: number }) => void
      onTestAction: (cb: (name: string) => void) => void
      notifyPetLoaded: (id: string) => void
      notifyAction: (info: { mood: string; text: string }) => void
      onAction: (cb: (name: string) => void) => void
      setReminder: (spec: { at: number; repeat: string; text: string }) => Promise<{ id?: string; error?: string }>
      onReminderFire: (cb: (r: { id: string; text: string }) => void) => void
      onReminderParseRequest: (cb: (payload: { reqId: string; text?: string; spec?: { at: number; repeat?: string; text?: string } }) => void) => void
      onPomodoroPhase: (cb: (info: { done: 'work' | 'break'; round: number }) => void) => void
      // 2026-09-13 番茄钟状态推送（每秒一次），用于头顶气泡常驻倒计时
      onPomodoroState: (cb: (s: PomoState) => void) => void
      onSwitchInterval: (cb: (ms: number) => void) => void
      reportSwitchInterval: (ms: number) => void
      replyReminderParse: (reqId: string, result: { ok?: boolean; error?: string; at?: number }) => void
      appendActivity: (entry: { petId: string; mood: string; text: string }) => void
      openDiary: (petId: string) => void
      onOpenReminder: (cb: () => void) => void
      onVisibility: (cb: (visible: boolean) => void) => void  // P2-5: 隐藏时暂停动画
      showContextMenu: (x: number, y: number, dogRect?: { x: number; y: number; w: number; h: number } | null) => Promise<void>
      listActivity: (petId: string) => Promise<{ ts: number; mood: string; text: string }[]>
      onPetSwitch: (cb: (id: string) => void) => void
    }
  }
}

// ================= 状态 =================
const app = new PIXI.Application()

let pet: PetJson | null = null
let petId = ''
let sprite: PIXI.AnimatedSprite | null = null
let textures: Record<string, PIXI.Texture[]> = {}
// 2026-09-13 待机动画组：由 pet.json 中 trigger:"idle" 的动作组成（数据驱动，单一事实源）。
// 取代原 hardcoded 数组 + 单一 'idle'（刷狗音）待机；这些动作常驻显存、loop 循环，由动画切换时间定时轮播。
const DEFAULT_IDLE_ACTIONS = ['shafatang', 'shuizhentou', 'sizhaochaotian']
let IDLE_ACTIONS: string[] = DEFAULT_IDLE_ACTIONS.slice()
let idleCursor = 0
let currentAction = IDLE_ACTIONS[0]
let baseScale = 0.5 // 2026-09-13 用户要求：默认固定最小档；调节走右下角托盘菜单（放大/缩小/重置）
// P2-8: 缩放持久化（localStorage，渲染层可用）
// 换新存储键（v2）：忽略旧键里存的历史缩放，首启即最小档
try {
  const savedScale = parseFloat(localStorage.getItem('petpet:scale:v2') || '')
  if (savedScale >= 0.5 && savedScale <= 2) baseScale = savedScale
} catch { /* ignore */ }
let pingpongDir = 1
let bubbleTimer: ReturnType<typeof setTimeout> | null = null
let randomTimer: ReturnType<typeof setInterval> | null = null
let transitionTimer: ReturnType<typeof setTimeout> | null = null // 行为链调度（scheduleTransition）
// 2026-09-13 动画切换间隔（托盘菜单可调）：随机行为计时器的周期，默认 12s；
// 持久化到 localStorage，重启后保持用户选择。
let switchIntervalMs = 12000
try {
  const saved = parseInt(localStorage.getItem('petpet:switchInterval') || '', 10)
  if (saved >= 1000 && saved <= 86400000) switchIntervalMs = saved
} catch { /* ignore */ }
let reminderBarOn = false
// 2026-09-13 番茄钟倒计时头顶气泡（常驻）
type PomoState = { running: boolean; phase: 'work' | 'break'; remainingMs: number; round: number; workMin: number; breakMin: number; longBreakMin: number }
let pomoState: PomoState | null = null
let pomoBubbleOn = false
let bubbleBusyUntil = 0
// 渲染进程跟踪的窗口状态（初始 = 主进程创建尺寸/位置；本地维护，避免异步竞态漂移）
let curWinW = 320
let curWinH = 320
let curWinX = 0
let curWinY = 0

const WINDOW_W = 320
const WINDOW_H = 320
// 2026-09-13 用户要求：气泡挪到素材之外（不压在狗身上、不随动作漂移）→
// 窗口顶部预留一条固定气泡区，狗整体下沉到窗口下半部分（BUBBLE_ZONE 只在窗口尺寸里加，不影响狗的显示尺寸）
const BUBBLE_ZONE = 46
const BUBBLE_TEXTS = ['汪！', '摸摸我～', '今天也要开心哦！', '饿了…有吃的吗？', '(*^▽^*)']

// ================= 初始化 =================
async function init() {
  await app.init({
    backgroundAlpha: 0,
    antialias: true,
    resizeTo: window,
    resolution: Math.min(window.devicePixelRatio || 1, 2)
  })
  // 2026-09-13 后台资源优化：桌面宠物常驻，把渲染帧率从默认 60 降到 30——
  // 精灵本身是 12fps，30fps 下肉眼无差别，但 GPU/CPU 占用直接减半（兼降低上下文丢失概率）。
  app.ticker.maxFPS = 30
  document.getElementById('stage')?.replaceWith(app.canvas)
  app.canvas.style.width = '100%'
  app.canvas.style.height = '100%'
  app.canvas.style.display = 'block'
  // P2-3: 可访问性——canvas 角色标注（屏幕阅读器能读出这是桌宠）
  app.canvas.setAttribute('role', 'img')
  app.canvas.setAttribute('aria-label', pet?.name ? `${pet.name}（桌面宠物）` : '桌面宠物')

  // 2026-09-13 WebGL 上下文丢失自愈：GPU 显存压力/驱动复位会丢上下文→素材变空白。
  // lost 时阻止默认（保留现场）；restored 时重建当前精灵并恢复渲染，避免空白卡死。
  try {
    // Pixi v8 renderer 的 TS 事件表只列了 'resize'，但运行时确实会发 contextlost/restored，
    // 故转 any 绑定（不同后端事件对象形态不同，统一按 any 处理）。
    const rendererAny = app.renderer as any
    rendererAny.on?.('contextlost', (e: any) => { try { e?.preventDefault?.() } catch { /* ignore */ } })
    rendererAny.on?.('contextrestored', () => {
      if (pet && currentAction && textures[currentAction]?.length) {
        try { playAction(currentAction, 'init') } catch (err) { console.error('contextrestored 重建失败', err) }
      }
      app.ticker.start()
    })
  } catch { /* 旧后端无该事件则忽略 */ }

  // 拖拽移动窗口
  let dragging = false
  let startScreen = { x: 0, y: 0 }
  let winStart = { x: 0, y: 0 }
  // 2026-09-13 用户要求：拖起来移动时不要触发单击动作，只有原地不动的点击才算单击。
  // dragMoved 记录本次按下是否真的拖动过窗口（超过 DRAG_THRESHOLD 才算拖动，手抖不算）
  const DRAG_THRESHOLD = 3
  let dragMoved = false

  app.canvas.addEventListener('pointerdown', async (e) => {
    dragging = true
    dragMoved = false
    startScreen = { x: e.screenX, y: e.screenY }
    winStart = await window.petAPI.getWindowPosition()
    app.canvas.setPointerCapture(e.pointerId)
  })

  // 拖拽移动窗口（同步本地位置跟踪，供缩放中心计算使用）
  app.canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const offX = e.screenX - startScreen.x
    const offY = e.screenY - startScreen.y
    // 未超过阈值不移动窗口（避免手抖导致宠物乱跑），也不算作"拖动过"
    if (!dragMoved && Math.hypot(offX, offY) < DRAG_THRESHOLD) return
    dragMoved = true
    const nx = winStart.x + offX
    const ny = winStart.y + offY
    curWinX = Math.round(nx)
    curWinY = Math.round(ny)
    window.petAPI.moveWindow(Math.round(nx), Math.round(ny))
  })

  app.canvas.addEventListener('pointerup', () => { dragging = false })
  app.canvas.addEventListener('pointercancel', () => { dragging = false })

  // 鼠标穿透（借鉴 bitnp）：透明区穿透桌面，宠物区可交互
  // forward=true 让穿透时仍能收到 mousemove，从而检测鼠标进入宠物区
  // 方案B：面板/提醒条/菜单打开时，其区域也保持可交互
  let lastIgnore: boolean | null = null
  function uiRects() {
    const out: { x: number; y: number; w: number; h: number }[] = []
    for (const el of [
      document.getElementById('reminder-panel'),
      document.getElementById('reminder-bar')
    ]) {
      if (el && !el.classList.contains('hidden')) {
        const r = el.getBoundingClientRect()
        out.push({ x: r.x, y: r.y, w: r.width, h: r.height })
      }
    }
    document.querySelectorAll('.pet-menu').forEach(el => {
      const r = el.getBoundingClientRect()
      out.push({ x: r.x, y: r.y, w: r.width, h: r.height })
    })
    return out
  }
  function updateMouseIgnore(e: PointerEvent) {
    if (dragging) return // 拖拽中强制交互
    const x = e.clientX
    const y = e.clientY
    const onSprite = sprite ? sprite.getBounds().containsPoint(x, y) : false
    const onUI = uiRects().some(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)
    const shouldIgnore = !(onSprite || onUI)
    if (shouldIgnore !== lastIgnore) {
      lastIgnore = shouldIgnore
      window.petAPI.setIgnoreMouse(shouldIgnore, true)
    }
  }
  // R-3: document capture 监听已覆盖 canvas 上所有移动，删掉 canvas 冗余绑定（避免每次移动走两遍 uiRects 回流）
  document.addEventListener('pointermove', updateMouseIgnore, true)
  // 初始穿透
  setTimeout(() => window.petAPI.setIgnoreMouse(true, true), 300)

  // 单击 = 互动气泡（桌宠灵魂：点宠物有反应；2026-08-06 用户明确：单击不占用为功能入口）
  // 功能入口：托盘爪印（红苕日记/提醒/换肤/动作）+ 右键菜单（触控板双指/辅助点按用户）
  let downPos = { x: 0, y: 0 }
  let lastPointerUp = 0
  app.canvas.addEventListener('pointerdown', (e) => { downPos = { x: e.clientX, y: e.clientY } })
  app.canvas.addEventListener('pointerup', (e) => {
    lastPointerUp = Date.now()
    if (e.button !== 0) return // 只处理左键（右键走 contextmenu 菜单）
    // 2026-09-13 用户要求：拖动过（窗口真移动过）就不算单击，不切换动作
    if (dragMoved) return
    const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y)
    if (dist < 6) handleSingleClick() // 原地点击 = 互动气泡 / click 触发动作
  })

  // 右键 → 原生菜单（主进程 Menu.popup）
  // 2026-09-13 Windows：screen 坐标在显示缩放下与 popup 坐标系不一致（实测左近右远漂移）；
  // 改为渲染层只传「狗身体可见边界」（窗口内 CSS 坐标，零缩放歧义），
  // 主进程用 窗口位置 + 边界 定位 → 菜单紧贴狗身体，坐标系同源、距离恒定。
  app.canvas.addEventListener('contextmenu', async (e) => {
    e.preventDefault()
    const sx = e.screenX, sy = e.screenY
    let dogRect: DogRect | null = null
    try {
      const u = await unionAlphaBbox(currentAction)
      if (u) dogRect = dogRectInWindow(u)
    } catch { dogRect = null }
    window.petAPI.showContextMenu(sx, sy, dogRect)
  })

  // 2026-09-13 用户要求：取消滚轮缩放（大小默认固定最小档，调节只走右下角托盘菜单）
  // 双击 → 恢复默认大小（最小档）
  app.canvas.addEventListener('dblclick', (e) => {
    e.preventDefault()
    resetZoom()
  })

  // 托盘事件
  window.petAPI.onZoom((f) => applyZoom(f))
  window.petAPI.onReset(() => resetZoom())

  // 2026-09-13 头盯鼠标：「转头看你」60 帧正好扫视一圈（右 f0 → 下 f15 → 左 f30 → 上 f45 → 右 f59）。
  // 把光标相对宠物中心的角度映射到帧序号并定格 → 鼠标在哪，狗头看向哪；鼠标动 → 角度变 → 帧跟着变。
  // 检测圈内持续追踪；圈外或被打断（点击/菜单动作）时回待机。
  window.petAPI.onProximity(({ near, dx, dy }) => {
    if (!near) {
      if (currentAction === 'zhuantou') requestIdle('init') // 鼠标走远 → 回待机
      return
    }
    if (!isIdle(currentAction) && currentAction !== 'zhuantou') return // 不打断点击/菜单动作
    const frames = textures['zhuantou']
    if (!frames || frames.length === 0) return
    // 指数平滑：光标停在两帧临界处时，1px 抖动会让狗头在相邻帧之间反复弹（抽搐感）
    trackDx = trackDx * 0.65 + dx * 0.35
    trackDy = trackDy * 0.65 + dy * 0.35
    // 屏幕角度：0°=右，90°=下（y 轴向下），180°=左，270°=上
    let deg = Math.atan2(trackDy, trackDx) * 180 / Math.PI
    if (deg < 0) deg += 360
    const idx = Math.round((deg / 360) * frames.length) % frames.length
    if (currentAction !== 'zhuantou') {
      requestAction('zhuantou', 'menu') // 进入追踪：切到转头看你
    }
    if (sprite && currentAction === 'zhuantou') {
      sprite.stop()               // 停掉自动播放（loop:false 的 onComplete 也不会触发）
      if (sprite.currentFrame !== idx) sprite.gotoAndStop(idx)
    }
  })

  // 测试：切换动作
  window.petAPI.onTestAction((name) => requestAction(name, 'menu'))

  // 托盘菜单切换动作（7/31 恢复旧版功能）
  window.petAPI.onAction((name) => requestAction(name, 'menu'))

  // 记录初始窗口位置（缩放中心计算基准）
  try {
    const pos = await window.petAPI.getWindowPosition()
    curWinX = pos.x
    curWinY = pos.y
  } catch (err) {
    console.error('获取窗口位置失败', err)
  }

  // P0-1：发现宠物，而非硬编码 redshao（listPets 终于被调用）
  let pets: string[] = []
  try {
    pets = await window.petAPI.listPets()
  } catch (err) {
    console.error('listPets 失败', err)
  }
  if (pets.length === 0) {
    // P0（2026-08-09）：Windows 用户看不懂 ~ 路径（老坑复发）——按平台显示实际路径
    const petsPath = navigator.userAgent.includes('Windows')
      ? '%USERPROFILE%\\.petpet\\pets'
      : '~/.petpet/pets'
    showFatal(`没有找到宠物包。请创建 ${petsPath}/<宠物名>/pet.json（格式见 docs/08-接口协议.md）`)
    return
  }
  petId = pets[0]
  await loadPet(petId)
  // 多宠：托盘菜单支持切换（主进程已构建切换子菜单）
  window.petAPI.onPetSwitch((id) => {
    loadPet(id).catch(err => showFatal(err.message))
  })
  setupUI()
  startRandomBehavior()
}

// ================= 宠物加载 =================
async function loadPet(id: string) {
  // N-1：先释放上一只宠物的 GPU 资源（P0-1 修复引入的回归：只丢引用不释放显存）
  // 必须在 textures = {} 之前——否则对象被替换后 GC 够不着（Assets 缓存持有强引用）
  if (sprite) { sprite.destroy(); sprite = null }
  for (const frames of Object.values(textures)) {
    for (const f of frames) f.destroy()   // Texture.destroy() 连 TextureSource 一起销毁
  }
  textures = {}
  // 切换宠物/动作时取消挂起的转移调度（防止旧宠物转移定时器在新宠物上触发）
  if (transitionTimer) { clearTimeout(transitionTimer); transitionTimer = null }

  petId = id
  const data = await window.petAPI.loadPet(id)
  if (!data || data.error) {
    // P0-2：不再静默失败，抛出给顶层 catch → 可见错误卡片
    const msg = data?.error || `宠物 ${id} 加载失败：pet.json 缺失或无法解析`
    throw new Error(msg)
  }
  pet = data
  // 由 pet.json 的 trigger:"idle" 派生待机动画组（不再硬编码；数据缺失时回退默认组）
  IDLE_ACTIONS = Object.keys(data.actions).filter((n) => data.actions[n]?.trigger === 'idle')
  if (IDLE_ACTIONS.length === 0) IDLE_ACTIONS = DEFAULT_IDLE_ACTIONS.slice()
  // P2-3: 宠物加载后更新 canvas 的 aria-label（init 时 pet 还未加载）
  if (app.canvas) {
    app.canvas.setAttribute('aria-label', `${pet.name}（桌面宠物）`)
  }
  // theme 为契约元数据字段（schema/docs 保留，供未来换肤）；当前版本不参与渲染——
  // 不设置幽灵 data-theme（无 CSS 消费，设置只会误导审计为"功能存在"）
  // 通知主进程当前宠物（托盘动作菜单用）
  window.petAPI.notifyPetLoaded(id)

  const names = Object.keys(pet.actions)
  // 2026-09-13 后台资源优化：不再一次性把 18 张精灵表全载入显存（约 350MB，集显长时间运行会丢 WebGL 上下文→素材空白）。
  // 仅常驻「待机动画组」；其余动作触发时由 requestAction 懒加载，播完自动 unloadAction 释放显存。
  const idleNames = IDLE_ACTIONS.filter((n) => pet?.actions?.[n])
  if (idleNames.length > 0) {
    // 待机组常驻显存（unloadAction 不会回收 idle 组动作），待机轮播/上下文自愈随时可用；首帧直接播待机第一个
    await Promise.all(idleNames.map(loadAction))
    requestIdle('init')
  } else {
    // 兜底旧行为（pet.json 未定义待机组时，仍按首个动作 + 旧 idle 键）
    await loadAction(names[0])
    playAction(names[0], 'init')
    if (pet.actions['idle'] && names[0] !== 'idle') void loadAction('idle')
  }
  updateTitle()
}

// 加载单个动作的精灵表 → 切片 → 存入 textures[name]
async function loadAction(name: string) {
  if (!pet) return
  const act = pet.actions[name]
  const rel = act.file || act.sprite
  if (!rel || textures[name]) return
  // N-3：优先 petpet:// 协议短 URL（零 base64、流式读盘、Assets 缓存键稳定）；
  // 协议不可用时回退 dataURL（getFile 保留 IPC 兼容路径）
  const url = `petpet://${petId}/${rel}`
  let tex: PIXI.Texture
  try {
    tex = await PIXI.Assets.load(url)
  } catch (e) {
    console.warn(`动作 ${name} 协议加载失败，回退 IPC: ${e}`)
    const res = await window.petAPI.getFile(petId, rel)
    if (!res.dataUrl) {
      console.warn(`动作 ${name} 精灵表加载失败: ${res.error}`)
      return
    }
    tex = await PIXI.Assets.load(res.dataUrl)
  }
  const cw = act.frameWidth || pet!.cellWidth
  const ch = act.frameHeight || pet!.cellHeight
  const cols = Math.max(1, Math.floor(tex.width / cw))
  const frames: PIXI.Texture[] = []
  for (let i = 0; i < act.frames; i++) {
    const col = i % cols
    frames.push(new PIXI.Texture({
      source: tex.source,
      frame: new PIXI.Rectangle(col * cw, 0, cw, ch)
    }))
  }
  textures[name] = frames
}

// 2026-09-13 后台资源优化：释放非 idle 动作的 GPU 显存（只保留 idle + 当前动作常驻）。
// 18 张精灵表若全常驻约 350MB，集显下长时间运行会触发 WebGL 上下文丢失（素材变空白）。
function unloadAction(name: string) {
  if (isIdle(name)) return // 待机动画组常驻，不回收显存
  const frames = textures[name]
  if (!frames || frames.length === 0) return
  const act = pet?.actions?.[name]
  const rel = act?.file || act?.sprite
  try { frames[0].source.destroy() } catch { /* ignore */ }
  delete textures[name]
  if (rel) { try { PIXI.Assets.unload(`petpet://${petId}/${rel}`) } catch { /* ignore */ } }
}

// ---- 右键菜单锚定：狗身体可见边界（动作全帧 alpha 联合扫描，按动作缓存）----
// 帧内透明 padding 会让窗口/帧边缘远离狗身体；扫描该动作所有帧的 alpha 联合框
// 得到真实可见边界（帧像素坐标），再换算到窗口 CSS 坐标（dogRectInWindow）。
type DogRect = { x: number; y: number; w: number; h: number }
const dogBboxCache = new Map<string, { bbox: DogRect | null; fw: number; fh: number }>()

async function unionAlphaBbox(name: string): Promise<{ bbox: DogRect | null; fw: number; fh: number } | null> {
  if (!pet) return null
  const cached = dogBboxCache.get(name)
  if (cached) return cached
  const act = pet.actions[name]
  const rel = act?.file || act?.sprite
  if (!act || !rel) return null
  const fw = act.frameWidth || pet.cellWidth
  const fh = act.frameHeight || pet.cellHeight
  try {
    const res = await window.petAPI.getFile(petId, rel)
    if (!res.dataUrl) return null
    const im = await new Promise<HTMLImageElement>((ok, no) => {
      const img = new Image()
      img.onload = () => ok(img)
      img.onerror = () => no(new Error('sprite image load fail'))
      img.src = res.dataUrl!
    })
    const cv = document.createElement('canvas')
    cv.width = im.naturalWidth
    cv.height = im.naturalHeight
    const cx = cv.getContext('2d', { willReadFrequently: true })!
    cx.drawImage(im, 0, 0)
    const cols = Math.max(1, Math.floor(im.naturalWidth / fw))
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i < act.frames; i++) {
      const fx = (i % cols) * fw
      const data = cx.getImageData(fx, 0, fw, fh).data
      for (let p = 0; p < data.length; p += 4) {
        if (data[p + 3] > 24) {
          const pi = p >> 2
          // 帧内局部坐标（0..fw）：横向条带精灵表里各帧排在一条线上，
          // 直接用全局 x 求并集会横跨整条表（曾实测出 9560px 宽的"狗身"）。
          // 正确做法：每帧先算帧内边界，再跨帧合并 → 得到狗在单帧框内的最大可见范围。
          const px = pi % fw
          const py = (pi / fw) | 0
          if (px < x0) x0 = px
          if (px > x1) x1 = px
          if (py < y0) y0 = py
          if (py > y1) y1 = py
        }
      }
    }
    const bbox = (isFinite(x0) && x1 >= x0 && isFinite(y0) && y1 >= y0)
      ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
      : null
    const entry = { bbox, fw, fh }
    dogBboxCache.set(name, entry)
    return entry
  } catch (e) {
    console.warn(`动作 ${name} alpha 边界扫描失败`, e)
    return null
  }
}

// 狗可见边界：帧像素坐标 → 窗口 CSS 坐标（跟随当前缩放/位置）
function dogRectInWindow(u: { bbox: DogRect | null; fw: number; fh: number }): DogRect | null {
  if (!sprite || !u.bbox) return null
  const b = sprite.getBounds()
  if (!u.fw || !u.fh || b.width <= 0 || b.height <= 0) return null
  const sx = b.width / u.fw
  const sy = b.height / u.fh
  return {
    x: b.x + u.bbox.x * sx,
    y: b.y + u.bbox.y * sy,
    w: u.bbox.w * sx,
    h: u.bbox.h * sy
  }
}

function updateTitle() {
  if (pet) document.title = `PetPet - ${pet.name}`
}

// ================= 动作播放 =================
// 动作请求仲裁：所有触发源统一走这里（P0 状态仲裁层）
// - menu/init：用户主动/初始加载 → 直接执行
// - reminder：提醒必须显示 → 直接执行
// - random：随机行为 → 仅在待机时允许（不再打断任何动作）
async function requestAction(name: string, source: 'menu' | 'reminder' | 'random' | 'init' | 'transition' = 'menu') {
  if (!pet) return
  // 2026-09-13 懒加载：动作显存被回收后（unloadAction），下次触发先重新读盘加载再播
  if (!textures[name] || textures[name].length === 0) {
    try { await loadAction(name) } catch (e) { console.warn('动作重载失败', name, e); return }
    if (!textures[name] || textures[name].length === 0) return
  }
  if (!shouldPlay({ name, source }, currentAction)) return
  playAction(name, source)
}

function playAction(name: string, source: 'menu' | 'reminder' | 'random' | 'init' | 'transition' = 'menu') {
  if (!pet || !textures[name] || textures[name].length === 0) return
  // P1-7: 随机行为不写日记（12s 一条会把 100 条日记 20 分钟冲光）——只有用户主动/提醒才记录
  if (source !== 'random' && !isIdle(name) && name !== currentAction) logActionActivity(name)
  // 动作切换 → 通知主进程同步日记「当前状态」（idle 也用固定文案）
  const actT = resolveActionDiary(name)
  window.petAPI.notifyAction(actT
    ? { mood: actT.mood, text: actT.text.replace('{name}', petDisplayName()) }
    : { mood: '待机', text: `${petDisplayName()}安安静静地待着，等你来摸～` })
  const act = pet.actions[name]
  const frames = textures[name]

  if (sprite) {
    sprite.destroy()
    sprite = null
  }
  // 2026-09-13 释放上一个非待机动作的 GPU 显存（待机组常驻，避免 18 张精灵表长期占满显存→上下文丢失）
  if (currentAction && !isIdle(currentAction) && currentAction !== name) {
    unloadAction(currentAction)
  }

  sprite = new PIXI.AnimatedSprite(frames)
  sprite.anchor.set(0.5)
  sprite.animationSpeed = (act.fps || 4) / (app.ticker.maxFPS || 60)  // 跟随 maxFPS，30fps 下动作速度不变慢
  sprite.loop = act.loop !== false
  pingpongDir = 1
  // 一次性动作（loop:false）：播完自动回 idle，不卡死在最后一帧。
  // 此前仅 random/transition 源挂转移定时器，menu 源（菜单/单击触发）播完会冻结——补上。
  if (act.loop === false) {
    sprite.onComplete = () => {
      if (sprite && currentAction === name) {
        requestIdle('init')
      }
    }
  }

  if (act.pingpong) {
    // 往返播放：播完一 cycle 反向
    sprite.on('loop', () => {
      if (!sprite) return
      pingpongDir *= -1
      sprite.animationSpeed = Math.abs(sprite.animationSpeed) * pingpongDir
    })
  }

  app.stage.addChild(sprite)
  currentAction = name
  applyScale()
  sprite.play()
  // 行为链调度：仅自动行为源（random/transition）挂转移定时器——
  // 用户手动/提醒进入的动作不设转移（state-priority 设计意图：手动切换不被自动打断）
  // 待机动画组不挂转移定时器——其轮播完全由"动画切换时间"(randomTimer) 控制，让用户调速生效
  if ((source === 'random' || source === 'transition') && !isIdle(name)) scheduleTransition(name)
}

// 缩放约束：0.5x ~ 2x（窗口跟随缩放，永远完整显示全身，不裁切）
const ZOOM_MIN = 0.5
const ZOOM_MAX = 2

async function applyScale() {
  if (!sprite) return
  // 8/5 v2：窗口尺寸只随缩放（baseScale）变化，与动作无关 → 切换动作零跳变（修复"切换时窗口闪烁/动作消失"感）
  // 帧尺寸优先取当前动作帧的真实纹理尺寸（Pixi v8 的 FrameObject 无 width/height，需类型收窄）
  const firstTex = sprite.textures[0]
  const fw = (firstTex && 'width' in firstTex ? (firstTex as PIXI.Texture).width : undefined) || pet?.cellWidth || 250
  const fh = (firstTex && 'height' in firstTex ? (firstTex as PIXI.Texture).height : undefined) || pet?.cellHeight || 250
  const fit = Math.min(WINDOW_W / fw, WINDOW_H / fh)  // 固定 320 基准，不随窗口变化
  const act: PetActionSpec = pet?.actions?.[currentAction] || { frames: 0 }
  const actScale = act.scale || 1

  // 窗口 = 初始尺寸 × baseScale（与动作无关）；高度额外加一条气泡区（狗下沉，气泡永远在素材之外）
  const newW = Math.max(60, Math.round(WINDOW_W * baseScale))
  // 气泡区用固定像素（不随缩放变小），保证任何缩放下都放得下气泡
  const dogH = Math.max(60, Math.round(WINDOW_H * baseScale))
  const newH = Math.max(60, dogH + BUBBLE_ZONE)
  sprite.scale.set(baseScale * fit * actScale)
  // 狗居中于窗口下半部分（顶部 BUBBLE_ZONE*baseScale 留给气泡）
  sprite.position.set(newW / 2, newH - dogH / 2)

  const newX = Math.round(curWinX + (curWinW - newW) / 2)
  const newY = Math.round(curWinY + (curWinH - newH) / 2)
  window.petAPI.moveWindow(newX, newY)
  window.petAPI.setWindowSize(newW, newH)
  curWinX = newX
  curWinY = newY
  curWinW = newW
  curWinH = newH
  void reportDogBox() // 尺寸/动作变化后同步素材边界给主进程（异步，不阻塞）
}

// 2026-09-13 上报素材可见范围给主进程：检测原点=素材中心、检测范围=素材本体（不再按窗口外扩）
async function reportDogBox() {
  try {
    const u = await unionAlphaBbox(currentAction)
    const r = u ? dogRectInWindow(u) : null
    if (r && r.w > 0 && r.h > 0) {
      window.petAPI.setDogBox({ cx: r.x + r.w / 2, cy: r.y + r.h / 2, rx: r.w / 2, ry: r.h / 2 })
    } else {
      window.petAPI.setDogBox({ cx: curWinW / 2, cy: curWinH / 2, rx: curWinW / 2, ry: curWinH / 2 })
    }
  } catch { /* 上报失败忽略，主进程会退回窗口尺寸判定 */ }
}

// 盯人平滑用的光标偏移（指数滤波，抑制临界抖动）
let trackDx = 0
let trackDy = 0
function applyZoom(factor: number) {
  const prev = baseScale
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, baseScale * factor))
  baseScale = next
  try { localStorage.setItem('petpet:scale:v2', String(next)) } catch { /* ignore */ }  // P2-8
  // P2-9: 到边界给反馈（静默钳制让人困惑：继续滚什么都没发生）
  if (next === prev) {
    showBubbleText(next >= ZOOM_MAX ? '已经是最大啦 🐾' : '已经最小啦 🐾')
  } else {
    applyScale()
  }
}

function resetZoom() {
  baseScale = 0.5 // 重置 = 回最小档（与默认一致）
  try { localStorage.setItem('petpet:scale:v2', '0.5') } catch { /* ignore */ }  // P2-8
  applyScale()
}

// ================= 气泡 =================
// 单击处理：优先触发 click 型动作（pet.json trigger:"click"，播放动作 + 该动作的气泡文案），
// 没有 click 型动作时退回全局气泡池（旧行为）
function handleSingleClick() {
  if (pet) {
    const clickActs = Object.entries(pet.actions)
      .filter(([n, a]) => a.trigger === 'click' && (textures[n]?.length ?? 0) > 0)
    if (clickActs.length > 0) {
      const [name, act] = clickActs[Math.floor(Math.random() * clickActs.length)]
      requestAction(name, 'menu') // 手动语义：不被随机行为打断
      showBubbleText(act.diary?.text?.replace('{name}', petDisplayName()))
      return
    }
  }
  showBubbleText()
}

async function showBubbleText(text?: string, sticky = false) {
  const bubble = document.getElementById('bubble')!
  const pool = bubblePool()
  bubble.textContent = text || pool[Math.floor(Math.random() * pool.length)]
  bubble.classList.remove('hidden')

  // 气泡对齐素材：水平居中于狗身体可见边界（alpha 联合框）；
  // 垂直固定在窗口顶部预留的气泡区（素材之外，不压狗、不随动作尺寸漂移）。
  // 扫描按动作缓存，首次某动作会多花几百毫秒，之后瞬时。
  let cx: number | null = null
  try {
    const u = await unionAlphaBbox(currentAction)
    const r = u ? dogRectInWindow(u) : null
    if (r && r.w > 0) cx = r.x + r.w / 2
  } catch { /* 扫描失败走默认位置 */ }

  if (cx != null) {
    const bw = bubble.offsetWidth
    let left = cx - bw / 2
    left = Math.max(2, Math.min(left, curWinW - bw - 2)) // 不出左右边界
    bubble.style.left = `${Math.round(left)}px`
    bubble.style.top = '4px'   // 固定在顶部气泡区（狗已下沉到窗口下半部分）
    bubble.style.transform = 'none'
  } else {
    // 兜底：无边界数据时维持旧行为（窗口顶部居中）
    bubble.style.left = '50%'
    bubble.style.top = '8px'
    bubble.style.transform = 'translateX(-50%)'
  }

  if (bubbleTimer) clearTimeout(bubbleTimer)
  if (sticky) {
    // 常驻气泡（番茄倒计时）：不设自动隐藏，由 updatePomoBubble 控制生命周期
    pomoBubbleOn = true
    return
  }
  // 普通气泡：显示期间"占用"气泡 6s，番茄倒计时让位，避免互相覆盖
  pomoBubbleOn = false
  bubbleBusyUntil = Date.now() + 6000
  bubbleTimer = setTimeout(() => {
    bubble.classList.add('hidden')
  }, 6000)
}

function hideBubble() {
  const bubble = document.getElementById('bubble')
  if (bubble) bubble.classList.add('hidden')
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null }
}

// 2026-09-13 番茄倒计时显示在头顶气泡（常驻；暂停/停止即隐藏）
function fmtMMSS(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function updatePomoBubble() {
  const s = pomoState
  if (s && s.running) {
    if (Date.now() < bubbleBusyUntil) return // 互动/提醒气泡优先
    showBubbleText(`${s.phase === 'work' ? '🍅' : '☕'} ${fmtMMSS(s.remainingMs)}`, true)
  } else if (pomoBubbleOn) {
    hideBubble()
    pomoBubbleOn = false
  }
}

// ================= 红苕日记（方案B） =================
// 动作 → 心情 + 文案（{name} 运行时替换为宠物名，不再硬编码红苕）
const ACTIVITY_TEXTS: Record<string, { mood: string; text: string }> = {
  sleep:   { mood: '安逸', text: '{name}蜷成一团睡着了，呼噜声轻轻的。' },
  sniff:   { mood: '好奇', text: '{name}凑近嗅了嗅，鼻头湿漉漉的。' },
  wiggle:  { mood: '开心', text: '{name}扭着屁股撒欢，尾巴摇成小风扇。' },
  run:     { mood: '兴奋', text: '{name}嗖地窜了出去，一溜烟就没影了。' },
  knead:   { mood: '满足', text: '{name}踩奶踩得入迷，前爪一按一按的。' },
  belly:   { mood: '惬意', text: '{name}翻出肚皮晒太阳，毫无防备。' },
  poop:    { mood: '心虚', text: '{name}先转着圈圈踩好位置，解决完就撒欢跑开了。' },
  stretch: { mood: '舒坦', text: '{name}伸了个大大的懒腰，爪子张得开花。' }
}

// ================= 文案数据优先（v3 数据下沉） =================
// pet.json 的 bubbles / diary / label 优先，代码常量仅作兜底（docs/08 §2.2）
function bubblePool(): string[] {
  return pet?.bubbles && pet.bubbles.length > 0 ? pet.bubbles : BUBBLE_TEXTS
}

function resolveActionDiary(name: string): { mood: string; text: string } | undefined {
  const d = pet?.actions?.[name]?.diary
  if (d && d.mood && d.text) return d
  return ACTIVITY_TEXTS[name]
}

function petDisplayName(): string {
  return pet?.name || '宠物'
}

function logActionActivity(name: string) {
  const t = resolveActionDiary(name)
  if (!t) return
  window.petAPI.appendActivity({ petId, mood: t.mood, text: t.text.replace('{name}', petDisplayName()) })
}


// ================= 提醒系统（方案B） =================
function openReminderPanel() {
  document.getElementById('reminder-panel')!.classList.remove('hidden')
  const input = document.getElementById('reminder-input') as HTMLInputElement
  input.value = ''
  input.focus()
}

function closeReminderPanel() {
  document.getElementById('reminder-panel')!.classList.add('hidden')
}

async function submitReminder() {
  const input = document.getElementById('reminder-input') as HTMLInputElement
  const raw = input.value.trim()
  if (!raw) return
  const spec = parseReminder(raw)
  if (!spec) {
    showBubbleText('我听不懂这个时间…试试「一分钟后提醒我喝水」')
    return
  }
  const res = await window.petAPI.setReminder({ at: spec.at, repeat: spec.repeat, text: spec.text })
  if (res && res.error) {
    showBubbleText('这个时间有点奇怪，换个说法试试？')
    return
  }
  closeReminderPanel()
  // P1-2: 回执回显解析结果——"每天 10:30 叫你「吃药」"，用户当场核对，解析 bug 不再隐藏
  const d = new Date(spec.at)
  const p = (n: number) => String(n).padStart(2, '0')
  const when = `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
  const repeatLabel = spec.repeat === 'daily' ? '（每天）' : spec.repeat === 'weekly' ? '（每周）' : ''
  showBubbleText(`好哦，${when}叫你「${spec.text}」${repeatLabel}`)
  window.petAPI.appendActivity({ petId, mood: '答应', text: `${petDisplayName()}答应提醒你：${when} ${spec.text}${repeatLabel}` })
}

function handleReminderFire(r: { id: string; text: string }) {
  reminderBarOn = true
  const bar = document.getElementById('reminder-bar')!
  // P1-4: 多条提醒同时到点不覆盖——已显示的提醒条追加新条目（换行），而非替换
  const existing = document.getElementById('reminder-text')!.textContent
  document.getElementById('reminder-text')!.textContent = existing && existing !== '⏰ '
    ? existing + '\n⏰ ' + r.text
    : '⏰ ' + r.text
  bar.classList.remove('hidden')
  requestAction('bala', 'reminder') // 提醒时扒拉你（"人，你需要休息一下啦"）；动作缺失时安全 no-op
}

function dismissReminder() {
  reminderBarOn = false
  document.getElementById('reminder-bar')!.classList.add('hidden')
  window.petAPI.appendActivity({ petId, mood: '放心', text: `${petDisplayName()}确认你收到提醒了。` })
}

function openDiary() {
  // 日记面板是独立小窗口（主进程管理），避免在宠物窗口内遮挡宠物
  window.petAPI.openDiary(petId)
}

// P1-5: 删除幽灵换肤（switchTheme 无调用者、无 CSS 消费 data-theme）

function setupUI() {
  const input = document.getElementById('reminder-input') as HTMLInputElement
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submitReminder()
    } else if (e.key === 'Escape') {
      closeReminderPanel()
    }
  })
  document.getElementById('reminder-ok')!.addEventListener('click', submitReminder)
  document.getElementById('reminder-cancel')!.addEventListener('click', closeReminderPanel)
  document.getElementById('reminder-done')!.addEventListener('click', dismissReminder)
  window.petAPI.onReminderFire((r) => handleReminderFire(r))
  // 2026-09-13 独立提醒窗口：收到主进程转来的自然语言文本 → 用本窗口的 parseReminder 解析并写入，
  // 再把结果回执给主进程（解析逻辑保持单一实现，避免两套解析结果不一致）
  window.petAPI.onReminderParseRequest(async (payload) => {
    // 2026-09-13 结构化提交（时间+重复+内容）：直接用，不再走自然语言解析
    const pre = payload?.spec
    let spec = pre && typeof pre.at === 'number'
      ? { at: pre.at, repeat: (pre.repeat || 'none') as 'none' | 'daily' | 'weekly', text: String(pre.text || '该办正事啦！') }
      : null
    if (!spec) {
      const raw = String(payload?.text || '').trim()
      if (!raw) {
        window.petAPI.replyReminderParse(payload.reqId, { error: '请输入内容' })
        return
      }
      spec = parseReminder(raw)
      if (!spec) {
        window.petAPI.replyReminderParse(payload.reqId, { error: '我听不懂这个时间…试试「一分钟后提醒我喝水」' })
        return
      }
    }
    const res = await window.petAPI.setReminder({ at: spec.at, repeat: spec.repeat, text: spec.text })
    if (res && res.error) {
      window.petAPI.replyReminderParse(payload.reqId, { error: res.error })
      return
    }
    // 回执回显解析结果 + 气泡确认（与旧版一致的用户反馈）
    const d = new Date(spec.at)
    const p = (n: number) => String(n).padStart(2, '0')
    const when = `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
    const repeatLabel = spec.repeat === 'daily' ? '（每天）' : spec.repeat === 'weekly' ? '（每周）' : ''
    showBubbleText(`好哦，${when}叫你「${spec.text}」${repeatLabel}`)
    window.petAPI.appendActivity({ petId, mood: '答应', text: `${petDisplayName()}答应提醒你：${when} ${spec.text}${repeatLabel}` })
    window.petAPI.replyReminderParse(payload.reqId, { ok: true, at: spec.at })
  })
  // 2026-09-13 番茄钟阶段结束：可乐用动作 + 气泡提醒（提醒源，可打断当前动作）
  window.petAPI.onPomodoroPhase(({ done, round }) => {
    if (done === 'work') {
      requestAction('bala', 'reminder') // 扒拉你："人，你需要休息一下啦"
      showBubbleText(`第 ${round} 个番茄完成啦，起来动动～`)
    } else {
      requestAction('pipi_qifei', 'reminder') // 屁屁起飞：陪我玩一玩嘛（休息结束回来开工）
      showBubbleText('休息结束，回来开工啦！')
    }
  })
  // 2026-09-13 番茄钟倒计时 → 头顶气泡（常驻倒计时，主进程每秒推送一次）
  // 主进程计时独立于番茄钟窗口：关掉窗口倒计时照常跑，气泡持续显示
  window.petAPI.onPomodoroState((s) => {
    pomoState = s
    updatePomoBubble()
  })
  // 2026-09-13 动画切换间隔（托盘菜单可调）：应用新间隔并重启计时器
  window.petAPI.onSwitchInterval((ms) => applySwitchInterval(ms))
  // 启动后把已持久化的间隔回报给主进程，使托盘菜单的「✓」与用户上次选择一致
  try { window.petAPI.reportSwitchInterval(switchIntervalMs) } catch { /* ignore */ }
  // 托盘兜底入口：提醒面板（右键手势不可用时）
  window.petAPI.onOpenReminder(() => openReminderPanel())
  // P2-5: 窗口隐藏时暂停动画（省电）——恢复时继续
  window.petAPI.onVisibility((visible) => {
    if (visible) {
      app.ticker.start()
    } else {
      app.ticker.stop()
    }
  })
}

// ================= 随机行为 =================
// 2026-09-13 生活作息（pet.json schedule）：时间段 → 动作序列，段内顺序循环
const scheduleCursor = new Map<string, number>()
function currentTimeWindow(): { from: string; to: string; name?: string; actions: string[] } | null {
  const sch = (pet as PetJson | undefined)?.schedule
  if (!Array.isArray(sch) || sch.length === 0) return null
  const now = new Date()
  const m = now.getHours() * 60 + now.getMinutes()
  const toMin = (t: string) => {
    const [h, mi] = String(t || '0:0').split(':').map(Number)
    return (h || 0) * 60 + (mi || 0)
  }
  for (const w of sch) {
    if (!Array.isArray(w?.actions) || w.actions.length === 0) continue
    const a = toMin(w.from)
    const b = toMin(w.to)
    const hit = a <= b ? (m >= a && m < b) : (m >= a || m < b) // a > b 视为跨午夜
    if (hit) return w
  }
  return null
}
// P0：随机触发经 requestAction('random') 仲裁——只在待机时触发（守卫已在 shouldPlay），
// 且回 idle 带守卫：仅当“当前仍是本次随机动作”时才回（修复：用户/提醒打断后不再被强制拉回 idle）

// 统一行为链调度（替代原内联 4s 补丁）：
// 按时长 frames/fps 估算（钳制 2–12s）；到点且未被更高优先级动作打断时，
// 有 transitions 则按权重转移（transition 源），否则回 idle（init 源）
function scheduleTransition(name: string) {
  if (transitionTimer) { clearTimeout(transitionTimer); transitionTimer = null }
  const act = pet?.actions?.[name]
  if (!act) return
  const durMs = Math.min(12000, Math.max(2000, ((act.frames || 1) / (act.fps || 4)) * 1000))
  transitionTimer = setTimeout(() => {
    transitionTimer = null
    if (!pet || currentAction !== name) return
    const trans = act.transitions
    if (trans && Object.keys(trans).length > 0) {
      // 转移链：按权重选下一个动作（Shimeji NextBehaviorList 思路，docs/11 §2.1）
      const pool = Object.entries(trans).filter(([n, w]) => textures[n] && n !== name && w > 0)
      if (pool.length > 0) {
        const total = pool.reduce((s, [, w]) => s + w, 0)
        let r = Math.random() * total
        for (const [n, w] of pool) {
          r -= w
          if (r <= 0) { requestAction(n, 'transition'); return }
        }
      }
    }
    // 无转移链 → 回待机（init 源，绕开 random 源互斥守卫）
    requestIdle('init')
  }, durMs)
}

// 2026-09-13 动画切换间隔（托盘菜单可调）：修改后重启随机行为计时器，下次切换即生效；
// 同时持久化到 localStorage 供重启后保持。
function applySwitchInterval(ms: number) {
  if (!(ms >= 1000 && ms <= 86400000)) return
  switchIntervalMs = ms
  try { localStorage.setItem('petpet:switchInterval', String(ms)) } catch { /* ignore */ }
  startRandomBehavior() // 内部会清掉旧 timer 并以新间隔重建
}

// 待机判定 & 待机轮播：在 IDLE_ACTIONS 组里按顺序取下一个（循环），供"回待机/播完一次性动作/动画切换时间"复用
function isIdle(name: string): boolean {
  return IDLE_ACTIONS.includes(name)
}
function requestIdle(source: 'menu' | 'reminder' | 'random' | 'init' | 'transition' = 'init') {
  const list = IDLE_ACTIONS.filter((n) => pet?.actions?.[n])
  if (list.length === 0) return
  const name = list[idleCursor % list.length]
  idleCursor++
  void requestAction(name, source)
}

function startRandomBehavior() {
  if (randomTimer) clearInterval(randomTimer)
  randomTimer = setInterval(() => {
    if (!pet) return
    // 8/5：自动演示只在待机状态触发——用户手动切换动作后锁定，验证/观看不被随机切换打断
    // P3-4: 提醒横幅显示期间也暂停随机行为（提醒是用户关注的焦点，宠物别抢戏）
    if (!isIdle(currentAction) || reminderBarOn) return

    // 2026-09-13 生活作息排班：命中当前时间段时，按该时段动作列表【顺序循环】播放
    // （比纯随机更像"有生活"：早饭点炫饭、午后午睡、夜里睡觉）
    const win = currentTimeWindow()
    if (win && Array.isArray(win.actions) && win.actions.length > 0) {
      const pool = win.actions.filter(n => textures[n] && textures[n].length > 0 && n !== currentAction)
      if (pool.length > 0) {
        const key = win.name || `${win.from}-${win.to}`
        const cur = scheduleCursor.get(key) ?? 0
        const name = pool[cur % pool.length]
        scheduleCursor.set(key, cur + 1)
        requestAction(name, 'random')
        return
      }
    }
    const candidates = Object.entries(pet.actions).filter(([name, act]) => {
      return textures[name] && name !== currentAction && (act.weight ?? 0) > 0
    })
    if (candidates.length === 0) {
      // 无随机(auto)池时：待机动画组按"动画切换时间"轮播下一个（沙发/睡觉/四脚朝天循环）
      requestIdle('random')
      return
    }

    const total = candidates.reduce((s, [n, a]) => s + effectiveWeight(n, a.weight ?? 0, pet?.temperament), 0)
    let r = Math.random() * total
    for (const [name, act] of candidates) {
      r -= effectiveWeight(name, act.weight ?? 0, pet?.temperament)
      if (r <= 0) {
        requestAction(name, 'random')
        break
      }
    }
  }, 12000)
}

// ================= 启动 =================
// P0-2：可见的错误反馈（不透明卡片，替代透明窗口里的静默失败）
function showFatal(msg: string) {
  const bubble = document.getElementById('bubble')!
  bubble.textContent = '⚠️ ' + msg
  bubble.classList.remove('hidden')
  bubble.style.background = 'rgba(255,255,255,0.98)'
  bubble.style.maxWidth = '280px'
  bubble.style.whiteSpace = 'normal'
}

init().catch(err => {
  console.error('PetPet 启动失败', err)
  showFatal(err?.message || '启动失败')
})
