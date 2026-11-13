import { useEffect, useState } from "react";
import {
  Check,
  Database,
  Download,
  FolderOpen,
  HardDrive,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
  Info,
} from "lucide-react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { actions, useAppState } from "../lib/store";
import { useUi } from "../lib/ui";
import { call } from "../lib/api";
import { prettyPath } from "../lib/format";
import { Button, IconButton, Segmented, Spinner, Toggle } from "./primitives";
import type { ImportReport, PythonInfo, RuntimePath } from "../types";

function Row({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <span>{label}</span>
        {desc && <p>{desc}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-section">
      <h2>
        <span className="settings-section-icon">{icon}</span>
        {title}
      </h2>
      <div className="settings-card">{children}</div>
    </section>
  );
}

export function Settings() {
  const s = useAppState();
  const ui = useUi();
  const [detected, setDetected] = useState<PythonInfo[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [runtimes, setRuntimes] = useState<RuntimePath[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    call<RuntimePath[]>("runtime_paths")
      .then(setRuntimes)
      .catch(() => setRuntimes([]));
  }, []);

  const update = (patch: Partial<typeof s.settings>) => actions.persistSettings(patch);

  const scanPython = async () => {
    setScanning(true);
    try {
      const list = await call<PythonInfo[]>("list_python_interpreters", { projectId: null });
      setDetected(list);
      if (!list.length) ui.toast("没有在常见位置找到 Python 解释器", "info");
    } catch (err) {
      ui.toast(err instanceof Error ? err.message : "扫描失败", "error");
    } finally {
      setScanning(false);
    }
  };

  const addInterpreter = (path: string) => {
    if (s.settings.pythonInterpreters.includes(path)) {
      ui.toast("该解释器已在列表中", "info");
      return;
    }
    update({ pythonInterpreters: [...s.settings.pythonInterpreters, path] });
  };

  const removeInterpreter = (path: string) => {
    update({ pythonInterpreters: s.settings.pythonInterpreters.filter((p) => p !== path) });
  };

  const exportManifest = async () => {
    try {
      const target = await saveDialog({
        title: "导出项目清单",
        defaultPath: "项目台-项目清单.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!target || typeof target !== "string") return;
      setBusy(true);
      const saved = await call<string>("export_manifest", { path: target });
      ui.toast(`已导出到 ${prettyPath(saved)}`, "success");
    } catch (err) {
      ui.toast(err instanceof Error ? err.message : "导出失败", "error");
    } finally {
      setBusy(false);
    }
  };

  const importManifest = async () => {
    try {
      const picked = await openDialog({
        title: "导入项目清单",
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!picked || typeof picked !== "string") return;
      setBusy(true);
      const report = await call<ImportReport>("import_manifest", { path: picked });
      await actions.refreshProjects();
      await actions.refreshRuns();
      const details: string[] = [];
      details.push(`成功导入 ${report.imported} 个项目`);
      if (report.skippedExisting) details.push(`跳过 ${report.skippedExisting} 个已存在的路径`);
      if (report.categoriesCreated) details.push(`新建 ${report.categoriesCreated} 个分类`);
      if (report.missingPaths.length) {
        details.push(...report.missingPaths.map((p) => `路径不存在，已标记为失效：${p}`));
      }
      if (report.errors.length) details.push(...report.errors);
      await ui.alert({ title: "导入完成", details });
    } catch (err) {
      ui.toast(err instanceof Error ? err.message : "导入失败", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-scroll">
        <header className="settings-head">
          <h1>设置</h1>
          <p>所有数据保存在本机 SQLite 数据库，不依赖云端服务。</p>
        </header>

        <Section title="通用" icon={<Check size={14} />}>
          <Row label="主题" desc="跟随系统外观，或固定为浅色 / 深色。">
            <Segmented
              value={s.settings.theme}
              options={[
                { value: "system", label: "跟随系统" },
                { value: "light", label: "浅色" },
                { value: "dark", label: "深色" },
              ]}
              onChange={(theme) => update({ theme })}
            />
          </Row>
          <Row label="默认视图" desc="项目列表默认以列表或网格展示。">
            <Segmented
              value={s.settings.view}
              options={[
                { value: "list", label: "列表" },
                { value: "grid", label: "网格" },
              ]}
              onChange={(view) => update({ view })}
            />
          </Row>
          <Row label="启动时显示" desc="应用打开后默认进入的页面。">
            <select
              className="select"
              value={s.settings.startup}
              onChange={(e) =>
                update({ startup: e.target.value as typeof s.settings.startup })
              }
            >
              <option value="last">上次的页面</option>
              <option value="all">所有项目</option>
              <option value="recent">最近使用</option>
              <option value="favorite">收藏项目</option>
            </select>
          </Row>
          <Row label="恢复上次工作区" desc="记住上次选中的项目、导航位置与面板宽度。">
            <Toggle
              checked={s.settings.restoreWorkspace}
              onChange={(v) => update({ restoreWorkspace: v })}
              label="恢复上次工作区"
            />
          </Row>
        </Section>

        <Section title="运行环境" icon={<HardDrive size={14} />}>
          <Row
            label="Python 解释器"
            desc="保存在这里的解释器会出现在运行配置的下拉列表中。每个项目仍可单独指定。"
          >
            <Button size="sm" icon={<RefreshCw size={12} />} onClick={scanPython} disabled={scanning}>
              {scanning ? "扫描中…" : "扫描本机 Python"}
            </Button>
          </Row>
          <div className="setting-block">
            {s.settings.pythonInterpreters.length === 0 ? (
              <p className="setting-empty">还没有保存常用解释器。点击上方按钮扫描，或在运行配置中手动指定。</p>
            ) : (
              <div className="path-list">
                {s.settings.pythonInterpreters.map((p) => (
                  <div key={p} className="path-item">
                    <code>{prettyPath(p)}</code>
                    <IconButton label="移除" onClick={() => removeInterpreter(p)}>
                      <X size={12} />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}

            {detected && detected.length > 0 && (
              <div className="detected-list">
                <div className="detected-head">
                  <span>本机检测到 {detected.length} 个解释器</span>
                  <button className="link-btn" onClick={() => setDetected(null)}>
                    收起
                  </button>
                </div>
                {detected.map((py) => {
                  const added = s.settings.pythonInterpreters.includes(py.path);
                  return (
                    <div key={py.path} className="detected-item">
                      <div className="detected-main">
                        <span className="detected-label">{py.label}</span>
                        <code className="detected-path">{prettyPath(py.path)}</code>
                      </div>
                      <button
                        className="mini-btn"
                        disabled={added}
                        onClick={() => addInterpreter(py.path)}
                      >
                        {added ? <Check size={11} /> : <Plus size={11} />}
                        {added ? "已添加" : "添加"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Row label="常用运行时" desc="从登录 shell 的 PATH 中探测到的可执行文件。">
            <div className="runtime-grid">
              {runtimes.length === 0 ? (
                <span className="setting-empty">未检测到</span>
              ) : (
                runtimes.map((r) => (
                  <div key={r.name} className="runtime-item">
                    <span className="runtime-name">{r.name}</span>
                    <code title={r.path}>{prettyPath(r.path)}</code>
                  </div>
                ))
              )}
            </div>
          </Row>

          <Row label="本地服务默认端口" desc="新建 Web 运行配置时的初始端口。">
            <input
              className="input input-num"
              type="number"
              min={1}
              max={65535}
              value={s.settings.defaultPort}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0 && v < 65536) update({ defaultPort: v });
              }}
            />
          </Row>
        </Section>

        <Section title="项目管理" icon={<FolderOpen size={14} />}>
          <Row label="新项目默认分类" desc="添加项目时预先选中的分类。">
            <select
              className="select"
              value={s.settings.newProjectCategoryId ?? ""}
              onChange={(e) => update({ newProjectCategoryId: e.target.value || null })}
            >
              <option value="">跟随项目类型</option>
              {s.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label="启动时检查项目路径" desc="发现目录被移动或删除时标记为失效，不会删除记录。">
            <Toggle
              checked={s.settings.checkPathsOnLaunch}
              onChange={(v) => {
                update({ checkPathsOnLaunch: v });
                if (v) actions.checkPaths();
              }}
              label="启动时检查路径"
            />
          </Row>
          <Row label="重复路径检测" desc="按真实路径比较（解析符号链接、忽略大小写与结尾斜杠）。">
            <span className="readonly-value">
              <Check size={12} /> 已启用
            </span>
          </Row>
          <Row label="失效项目处理" desc="路径失效时保留记录与配置，等待手动重新定位。">
            <span className="readonly-value">保留记录</span>
          </Row>
        </Section>

        <Section title="数据管理" icon={<Database size={14} />}>
          <Row label="数据库位置" desc={s.dbPath}>
            <Button size="sm" icon={<FolderOpen size={12} />} onClick={() => call("open_data_dir").catch(() => {})}>
              打开数据目录
            </Button>
          </Row>
          <Row label="导出项目清单" desc="包含显示名称、原始路径、分类、标签与全部运行配置（不含源码）。">
            <Button size="sm" icon={<Download size={12} />} onClick={exportManifest} disabled={busy}>
              导出 JSON
            </Button>
          </Row>
          <Row label="导入项目清单" desc="导入时会校验路径与解释器是否存在，不覆盖已有项目。">
            <Button size="sm" icon={<Upload size={12} />} onClick={importManifest} disabled={busy}>
              选择文件
            </Button>
          </Row>
          <Row label="运行历史" desc="清空已结束任务的记录，正在运行的任务会保留。">
            <Button
              size="sm"
              icon={<Trash2 size={12} />}
              onClick={async () => {
                const ok = await ui.confirm({
                  title: "清空运行历史？",
                  message: "只删除已结束任务的记录，不影响项目与运行配置。",
                  confirmText: "清空",
                  danger: true,
                });
                if (!ok) return;
                try {
                  await actions.clearRunHistory();
                  ui.toast("运行历史已清空", "success");
                } catch (err) {
                  ui.toast(err instanceof Error ? err.message : "清空失败", "error");
                }
              }}
            >
              清空历史
            </Button>
          </Row>
        </Section>

        <footer className="settings-about">
          {busy && <Spinner size={12} />}
          <Info size={12} />
          <span>
            项目台 v{s.appVersion || "0.1.0"} · Tauri 2 + React + SQLite · 项目文件始终保留在原始位置
          </span>
        </footer>
      </div>
    </div>
  );
}
