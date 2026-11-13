# Project Desk (项目台)

> **Chinese name**: 项目台　|　**Identifier / repo**: `project-desk`

[简体中文版 →](README.md)

A macOS workspace and local script launcher. It gathers scattered HTML, Python and Node projects
into one desk and runs them for real, in an embedded terminal, with a single button.

> Positioning: an Obsidian-style project workspace plus a local script launcher. Not an IDE,
> not a standalone terminal app, and it never modifies any project source file.
> Internal identifiers: `com.nathan.projectdesk` (Bundle ID), `project-desk` (Cargo package).

---

## Background: the more AI writes, the more you need a desk

With AI, asking a model to whip up a Python script, an HTML page or a small Node tool costs almost nothing.
The result is a fast-growing pile of one-off projects: scattered across the disk, casually named,
entry points buried in subdirectories, with interpreters, ports and start commands remembered only by you.
Two weeks later you no longer know how to run them — or whether it is safe to delete them.

Project Desk is a workspace built for exactly these generated artifacts. Register them as projects,
give them categories, tags and display names, then run them from one button in an embedded terminal,
with output, exit codes and logs kept on record. **It does not touch your source files,
does not install dependencies for you, and does not decide how a project should run.**

Two conventions make an AI-generated project usable the moment it lands: a root-level `launcher.json`
(how to run it) and a root-level `README.md` (what it is and how to use it). See the next section.

---

## Two root-level conventions for AI-generated projects

"Root" here means **the project directory you registered in Project Desk** (`projects.root_path`) —
not this repository's root, and not a subdirectory inside the project.

| File | Written by | What Project Desk does with it |
| --- | --- | --- |
| `launcher.json` | AI, following the spec / you | Reads the run configuration: display name, entry point, command and args, working directory, port strategy, stop strategy. Falls back to auto-detection if validation fails |
| `README.md` (or `.markdown` / `.mdx` / `说明.md`) | AI / you | Rendered as Markdown in the project's "说明" (Notes) tab, as the project's manual |

### 1. `launcher.json` and the AI generation spec

**[`docs/launcher-json.md`](docs/launcher-json.md)** (written in Chinese) is a generation spec for AI:
it asks the model to emit a valid `launcher.json` at the project root whenever it produces a script,
a web page or a small tool. It serves three purposes:

1. **No manual setup** — Project Desk reads the file when the project is added and uses it as the
   initial run configuration, so you do not have to fill in command, interpreter, entry point and port.
2. **Keeps AI from guessing** — the spec requires `url: null` for dynamic ports instead of guessing 3000,
   arguments in `args` instead of concatenated into `command`, and no relative path escaping the project root.
   These are exactly the mistakes AI-generated configs tend to make, and they lead to false port-conflict
   detection or wrongly split paths.
3. **A verifiable contract** — `schemaVersion`, unique `id`s, `defaultConfig` references, enum values and
   path existence are all strictly validated. An invalid file is rejected as a whole with a fallback to
   auto-detection; nothing is silently run the wrong way.

Priority: **settings saved manually in Project Desk ＞ `launcher.json` ＞ auto-detection**.
Manually edited configurations are never overwritten by a re-sync; run state and logs are managed by the
app only and are never written back into the file. A ready-to-copy template lives at `fixtures/launcher.json`.

### 2. The "说明" (Notes) tab reads the root README

The "说明" tab calls `read_project_readme`, which reads **only files in that project's root directory** —
it does not recurse into subdirectories. Matching is case-insensitive and accepts
`README.md`, `README.markdown`, `README.mdx` and `说明.md`.

- Content is rendered as Markdown (marked + DOMPurify sanitising); files over 256 KB are truncated
  to the first 256 KB with a notice.
- The bar shows the actual filename and offers "open with default app" and "reveal in Finder".
- If none of these files exist, an empty state is shown together with the current root path.

So ask AI to drop a `README.md` at the **project root** and its notes appear inside Project Desk.
A file in `docs/`, `src/` or any other subdirectory is not picked up. Auto-detection also treats
`README.md` as a signal, but a README alone is not enough to infer how to run a project —
you still need `launcher.json` or a manual configuration.

---

## 1. Tech stack

| Layer | Technology |
| --- | --- |
| Desktop framework | Tauri 2 (macOS 11+, ~8 MB .app) |
| Backend | Rust (filesystem, process management, SQLite, terminal integration) |
| Frontend | React 18 + TypeScript + Vite 6 |
| Styling | Hand-written CSS variable system; no UI framework, no Tailwind |
| Icons | Lucide |
| Data | SQLite (rusqlite, bundled, WAL, versioned migrations) |

## 2. Directory layout

Source, artifacts and scripts are kept apart:

