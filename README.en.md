# PetPet · Coke the Desktop Pet (secondary development)

**English** | [中文](README.md)

![Platform](https://img.shields.io/badge/platform-Windows-3e7c5a)
![License](https://img.shields.io/github/license/AlexanderTeng313/pet)
![Version](https://img.shields.io/badge/version-V0.01-blue)

> My own dog, turned into a desktop pet that actually runs on Windows: 16 animations, auto-rotating idle loop, pomodoro timer, reminders, diary, and a tunable animation rhythm.

---

## ⚠️ This is a secondary development project

This repository is a **secondary development (fork)** of **[PetPet Playbook](https://github.com/stshourenxy-dev/petpet-playbook)** by **stshourenxy-dev** (MIT).

| | Upstream PetPet Playbook | This repo (`pet`) |
|---|---|---|
| Focus | A **methodology** for building desktop pets: pet profiling → AI-generated actions → sprite-sheet pipeline → client | A **runnable client** built on top of it (tested on Windows, packaged for release, stable for long-running use) |
| Contents | `docs/` methodology, `pipeline/` Python asset pipeline, `schema/`, `templates/`, `examples/`, `viewer/` reference implementation | **All of the above retained**; changes are concentrated in `viewer/`, with matching updates to `schema/pet.schema.json` and `pipeline/validate_pet.py` |
| Sample pets | Redshao (border collie), Baobao (golden × shepherd) | Coke (border collie, 16 actions, bundled with the app) |

**Credit for the methodology, the asset pipeline, and all documentation belongs to the upstream author.** The work here is making the client genuinely usable on Windows, packageable, and stable over long sessions.

---

## What this fork changes

Changes are concentrated in `viewer/` (Electron + PixiJS client):

| Area | Change |
|---|---|
| **Release** | electron-builder packaging for Windows: **NSIS installer + single-file portable**; the Coke pet pack ships with the app (seeded on first launch, never overwriting an existing pet) |
| **Action categories** | Action roles are data-driven: each action's `trigger` field in `pet.json` (`idle`/`click`/`auto`/`menu`) is the **single source of truth**; the idle group is derived from it instead of being hardcoded in the renderer |
| **Menus** | Tray and context menus auto-expand into categorized submenus (🛋 Idle / 🐾 Interaction / 📋 Menu); the context menu is anchored to the sprite's alpha bounding box so it no longer drifts across monitors or display scaling |
| **Idle rotation** | Three resting animations (couch / pillow / belly-up) stay resident in VRAM and loop in rotation |
| **Animation rhythm** | Tray submenu presets (3/6/12/20 s) plus a **custom dialog** (1 s – 24 h, seconds/minutes/hours), persisted in `localStorage` |
| **Pomodoro** | Dedicated window with the timer running in the main process (**keeps running when the window closes**), live countdown rendered in the pet's **speech bubble**, system notification + pet action when a phase ends |
| **Reminders** | Natural-language input (e.g. "remind me to drink water in a minute"), persisted to `~/.petpet/reminders.json`, daily/weekly repeats, brings the pet window to front when triggered |
| **Diary** | Dedicated panel window; the action → mood text mapping comes from the `diary` field in `pet.json` (no longer hardcoded) |
| **Pet pack import** | Tray menu "📦 Import pet pack": pick a folder or a `.petpack`/`.zip`, validated and installed into `~/.petpet/pets/` |
| **Cursor tracking** | When the cursor comes near, the pet switches to "look at you" and **maps the cursor angle to animation frames in real time** (300 px radius, 80 px hysteresis, 500 ms exit delay to stop boundary flicker) |
| **Speech bubble** | Scans the union alpha bounding box of the animation to find the head, so the bubble sits right above it, horizontally centered |
| **Performance / stability** | 30 fps render ticker; idle group stays resident while other actions load lazily and release VRAM when done; **WebGL context-loss self-healing** (contextlost/restored rebuild); rendering only pauses when minimized (deliberately not on blur, so child windows don't freeze the pet) |

> These changes also updated `schema/pet.schema.json` and `pipeline/validate_pet.py` — upstream's `trigger` enum only allowed `click/auto/menu`, while this fork adds `idle`. Both are now aligned, so **the upstream validator accepts this repo's pet packs**.

---

## Quick Start (client)

### Requirements

- **Node.js ≥ 20** (developed on 22)
- **Windows 10/11** (the tested platform for this fork; see "Status" below for macOS)

### Develop & run

```bash
cd viewer
npm install          # installs Electron + PixiJS (slow the first time)
npm run dev          # dev mode: vite HMR + electron
npm run build        # tsc --noEmit && vite build → dist/
npm start            # build then launch
npm test             # vitest unit tests
```

> The main process (`viewer/main.js`) is loaded by Electron directly and is **not bundled**; the renderer (`viewer/src/`) must be built into `dist/` before launching.

### Where pet packs live

A pet is just a data package at `~/.petpet/pets/<pet-name>/`:

```
~/.petpet/pets/coke/
├── pet.json              # action definitions (sprite / frames / fps / trigger / diary …)
├── idle/idle_sheet.webp  # one horizontal sprite sheet per action
└── …
```

- **Works out of the box**: the bundled Coke pet pack is seeded automatically on first launch
- **Install another pet**: tray menu → "📦 Import pet pack" → pick a folder or `.petpack`/`.zip`
- **Build your own pet**: follow the upstream asset pipeline (see below)

---

## Action categories: the `trigger` field

Each action's role in `pet.json` is decided by `trigger`, the **single source of truth** in this fork:

| `trigger` | Meaning |
|---|---|
| `idle` | **Idle rotation group**: stays resident in VRAM, loops, rotated by the "animation switch" interval |
| `click` | **Interaction**: triggered randomly on click, showing that action's diary bubble text |
| `menu` | **Menu-only**: triggered manually from the tray/context menu |
| `auto` | Legacy: enters the random behavior pool (still requires `weight > 0`) |
| absent | Legacy behavior (`weight`/random + menu) |

Adding or removing idle/interaction animations **only requires editing `pet.json`** — menu grouping and the idle rotation follow automatically.

Validate a pet pack (recommended before packaging or sharing):

```bash
python pipeline/validate_pet.py viewer/resources/pets/coke
```

Schema: `schema/pet.schema.json` (v3)

---

## Packaging (Windows installer / portable)

```bash
cd viewer
npm run build

# NSIS installer (choose install dir, desktop shortcut)
npx electron-builder --win nsis

# Single-file portable build
npx electron-builder --win portable
```

Output goes to `viewer/release/` by default; the version in the file name comes from `version` in `viewer/package.json`.

> **Behind a slow network (e.g. in China)**: electron-builder pulls Electron and the nsis toolset from GitHub, which often times out or returns 502. Point **both** mirrors at npmmirror:
>
> ```powershell
> $env:ELECTRON_MIRROR = "https://cdn.npmmirror.com/binaries/electron/"
> $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://cdn.npmmirror.com/binaries/electron-builder-binaries/"
> ```
>
> Setting `$env:` in PowerShell is more reliable than Bash `export`. Both are required — setting only the second one still fails while downloading Electron itself.

---

## Repository layout

```
pet/
├── viewer/              The client (where this fork's work lives)
│   ├── main.js          Main process: windows/tray/context menu, reminders, pomodoro, pet import, cursor proximity polling
│   ├── preload.cjs      IPC bridge
│   ├── src/             Renderer (PixiJS, built into dist/)
│   │   ├── main.ts      Sprite playback, idle rotation, bubbles, zoom, cursor tracking
│   │   ├── reminder.ts  Reminder parsing
│   │   ├── state-priority.ts / temperament.ts   State arbitration & temperament
│   │   └── style.css
│   ├── index.html       Main pet window
│   ├── panel.html       Diary panel
│   ├── reminder.html    Reminder window
│   ├── pomodoro.html    Pomodoro window
│   ├── switch-interval.html  Animation-interval settings window
│   ├── resources/pets/coke/  Bundled Coke pet pack (16 actions)
│   ├── assets/          Icons
│   └── tests/           vitest unit tests
├── pipeline/            Upstream: asset pipeline scripts (select frames / matting / clean / sheet / validate / prompts)
├── docs/                Upstream: methodology docs (00-15 + review checklists)
├── schema/              Contracts (pet.json v3 + 16-field pet profile)
├── templates/           Profile fill-in templates
├── examples/            Upstream: sample assets and demo pet packs
├── skills/              AI assistant working guide
├── tests/               Upstream: pipeline tests
├── requirements.txt / pyproject.toml
├── LICENSE              MIT (upstream copyright notice retained)
└── SECURITY.md / CONTRIBUTING.md
```

---

## Upstream methodology (`docs/`)

To build a pet of **your own** (not just run Coke), follow the upstream pipeline: pet trait collection → prompts → AI-generated action videos → frame selection / matting / sheet assembly → pet pack.

| Goal | Read |
|---|---|
| Build a desktop pet for your own pet | `01-data-model` → `02-traits-and-prompts` → `05-asset-pipeline` → `03-requirements` |
| Understand the client design & IPC | `04-architecture` → `08-interface-contract` → `09-cross-platform` |
| Avoid pitfalls | `07-pitfall-log` (every entry is a hard-won rule) |
| Parameter details / roadmap | `06-parameters` / `10-architecture-review` / `12-optimization-roadmap` |

Running the asset pipeline (Python):

```bash
pip install -r requirements.txt
python pipeline/select_frames.py --input <frames-dir> --output selected/ --frames 12
python pipeline/remove_bg.py     --input selected/ --output cutout/
python pipeline/clean_cutout.py  --input cutout/   --output clean/
python pipeline/make_sheet.py    --input clean/    --output . --name mypet.png
python pipeline/validate_pet.py  mypet/            # run before packaging
```

> Note: upstream docs are written in Chinese, but the pipeline scripts, JSON schemas, and viewer code are language-agnostic.

---

## Status

- ✅ **Windows**: tested. V0.01 ships an installer (`PetPet Setup 0.0.1.exe`) and a portable build (`PetPet 0.0.1.exe`), with idle rotation, pomodoro, reminders, diary, animation-rhythm control, and cursor tracking
- ⚠️ **macOS**: upstream's tested platform; **not verified in this fork** (the `mac` packaging config is retained but untested)
- ℹ️ `.github/workflows/ci.yml` is inherited from upstream. This repo's history was rewritten (a single commit, no upstream history), so checks that depend on upstream commit history (e.g. `check_refs.py`) will fail — adjust or remove them before enabling Actions

---

## License & asset rights

- **Code**: [MIT](LICENSE). The upstream copyright notice is retained as required by MIT (`Copyright (c) 2026 stshourenxy-dev`); this fork's modifications are released under MIT as well
- **`examples/` assets**: the pet photos and reference images belong to their respective owners; provided as samples only — do not use commercially or redistribute
- **AI-generated animations**: produced on an AI platform — keep the platform's AI-disclosure requirements when publishing
- **`viewer/resources/pets/coke/`** (the Coke pet pack): my own pet's assets, published here **for demonstration only** — do not use commercially or redistribute

---

## Acknowledgements

- Upstream project **[stshourenxy-dev/petpet-playbook](https://github.com/stshourenxy-dev/petpet-playbook)**: the methodology, pipeline scripts, documentation, client skeleton, and interface contract all come from upstream. This fork merely got it running on Windows and filled in the features a desktop client needs
- The upstream sample pets Redshao and Baobao, and the open-source tools used by the pipeline (rembg / Pillow / numpy, etc.)
