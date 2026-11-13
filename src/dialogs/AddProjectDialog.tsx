import { useCallback, useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, Check, FileJson, FolderPlus, FolderSearch, ScanSearch } from "lucide-react";
import { call, IpcError } from "../lib/api";
import { actions, useAppState } from "../lib/store";
import { useUi } from "../lib/ui";
import { RUNTIME_HINT, RUNTIME_LABEL, TYPE_LABEL } from "../lib/format";
import { Button, Field, Modal, Spinner, Toggle } from "../components/primitives";
import type { ConfigInput, Detection, ProjectType, PythonInfo, RuntimeType } from "../types";

const RUNTIMES: RuntimeType[] = ["python", "html", "web", "node", "shell", "custom"];

export function AddProjectDialog({ paths }: { paths?: string[] }) {
  const ui = useUi();
  const s = useAppState();
  const initial = useMemo(() => (paths ?? []).filter(Boolean), [paths]);

  const batchPaths = useMemo(() => (initial.length > 1 ? initial : []), [initial]);
  const [rootPath, setRootPath] = useState<string | null>(initial.length === 1 ? initial[0] : null);
  const [det, setDet] = useState<Detection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [type, setType] = useState<ProjectType>("other");
  const [categoryId, setCategoryId] = useState("");
  const [tagText, setTagText] = useState("");
  const [runtime, setRuntime] = useState<RuntimeType>("custom");
  const [entry, setEntry] = useState("");
  const [executable, setExecutable] = useState("");
  const [command, setCommand] = useState("");
  const [port, setPort] = useState<string>("");
  const [url, setUrl] = useState("");
  const [openBrowser, setOpenBrowser] = useState(false);
  const [createConfig, setCreateConfig] = useState(true);
  const [saving, setSaving] = useState(false);
  const [interpreters, setInterpreters] = useState<PythonInfo[]>([]);
  const [batchState, setBatchState] = useState<
    { path: string; det?: Detection; error?: string }[]
  >([]);
  const [batchCategory, setBatchCategory] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);

  const pickFolder = async () => {
    const dir = await openDialog({
      title: "选择项目文件夹",
      directory: true,
      multiple: false,
    });
    if (typeof dir === "string") {
      setRootPath(dir);
      setError(null);
    }
  };

  const applyDetection = useCallback(
    (d: Detection) => {
      setName(d.suggestedName);
      setType(d.projectType);
      setRuntime(d.runtimeType);
      setEntry(d.entryPath ?? "");
      setExecutable(d.executablePath ?? "");
      setCommand(d.command ?? "");
      setPort(d.port ? String(d.port) : "");
      setUrl(d.port ? `http://localhost:${d.port}` : "");
      setOpenBrowser(false);
      setCreateConfig(true);
      const fallback =
        s.settings.newProjectCategoryId ??
        s.categories.find((c) => c.kind === d.categoryKind)?.id ??
        "";
      setCategoryId(fallback);
    },
    [s.settings.newProjectCategoryId, s.categories],
  );

  useEffect(() => {
    if (!rootPath) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    call<Detection>("detect_project", { path: rootPath })
      .then((d) => {
        if (cancelled) return;
        setDet(d);
        applyDetection(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "无法识别该项目目录");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath, applyDetection]);

  useEffect(() => {
    call<PythonInfo[]>("list_python_interpreters", { projectId: rootPath })
      .then(setInterpreters)
      .catch(() => setInterpreters([]));
  }, [rootPath]);

  // 批量模式：逐个识别
  useEffect(() => {
    if (!batchPaths.length) return;
    let cancelled = false;
    setBatchBusy(true);
    Promise.all(
      batchPaths.map(async (p) => {
        try {
          const d = await call<Detection>("detect_project", { path: p });
          return { path: p, det: d };
        } catch (err) {
          return { path: p, error: err instanceof Error ? err.message : "识别失败" };
        }
      }),
    ).then((items) => {
      if (cancelled) return;
      setBatchState(items);
      setBatchBusy(false);
      if (!batchCategory) {
        const first = items.find((i) => i.det)?.det;
        const fallback =
          s.settings.newProjectCategoryId ??
          (first ? s.categories.find((c) => c.kind === first.categoryKind)?.id : "") ??
          "";
        setBatchCategory(fallback);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchPaths]);

  const runtimeOptions = RUNTIMES;
  const interpreterOptions = useMemo(() => {
    const list = new Map<string, string>();
    if (det?.executablePath) list.set(det.executablePath, "自动检测");
    s.settings.pythonInterpreters.forEach((p) => list.set(p, "设置中的常用解释器"));
    interpreters.forEach((i) => {
      if (!list.has(i.path)) list.set(i.path, i.label);
    });
    return Array.from(list.entries());
  }, [det?.executablePath, interpreters, s.settings.pythonInterpreters]);

  const submit = async () => {
    if (!rootPath) return;
    setSaving(true);
    setError(null);
    const tags = tagText
      .split(/[,，\s]+/)
      .map((t) => t.replace(/^#/, "").trim())
      .filter(Boolean);

    let config: ConfigInput | null = null;
    if (createConfig) {
      config = {
        name: "默认运行",
        runtimeType: runtime,
        executablePath: executable.trim() || null,
        entryPath: entry.trim() || null,
        workingDirectory: null,
        arguments: [],
        envVars: [],
        command: runtime === "web" || runtime === "custom" ? command.trim() || null : null,
        launchMode: "terminal",
        port: runtime === "web" && port ? Number(port) : null,
        url: runtime === "web" ? url.trim() || null : null,
        openBrowser: runtime === "web" ? openBrowser : false,
        keepWindow: s.settings.keepWindow,
        unbuffered: true,
        isDefault: true,
        allowConcurrent: false,
      };
    }

    try {
      await actions.addProject({
        name: name.trim(),
        rootPath,
        projectType: type,
        categoryId: categoryId || null,
        tags,
        config,
      });
      ui.toast(`已添加项目「${name.trim()}」`, "success");
      ui.closeDialog();
    } catch (err) {
      if (err instanceof IpcError && err.code === "duplicate_path") {
        const go = await ui.confirm({
          title: "这个文件夹已经添加过了",
          message: err.message,
          confirmText: "查看已有项目",
          cancelText: "返回",
        });
        if (go && err.projectId) {
          actions.setNav({ kind: "all" });
          await actions.selectProject(err.projectId);
          ui.closeDialog();
        }
        return;
      }
      setError(err instanceof Error ? err.message : "添加失败");
    } finally {
      setSaving(false);
    }
  };

  const submitBatch = async () => {
    setBatchBusy(true);
    let ok = 0;
    const errors: string[] = [];
    for (const item of batchState) {
      if (!item.det) {
        errors.push(`${item.path}：${item.error ?? "识别失败"}`);
        continue;
      }
      const d = item.det;
      try {
        await actions.addProject({
          name: d.suggestedName,
          rootPath: d.rootPath,
          projectType: d.projectType,
          categoryId: batchCategory || null,
          tags: [],
          config: createConfig
            ? {
                name: "默认运行",
                runtimeType: d.runtimeType,
                executablePath: d.executablePath,
                entryPath: d.entryPath,
                workingDirectory: null,
                arguments: [],
                envVars: [],
                command: d.command,
                launchMode: "terminal",
                port: d.port,
                url: d.port ? `http://localhost:${d.port}` : null,
                openBrowser: false,
                keepWindow: s.settings.keepWindow,
                unbuffered: true,
                isDefault: true,
                allowConcurrent: false,
              }
            : null,
        });
        ok += 1;
      } catch (err) {
        if (err instanceof IpcError && err.code === "duplicate_path") {
          errors.push(`${d.suggestedName}：已存在，已跳过`);
        } else {
          errors.push(`${d.suggestedName}：${err instanceof Error ? err.message : "添加失败"}`);
        }
      }
    }
    setBatchBusy(false);
    ui.closeDialog();
    if (errors.length) {
      await ui.alert({
        title: `已添加 ${ok} 个项目`,
        details: errors,
      });
    } else {
      ui.toast(`已添加 ${ok} 个项目`, "success");
    }
  };

  if (batchPaths.length > 1) {
    return (
      <Modal
        title="批量添加项目"
        subtitle={`共 ${batchPaths.length} 个文件夹`}
        width={620}
        onClose={() => ui.closeDialog()}
        dismissOnBackdrop={false}
        footer={
          <>
            <Button onClick={() => ui.closeDialog()}>取消</Button>
            <Button
              variant="primary"
              onClick={submitBatch}
              disabled={batchBusy || batchState.every((i) => !i.det)}
            >
              全部添加
            </Button>
          </>
        }
      >
        {batchBusy ? (
          <div className="inline-loading">
            <Spinner /> 正在识别文件夹…
          </div>
        ) : (
          <>
            <div className="batch-list">
              {batchState.map((item) => (
                <div key={item.path} className={`batch-row${item.det ? "" : " is-error"}`}>
                  <div className="batch-main">
                    <span className="batch-name">{item.det?.suggestedName ?? item.path}</span>
                    <code className="batch-path">{item.path}</code>
                  </div>
                  {item.det ? (
                    <span className="batch-type">{TYPE_LABEL[item.det.projectType]}</span>
                  ) : (
                    <span className="batch-error">
                      <AlertTriangle size={11} /> {item.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <Field label="统一分类" hint="批量添加时使用同一个分类，稍后可单独调整。">
              <select className="select" value={batchCategory} onChange={(e) => setBatchCategory(e.target.value)}>
                <option value="">未分类</option>
                {s.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="switch-row">
              <div>
                <span>同时创建运行配置</span>
                <p>按识别结果生成默认运行方式，可在添加后修改。</p>
              </div>
              <Toggle checked={createConfig} onChange={setCreateConfig} label="创建运行配置" />
            </div>
          </>
        )}
      </Modal>
    );
  }

  if (!rootPath) {
    return (
      <Modal
        title="添加项目"
        subtitle="项目文件保留在原始位置，应用只保存引用。"
        width={520}
        onClose={() => ui.closeDialog()}
        dismissOnBackdrop={false}
        footer={
          <>
            <Button onClick={() => ui.closeDialog()}>取消</Button>
            <Button variant="primary" icon={<FolderSearch size={12} />} onClick={pickFolder}>
              选择文件夹
            </Button>
          </>
        }
      >
        <div className="add-drop-hint">
          <FolderPlus size={30} />
          <h4>把项目文件夹拖进窗口</h4>
          <p>或者点击「选择文件夹」浏览本机目录。添加前会先识别项目类型与运行入口。</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="添加项目"
      subtitle={rootPath}
      width={640}
      onClose={() => ui.closeDialog()}
      dismissOnBackdrop={false}
      footer={
        <>
          <Button onClick={() => ui.closeDialog()}>取消</Button>
          <Button variant="primary" onClick={submit} disabled={loading || saving || !name.trim()}>
            {saving ? "添加中…" : "添加项目"}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="inline-loading">
          <Spinner /> 正在识别项目…
        </div>
      ) : (
        <>
          {det && (
            <div className="detect-summary">
              <div className="detect-head">
                <ScanSearch size={13} />
                <span>识别结果 · {TYPE_LABEL[det.projectType]}</span>
                {det.source === "manifest" && <span className="source-tag">来自 launcher.json</span>}
              </div>
              {det.manifest?.found && det.manifest.valid && (
                <div className="manifest-box">
                  <div className="manifest-head">
                    <FileJson size={12} />
                    <span>
                      已读取 launcher.json（规范 {det.manifest.schemaVersion}）
                    </span>
                  </div>
                  <ul className="manifest-list">
                    {det.manifest.configurations.map((mc) => (
                      <li key={mc.id} className={mc.id === det.manifest?.defaultConfig ? "is-default" : ""}>
                        <span className="manifest-name">{mc.name}</span>
                        <span className="manifest-meta">
                          {mc.runtime} · {mc.configType}
                        </span>
                        {mc.id === det.manifest?.defaultConfig && <span className="manifest-badge">默认</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {det.manifest?.found && !det.manifest.valid && (
                <ul className="detect-warnings is-error">
                  {det.manifest.errors.map((e) => (
                    <li key={e}>
                      <AlertTriangle size={11} /> launcher.json：{e}
                    </li>
                  ))}
                </ul>
              )}
              {det.signals.length > 0 && (
                <div className="signal-chips">
                  {det.signals.map((sig) => (
                    <span key={sig} className="signal-chip">
                      {sig}
                    </span>
                  ))}
                </div>
              )}
              {det.warnings.length > 0 && (
                <ul className="detect-warnings">
                  {det.warnings.map((w) => (
                    <li key={w}>
                      <AlertTriangle size={11} /> {w}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <Field label="显示名称" hint="只保存在应用内，不会重命名磁盘上的文件夹。">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <Field label="项目根目录">
            <div className="path-input-row">
              <input className="input is-mono" value={rootPath} readOnly />
              <Button size="sm" onClick={pickFolder}>
                更改
              </Button>
            </div>
          </Field>

          <div className="field-pair">
            <Field label="项目类型">
              <select className="select" value={type} onChange={(e) => setType(e.target.value as ProjectType)}>
                {(Object.keys(TYPE_LABEL) as ProjectType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="分类">
              <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">未分类</option>
                {s.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="标签" hint="用逗号或空格分隔，例如：客户, 设计">
            <input
              className="input"
              value={tagText}
              placeholder="可选"
              onChange={(e) => setTagText(e.target.value)}
            />
          </Field>

          <div className="divider" />

          <div className="switch-row">
            <div>
              <span>创建运行配置</span>
              <p>关闭则只添加目录，之后可在项目详情中配置运行方式。</p>
            </div>
            <Toggle checked={createConfig} onChange={setCreateConfig} label="创建运行配置" />
          </div>

          {createConfig && (
            <>
              <Field label="运行方式" hint={RUNTIME_HINT[runtime]}>
                <select
                  className="select"
                  value={runtime}
                  onChange={(e) => {
                    const next = e.target.value as RuntimeType;
                    setRuntime(next);
                    if (next === "html" && !entry) setEntry("index.html");
                    if (next === "python" && !entry) setEntry(det?.entryPath ?? "");
                  }}
                >
                  {runtimeOptions.map((r) => (
                    <option key={r} value={r}>
                      {RUNTIME_LABEL[r]}
                    </option>
                  ))}
                </select>
              </Field>

              {runtime !== "custom" && (
                <Field
                  label="运行入口"
                  hint={
                    runtime === "web"
                      ? "可选：静态目录或入口文件，用于自动生成 http.server 命令。"
                      : "相对项目根目录，例如 main.py / index.html"
                  }
                >
                  <input
                    className="input is-mono"
                    value={entry}
                    placeholder={runtime === "html" ? "index.html" : "main.py"}
                    onChange={(e) => setEntry(e.target.value)}
                  />
                </Field>
              )}

              {runtime === "python" && (
                <Field label="Python 解释器" hint="每个项目可以使用各自独立的虚拟环境。">
                  <div className="path-input-row">
                    <select
                      className="select"
                      value={executable}
                      onChange={(e) => setExecutable(e.target.value)}
                    >
                      <option value="">未指定（运行时自动检测）</option>
                      {interpreterOptions.map(([path, source]) => (
                        <option key={path} value={path}>
                          {path} · {source}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      onClick={async () => {
                        const picked = await openDialog({
                          title: "选择 Python 解释器",
                          multiple: false,
                          directory: false,
                        });
                        if (typeof picked === "string") setExecutable(picked);
                      }}
                    >
                      手动选择
                    </Button>
                  </div>
                </Field>
              )}

              {(runtime === "web" || runtime === "custom") && (
                <Field
                  label="启动命令"
                  hint={
                    runtime === "web"
                      ? "例如 npm run dev；留空时用 python -m http.server 在端口上托管目录。"
                      : "在 Terminal 中执行的完整命令。"
                  }
                >
                  <input
                    className="input is-mono"
                    value={command}
                    placeholder={runtime === "web" ? "npm run dev" : "python scripts/build.py"}
                    onChange={(e) => setCommand(e.target.value)}
                  />
                </Field>
              )}

              {runtime === "web" && (
                <>
                  <div className="field-pair">
                    <Field label="端口" hint="用于检测端口占用。">
                      <input
                        className="input is-mono"
                        value={port}
                        inputMode="numeric"
                        placeholder={String(s.settings.defaultPort)}
                        onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ""))}
                      />
                    </Field>
                    <Field label="访问地址">
                      <input
                        className="input is-mono"
                        value={url}
                        placeholder="http://localhost:5173"
                        onChange={(e) => setUrl(e.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="switch-row">
                    <div>
                      <span>启动后自动打开浏览器</span>
                      <p>服务启动后 2 秒打开上面的地址。</p>
                    </div>
                    <Toggle checked={openBrowser} onChange={setOpenBrowser} label="自动打开浏览器" />
                  </div>
                </>
              )}
            </>
          )}

          {error && (
            <div className="inline-error">
              <AlertTriangle size={13} /> {error}
            </div>
          )}

          <p className="form-footnote">
            <Check size={11} /> 应用不会复制、移动或修改项目内的任何文件。
          </p>
        </>
      )}
    </Modal>
  );
}