```
project-desk/
├── src/                        Frontend (React + TS)
│   ├── App.tsx                 Three-pane layout, panel drag, global drop, polling
│   ├── main.tsx                Entry (UiProvider)
│   ├── types.ts                Types mirroring the Rust serde models
│   ├── styles.css              All styles (light/dark tokens)
│   ├── lib/                    api / store / ui / format / projectActions
│   ├── components/             Sidebar / TopBar / ProjectList / DetailPanel
│   │                           FileTree / RunsView / Settings / ReadmePane / primitives
│   └── dialogs/                AddProject / ConfigEditor / other dialogs
├── src-tauri/                  Backend (Rust)
│   ├── src/lib.rs              App wiring, Chinese menu, command registration
│   ├── src/db.rs               SQLite schema, migrations, all CRUD
│   ├── src/models.rs           Data models (serde camelCase)
│   ├── src/commands.rs         Tauri command layer (the only frontend/backend boundary)
│   ├── src/detect.rs           Project type detection + Python interpreter discovery
│   ├── src/manifest.rs         launcher.json parsing and validation
│   ├── src/launcher.rs         Run-script generation, process-tree stop, Finder integration
│   ├── src/pty.rs              Embedded terminal (portable-pty)
│   ├── src/runs.rs             Start / stop / status derivation
│   ├── src/paths.rs            Path normalisation and shell escaping
│   ├── src/shellenv.rs         Login-shell PATH detection (required for GUI apps)
│   ├── icons/                  App icons
│   └── tauri.conf.json         Window, CSP and bundle configuration
│
├── tools/                      Build and maintenance scripts
│   ├── build/build.sh          One-shot build, copies the .app into build/app/
│   ├── build/test.sh           Backend unit tests
│   ├── build/verify.sh         Tests + build
│   ├── dev/dev.sh              Dev mode
│   └── maintain/               cleanup.sh / make_icon.py / apply_logo.py
│
├── fixtures/                   Sample projects for testing the run pipeline
│   ├── demo-python/main.py
│   ├── demo-html/index.html
│   └── launcher.json           Configuration template (spec: docs/launcher-json.md)
│
├── build/                      Build artifacts (gitignored)
│   ├── app/项目台.app           Runnable .app
│   └── logs/                   build.log / test.log
│
├── docs/BUILD.md               Full build guide (Chinese)
├── docs/launcher-json.md       launcher.json generation spec (Chinese)
├── index.html / vite.config.ts / tsconfig*.json / package.json
├── README.md                   Chinese README
└── README.en.md                This file
```

> `index.html`, `src/`, `dist/`, `package.json` and `src-tauri/` are looked up by the toolchain
> at fixed paths and **must not be moved**. See section 7 of `docs/BUILD.md`.

`node_modules/`, `dist/` and `src-tauri/target/` are toolchain output and are all gitignored.

## 3. Development environment

- macOS 11 or later, Xcode Command Line Tools (`xcode-select --install`)
- Node.js ≥ 18
- Rust stable (via `rustup`, verified on 1.99.1)

Verified locally: Node v22.22.2 / npm 11.9.0 / Rust 1.99.1 / Tauri CLI 2.x.

If `rustup` is slow on your network, a mirror helps:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | RUSTUP_DIST_SERVER=https://rsproxy.cn sh -s -- -y --profile minimal
```

> If `npm` is not on your PATH (common when Node is managed by another tool),
> `tools/build/build.sh` already probes the usual locations.
> `cargo` is not on PATH by default (it lives in `~/.cargo/bin`); before a manual build run
> `export PATH="$HOME/.cargo/bin:$PATH"`.

## 4. Common commands

```bash
npm install                # Install frontend dependencies
npm run dev                # Frontend only (UI in a browser, no backend capabilities)
npm run app:dev            # Full desktop app in dev mode, with hot reload
npm run build              # Type check + frontend build
npm run app:build          # Bundle the macOS .app

bash tools/build/build.sh    # One-shot build; log at build/logs/build.log
bash tools/build/test.sh     # Backend unit tests; log at build/logs/test.log
bash tools/build/verify.sh   # Tests + build
bash tools/dev/dev.sh        # Dev mode
bash tools/maintain/cleanup.sh   # Remove temporary files
```

> Full build guide: **[`docs/BUILD.md`](docs/BUILD.md)** (Chinese).

Artifacts:

```
build/app/项目台.app                                   ← double-click or drag into Applications
src-tauri/target/release/bundle/macos/项目台.app     ← raw Tauri output
```

Database and task logs:

```
~/Library/Application Support/com.nathan.projectdesk/project-desk.sqlite3
~/Library/Application Support/com.nathan.projectdesk/runs/<run_id>/
    task.sh      generated script for this run (reviewable)
    task.pid     process id
    task.exit    exit code
    task.log     full output
