# PetPet · 可乐桌宠（二次开发版）

[English](README.en.md) | **中文**

![Platform](https://img.shields.io/badge/%E5%B9%B3%E5%8F%B0-Windows-3e7c5a)
![License](https://img.shields.io/github/license/AlexanderTeng313/pet)
![Version](https://img.shields.io/badge/version-V0.01-blue)

> 把自家狗做成一只真正跑在 Windows 桌面上的桌宠：16 个动作、待机自动轮播、番茄钟、提醒、日记，还能自己调动画节奏。

---

## ⚠️ 这是二次开发项目

本仓库是 **[PetPet Playbook](https://github.com/stshourenxy-dev/petpet-playbook)**（作者 **stshourenxy-dev**，MIT）的**二次开发**。

| | 上游 PetPet Playbook | 本仓库 `pet` |
|---|---|---|
| 定位 | 桌宠**制作方法论**：宠物画像 → AI 生成动作 → 精灵表管线 → 客户端 | 在其成果之上**落地的可运行客户端**（Windows 实测、可打包发布、可长期挂机） |
| 内容 | `docs/` 方法论、`pipeline/` Python 素材管线、`schema/`、`templates/`、`examples/`、`viewer/` 参考实现 | **完整保留上述内容**；改动集中在 `viewer/`，并同步扩展了 `schema/pet.schema.json` 与 `pipeline/validate_pet.py` |
| 示例宠物 | 红苕（边牧）、包包（金毛×德牧） | 可乐（边牧，16 动作，随包分发） |

**方法论、素材管线、全部文档的功劳归上游作者。** 本仓库的工作是让客户端在 Windows 上真正可用、可打包、可长跑。

---

## 本仓库相对上游做了什么

改动集中在 `viewer/`（Electron + PixiJS 客户端）：

| 类别 | 具体改动 |
|---|---|
| **发布** | electron-builder 打包 Windows **安装版（nsis）+ 单文件绿色版（portable）**；内置可乐宠物包随包分发（首次启动自动植入，不覆盖已有） |
| **动作分类** | 动作角色改为数据驱动：`pet.json` 每个动作的 `trigger` 字段（`idle`/`click`/`auto`/`menu`）是**唯一事实源**，待机组从 pet.json 派生，不再硬编码在渲染层 |
| **菜单** | 托盘菜单与右键菜单按分类自动展开「🛋 待机动画 / 🐾 交互动画 / 📋 菜单动作」子菜单（空组不显示）；右键菜单按素材 alpha 边界锚定，多显示器/缩放下不漂移 |
| **待机轮播** | 3 个休息动作（沙发躺 / 睡枕头 / 四爪朝天）常驻显存 loop 轮播 |
| **动画节奏** | 托盘「⏱ 动画切换」子菜单（3/6/12/20 秒）+ **✏️ 自定义窗口**（1 秒 ~ 24 小时，支持秒/分/时），`localStorage` 持久化 |
| **番茄钟** | 独立窗口 + 主进程计时（**关掉窗口也不中断**）、倒计时实时显示在宠物**头顶气泡**、阶段结束系统通知 + 宠物动作 |
| **提醒** | 支持自然语言（如「一分钟后提醒我喝水」）、持久化到 `~/.petpet/reminders.json`、每天/每周重复、到点把宠物窗口置顶 |
| **日记** | 独立面板窗口；动作 → 心情文案由 `pet.json` 的 `diary` 字段驱动（不再硬编码在代码里） |
| **导入宠物包** | 托盘菜单「📦 导入宠物包」：选目录或 `.petpack`/`.zip`，校验后装入 `~/.petpet/pets/` |
| **鼠标盯人** | 鼠标靠近时切换到「转头看你」并**实时把鼠标角度映射到动画帧**（半径 300px + 80px 滞后 + 500ms 退出延迟，防边界抖动） |
| **气泡** | 扫描动作全集 alpha 边界定位狗头，气泡贴在头顶上方并水平居中 |
| **性能/稳定性** | 渲染锁 30fps；待机组常驻显存、其余动作触发时懒加载、播完释放；**WebGL 上下文丢失自愈**（contextlost/restored 重建）；窗口最小化才暂停渲染（不绑 blur，避免子窗口冻住宠物） |

> 这些改动同时更新了 `schema/pet.schema.json` 与 `pipeline/validate_pet.py`——上游的 `trigger` 枚举只允许 `click/auto/menu`，本分支新增了 `idle`，两处已对齐，**校验器可直接校验本仓库的宠物包**。

---

## 快速开始（客户端）

### 环境

- **Node.js ≥ 20**（开发时用 22）
- **Windows 10/11**（本分支的实测平台；macOS 见下方「状态」）

### 开发运行

```bash
cd viewer
npm install          # 安装 Electron + PixiJS 等（首次较慢）
npm run dev          # 开发模式：vite 热更新 + electron
npm run build        # tsc --noEmit && vite build → dist/
npm start            # 构建后启动
npm test             # vitest 单元测试
```

> 主进程 `viewer/main.js` 由 Electron 直接加载、**不经打包器**；渲染层（`viewer/src/`）必须先 `npm run build` 产出 `dist/` 才能启动。

### 宠物包放哪

宠物即数据包，路径固定为 `~/.petpet/pets/<宠物名>/`：

```
~/.petpet/pets/coke/
├── pet.json              # 动作定义（sprite / frames / fps / trigger / diary …）
├── idle/idle_sheet.webp  # 各动作精灵表（横向拼条）
└── …
```

- **开箱即用**：首次启动会把内置的可乐宠物包自动植入，无需手动复制
- **装别的宠物**：托盘菜单 →「📦 导入宠物包」→ 选目录或 `.petpack`/`.zip`
- **做自己的宠物**：走上游的素材管线，见下方「上游方法论文档」

---

## 动作分类：`trigger` 字段

`pet.json` 里每个动作的角色由 `trigger` 决定，这是本分支的**单一事实源**：

| `trigger` | 含义 |
|---|---|
| `idle` | **待机循环组**：常驻显存、`loop` 循环，由「动画切换」间隔定时轮播 |
| `click` | **交互动画**：单击宠物随机触发，并显示该动作的日记气泡文案 |
| `menu` | **菜单动作**：仅在托盘/右键菜单里手动触发 |
| `auto` | 旧行为：进随机行为池（仍需 `weight > 0`） |
| 缺省 | 旧行为（`weight`/random + 菜单） |

加减待机或交互动画**只改 `pet.json`**，菜单分组、待机轮播都会自动跟着变。

校验宠物包（打包/分发前建议跑）：

```bash
python pipeline/validate_pet.py viewer/resources/pets/coke
```

Schema：`schema/pet.schema.json`（v3）

---

## 打包（Windows 安装版 / 绿色版）

```bash
cd viewer
npm run build

# 安装版（NSIS，可选安装目录、建桌面快捷方式）
npx electron-builder --win nsis

# 单文件绿色版
npx electron-builder --win portable
```

产物默认输出到 `viewer/release/`；文件名里的版本号取自 `viewer/package.json` 的 `version`。

> **国内网络注意**：electron-builder 默认从 GitHub 取 Electron 与 nsis 工具集，国内常 502/超时。建议把两个镜像都指向 npmmirror：
>
> ```powershell
> $env:ELECTRON_MIRROR = "https://cdn.npmmirror.com/binaries/electron/"
> $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://cdn.npmmirror.com/binaries/electron-builder-binaries/"
> ```
>
> PowerShell 里设 `$env:` 比 Bash 的 `export` 更可靠；两个都要设，只设后者仍会在下载 Electron 本体时失败。

---

## 目录结构

```
pet/
├── viewer/              客户端（本分支主要改动区）
│   ├── main.js          主进程：窗口/托盘/右键菜单、提醒、番茄钟、导入宠物包、鼠标靠近轮询
│   ├── preload.cjs      IPC 桥
│   ├── src/             渲染层（PixiJS，需构建到 dist/）
│   │   ├── main.ts      精灵播放、待机轮播、气泡、缩放、盯人
│   │   ├── reminder.ts  提醒解析
│   │   ├── state-priority.ts / temperament.ts   状态仲裁与气质
│   │   └── style.css
│   ├── index.html       宠物主窗口页面
│   ├── panel.html       日记面板
│   ├── reminder.html    提醒窗口
│   ├── pomodoro.html    番茄钟窗口
│   ├── switch-interval.html  动画切换间隔设置窗口
│   ├── resources/pets/coke/  内置可乐宠物包（16 动作，随包分发）
│   ├── assets/          图标
│   └── tests/           vitest 单元测试
├── pipeline/            上游：素材管线脚本（选帧/抠图/清理/拼表/校验/提示词）
├── docs/                上游：方法论文档（00-15 + 审查清单等）
├── schema/              契约（pet.json v3 + 宠物画像 16 字段）
├── templates/           画像填空模板
├── examples/            上游：示例素材与 demo 宠物包
├── skills/              AI 助手工作指南
├── tests/               上游：管线测试
├── requirements.txt / pyproject.toml
├── LICENSE              MIT（沿用上游版权署名）
└── SECURITY.md / CONTRIBUTING.md
```

---

## 上游方法论文档（`docs/`）

想做**自己的**宠物（而不只是跑可乐），走上游这套完整管线：宠物特征收集 → 提示词 → AI 生成动作视频 → 抽帧/抠图/拼表 → 装进宠物包。

| 你想做什么 | 读什么 |
|---|---|
| 给自己的宠物做桌宠 | `01-数据模型` → `02-特征与提示词` → `05-素材管线` → `03-需求梳理` |
| 了解客户端设计与 IPC | `04-架构设计` → `08-接口协议` → `09-双端适配` |
| 避坑 | `07-踩坑实录`（每条坑都是一条铁律） |
| 参数细节 / 优化路线 | `06-参数详解` / `10-架构升级评估` / `12-优化路线图` |

素材管线跑法（Python）：

```bash
pip install -r requirements.txt
python pipeline/select_frames.py --input <抽帧目录> --output selected/ --frames 12
python pipeline/remove_bg.py     --input selected/ --output cutout/
python pipeline/clean_cutout.py  --input cutout/   --output clean/
python pipeline/make_sheet.py    --input clean/    --output . --name mypet.png
python pipeline/validate_pet.py  mypet/            # 打包前必跑
```

---

## 状态

- ✅ **Windows**：已实测。V0.01 产出安装版（`PetPet Setup 0.0.1.exe`）与绿色版（`PetPet 0.0.1.exe`），含待机轮播、番茄钟、提醒、日记、动画节奏调节、鼠标盯人
- ⚠️ **macOS**：上游的实测平台；本分支**未验证**（`mac` 打包配置保留但未测试）
- ℹ️ `.github/workflows/ci.yml` 沿用上游。本仓库历史经过整理（单次提交、不含上游历史），其中依赖上游 commit 历史的检查（如 `check_refs.py`）会失败，启用 Actions 前需按需调整或移除

---

## License 与素材版权

- **代码**：[MIT](LICENSE)。版权署名沿用上游 `Copyright (c) 2026 stshourenxy-dev`（MIT 要求保留），本仓库的修改同样以 MIT 发布
- **`examples/` 素材**：宠物照片与设定图版权归各自宠物主人，仅作示例，请勿商用或二次分发
- **动画素材**：由 AI 平台生成，发布时请保留平台的 AI 标识要求
- **`viewer/resources/pets/coke/`**（可乐宠物包）：本人宠物素材，随本仓库公开**仅作演示**，请勿商用或二次分发

---

## 致谢

- 上游项目 **[stshourenxy-dev/petpet-playbook](https://github.com/stshourenxy-dev/petpet-playbook)**：方法论、素材管线脚本、文档、客户端骨架与接口契约均来自上游；本仓库只是把它在 Windows 上跑起来并补齐了桌面客户端该有的功能
- 上游的示例宠物主人「红苕」「包包」，以及管线里用到的开源工具（rembg / Pillow / numpy 等）