```

## 5. Implementation notes

### 1. Display names are fully decoupled from disk paths

`projects.name` is app metadata; `projects.root_path` is the real directory. Renaming only runs
`UPDATE projects SET name` — no path operation ever writes a directory name. Renaming, re-categorising,
tagging, favouriting and relocating never touch source files.

### 2. Project detection

Scans the root for `package.json` (scripts), any `*.html` (`index.html` preferred, others sorted by name),
`main.py` / `app.py` / `run.py` / …, `pyproject.toml`, `requirements.txt`, `*.sh` and in-project
virtualenvs (`.venv` / `venv` / `env`). It suggests a type, entry point, interpreter and command,
shown as a detection result in the add dialog; every field stays editable. Detection is only a suggestion —
an `index.html` may still need an HTTP server, and a `main.py` may not be meant to run directly.
The UI states this explicitly.

### 3. Duplicate path detection

`paths::compare_key()` canonicalises first (resolving symlinks and normalising `/private/var` vs `/var`),
then lowercases and strips the trailing slash, so `~/Project`, `~/Project/` and symlinks pointing to the
same directory are all detected as duplicates.

### 4. Embedded terminal (real execution, no external window)

Clicking Run makes the backend:

1. Validate project directory, working directory, entry file, interpreter and port availability;
2. Generate `task.sh` under `runs/<id>/` (single-quoted paths, explicit `cd`, login-shell PATH and env injected);
3. Open a real pty via `portable-pty`, run `/bin/bash task.sh` as a child process, render it with xterm.js;
4. Write output to both `task.log` and the `run://output` event (base64) for live rendering,
   with ANSI colours and interactive input;
5. Emit `run://exit` when the child exits; `task.pid` / `task.exit` are still written so status can be
   derived after a restart.

Static HTML is the exception: a "static HTML" configuration opens the file in the default browser
without spawning a process and produces no run record (the primary button reads "Open").

The terminal accepts keyboard input (Vite asking for another port, Django's `createsuperuser` prompt)
and forwards `resize` to the pty. Historical runs replay `task.log` read-only.

Status semantics: `Requested → Starting → Running → Finished / Failed (exit code) / Stopped / Unknown`.
If the process is gone and there is no exit code, the app shows "Unknown" instead of faking "Running".

### 5. Process-tree stop

Stopping uses `ps -axo pid=,ppid=` to collect the whole child tree, sends `SIGTERM` to every process,
waits 2 seconds, then `SIGKILL`s the survivors. This avoids killing only the parent and leaving
`npm` / `node` children holding the port.

### 6. Security boundaries

- The frontend cannot run arbitrary commands; it only calls the controlled commands in `commands.rs`;
- A custom command must be saved in a run configuration first, and the full command line is shown before execution;
- All path arguments are single-quote escaped, never string-concatenated;
- File-tree reads are confined to registered project directories (`is_within` checks);
- No `sudo`, no automatic dependency installation, no changes to shell configuration files;
- No silent deletion: removing a project deletes only the database record, with an explicit notice
  that files on disk are unaffected.

### 7. Data model

`categories` / `projects` / `tags` / `project_tags` / `launch_configurations` / `run_history` /
`app_settings`, migrated sequentially with `PRAGMA user_version` (currently v2); upgrades keep project records.

## 6. Known limitations

- **Port conflict detection is a pre-start snapshot** — it cannot stop another process from taking the port later.
- **Long-running health checks only test process liveness**, not HTTP availability. A service that crashed
  internally while its process stays alive still shows "Running".
- **Terminal sessions do not survive an app restart**: the pty closes, children get SIGHUP, and only the
  log can be replayed afterwards.
- **The terminal renders only the currently open task**: output still goes to the log while you are on
  another page, but is not kept in a terminal buffer (it is replayed when you come back).
- **No system-wide hotkeys, no menu-bar resident mode, no multiple windows.**
- **Run history is not cleaned automatically** (the Settings page has a one-click clear); log files keep growing.
- **Every rebuild requires re-granting folder access**: the app uses Tauri's ad-hoc signature, whose
  fingerprint changes on each build, and macOS records "Files and Folders" permission per signing identity.
  A final build only asks once.
  - If you clicked "Don't Allow": System Settings → Privacy & Security → Files and Folders → 项目台 → enable "Documents";
  - or run `tccutil reset SystemPolicyDocumentsFolder com.nathan.projectdesk` to be asked again.
- **Duplicate launches** are handled by single-instance protection: a second launch just focuses the
  existing window (two instances previously fought over SQLite and crashed).
- **macOS only** — directory picking and Finder integration are macOS implementations.
- Installing dependencies and creating virtual environments are left to you in a terminal. This is an
  intentional boundary.

