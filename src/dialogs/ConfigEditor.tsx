import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, FolderSearch, Plus, Trash2 } from "lucide-react";
import { call } from "../lib/api";
import { actions, useAppState } from "../lib/store";
import { useUi } from "../lib/ui";
import { RUNTIME_HINT, RUNTIME_LABEL } from "../lib/format";
import { Button, Field, Modal, Toggle } from "../components/primitives";
import type { ConfigInput, EnvPair, LaunchConfig, Project, PythonInfo, RuntimeType } from "../types";

const RUNTIMES: RuntimeType[] = ["python", "html", "web", "node", "shell", "custom"];

function splitArgs(raw: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of raw) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function joinArgs(args: string[]): string {
  return args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
}

export function ConfigEditor({ project, config }: { project: Project; config?: LaunchConfig }) {
  const ui = useUi();
  const s = useAppState();
  const [name, setName] = useState(config?.name ?? "默认运行");
  const [runtime, setRuntime] = useState<RuntimeType>(
    config?.runtimeType ??
      (project.projectType === "python" ? "python" : project.projectType === "web" ? "web" : "custom"),
  );
  const [entry, setEntry] = useState(config?.entryPath ?? "");
  const [executable, setExecutable] = useState(config?.executablePath ?? "");
  const [command, setCommand] = useState(config?.command ?? "");
  const [workingDir, setWorkingDir] = useState(config?.workingDirectory ?? "");
  const [args, setArgs] = useState(joinArgs(config?.arguments ?? []));
  const [envs, setEnvs] = useState<EnvPair[]>(config?.envVars ?? []);
  const [port, setPort] = useState(config?.port ? String(config.port) : "");
  const [url, setUrl] = useState(config?.url ?? "");
  const [openBrowser, setOpenBrowser] = useState(config?.openBrowser ?? false);
  const [allowConcurrent, setAllowConcurrent] = useState(config?.allowConcurrent ?? false);
  const [isDefault, setIsDefault] = useState(config?.isDefault ?? true);
  const [unbuffered, setUnbuffered] = useState(config?.unbuffered ?? true);
  const [interpreters, setInterpreters] = useState<PythonInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<PythonInfo[]>("list_python_interpreters", { projectId: project.id })
      .then(setInterpreters)
      .catch(() => setInterpreters([]));
  }, [project.id]);

  const interpreterOptions = useMemo(() => {
    const map = new Map<string, string>();
    if (config?.executablePath) map.set(config.executablePath, "当前配置");
    s.settings.pythonInterpreters.forEach((p) => map.set(p, "常用解释器"));
    interpreters.forEach((i) => {
      if (!map.has(i.path)) map.set(i.path, i.label);
    });
    return Array.from(map.entries());
  }, [config?.executablePath, interpreters, s.settings.pythonInterpreters]);

  const pickPython = async () => {
    const picked = await openDialog({ title: "选择 Python 解释器", multiple: false, directory: false });
    if (typeof picked === "string") setExecutable(picked);
  };

  const pickFile = async (title: string) => {
    const picked = await openDialog({ title, multiple: false, directory: false, defaultPath: project.rootPath });
    if (typeof picked === "string") {
      const rel = picked.startsWith(project.rootPath)
        ? picked.slice(project.rootPath.length).replace(/^\//, "")
        : picked;
      setEntry(rel);
    }
  };

  const pickDir = async () => {
    const picked = await openDialog({
      title: "选择工作目录",
      multiple: false,
      directory: true,
      defaultPath: project.rootPath,
    });
    if (typeof picked === "string") {
      const rel = picked.startsWith(project.rootPath)
        ? picked.slice(project.rootPath.length).replace(/^\//, "")
        : picked;
      setWorkingDir(rel);
    }
  };

  const save = async () => {
    if (!name.trim()) {
      setError("请填写运行配置名称");
      return;
    }
    setSaving(true);
    setError(null);
    const input: ConfigInput = {
      name: name.trim(),
      runtimeType: runtime,
      executablePath: executable.trim() || null,
      entryPath: entry.trim() || null,
      workingDirectory: workingDir.trim() || null,
      arguments: splitArgs(args),
      envVars: envs.filter((e) => e.key.trim()),
      command: command.trim() || null,
      launchMode: "terminal",
      port: port ? Number(port) : null,
      url: url.trim() || null,
      openBrowser,
      unbuffered,
      isDefault,
      allowConcurrent,
    };
    try {
      await actions.saveConfig(project.id, config?.id ?? null, input);
      ui.toast(config ? "运行配置已更新" : "运行配置已创建", "success");
      ui.closeDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const requiresEntry = runtime !== "custom" && runtime !== "web";
  const entryMissing = requiresEntry && !entry.trim();

  return (
    <Modal
      title={config ? "编辑运行配置" : "新建运行配置"}
      subtitle={project.name}
      width={680}
      onClose={() => ui.closeDialog()}
      footer={
        <>
          {config && (
            <Button
              variant="ghost"
              icon={<Trash2 size={12} />}
              className="mr-auto"
              onClick={async () => {
                const ok = await ui.confirm({
                  title: `删除运行配置「${config.name}」？`,
                  message: "只删除应用内的配置，不会影响项目文件。",
                  confirmText: "删除",
                  danger: true,
                });
                if (!ok) return;
                try {
                  await actions.deleteConfig(project.id, config.id);
                  ui.toast("运行配置已删除", "success");
                  ui.closeDialog();
                } catch (err) {
                  ui.toast(err instanceof Error ? err.message : "删除失败", "error");
                }
              }}
            >
              删除
            </Button>
          )}
          <Button onClick={() => ui.closeDialog()}>取消</Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </>
      }
    >
      <Field label="配置名称">
        <input
          className="input"
          value={name}
          placeholder="例如：开发服务器 / 生成脚本"
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <Field label="运行方式" hint={RUNTIME_HINT[runtime]}>
        <select className="select" value={runtime} onChange={(e) => setRuntime(e.target.value as RuntimeType)}>
          {RUNTIMES.map((r) => (
            <option key={r} value={r}>
              {RUNTIME_LABEL[r]}
            </option>
          ))}
        </select>
      </Field>

      {runtime === "python" && (
        <>
          <Field label="Python 解释器" hint="使用绝对路径运行，不依赖终端当前的 PATH。">
            <div className="path-input-row">
              <select className="select" value={executable} onChange={(e) => setExecutable(e.target.value)}>
                <option value="">自动检测项目环境 / 系统 Python</option>
                {interpreterOptions.map(([path, source]) => (
                  <option key={path} value={path}>
                    {path} · {source}
                  </option>
                ))}
              </select>
              <Button size="sm" onClick={pickPython}>
                手动选择
              </Button>
            </div>
          </Field>
          <Field label="入口文件" hint="相对项目根目录，例如 main.py">
            <div className="path-input-row">
              <input
                className="input is-mono"
                value={entry}
                placeholder="main.py"
                onChange={(e) => setEntry(e.target.value)}
              />
              <Button size="sm" onClick={() => pickFile("选择入口文件")}>
                选择
              </Button>
            </div>
          </Field>
          <div className="switch-row">
            <div>
              <span>无缓冲输出</span>
              <p>添加 -u 参数，让 print 立即显示在终端中。</p>
            </div>
            <Toggle checked={unbuffered} onChange={setUnbuffered} label="无缓冲输出" />
          </div>
        </>
      )}

      {runtime === "html" && (
        <Field label="HTML 文件" hint="使用系统默认浏览器直接打开。">
          <div className="path-input-row">
            <input
              className="input is-mono"
              value={entry}
              placeholder="index.html"
              onChange={(e) => setEntry(e.target.value)}
            />
            <Button size="sm" onClick={() => pickFile("选择 HTML 文件")}>
              选择
            </Button>
          </div>
        </Field>
      )}

      {runtime === "web" && (
        <>
          <Field
            label="启动命令"
            hint="例如 npm run dev / yarn dev / python -m http.server 8000。留空则在端口上托管入口所在目录。"
          >
            <input
              className="input is-mono"
              value={command}
              placeholder="npm run dev"
              onChange={(e) => setCommand(e.target.value)}
            />
          </Field>
          <Field label="静态目录 / 入口（可选）" hint="留空时使用工作目录。">
            <div className="path-input-row">
              <input
                className="input is-mono"
                value={entry}
                placeholder="public 或 index.html"
                onChange={(e) => setEntry(e.target.value)}
              />
              <Button size="sm" onClick={() => pickFile("选择入口文件")}>
                选择
              </Button>
            </div>
          </Field>
          <div className="field-pair">
            <Field label="端口" hint="启动前会检测占用。">
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
              <p>服务启动后 2 秒打开访问地址。</p>
            </div>
            <Toggle checked={openBrowser} onChange={setOpenBrowser} label="自动打开浏览器" />
          </div>
        </>
      )}

      {runtime === "node" && (
        <>
          <Field label="node 可执行文件" hint="留空则自动使用登录 shell 中的 node。">
            <input
              className="input is-mono"
              value={executable}
              placeholder="/opt/homebrew/bin/node"
              onChange={(e) => setExecutable(e.target.value)}
            />
          </Field>
          <Field label="入口文件">
            <div className="path-input-row">
              <input
                className="input is-mono"
                value={entry}
                placeholder="index.js"
                onChange={(e) => setEntry(e.target.value)}
              />
              <Button size="sm" onClick={() => pickFile("选择入口文件")}>
                选择
              </Button>
            </div>
          </Field>
        </>
      )}

      {runtime === "shell" && (
        <Field label="Shell 脚本" hint="使用 /bin/bash 执行。">
          <div className="path-input-row">
            <input
              className="input is-mono"
              value={entry}
              placeholder="scripts/run.sh"
              onChange={(e) => setEntry(e.target.value)}
            />
            <Button size="sm" onClick={() => pickFile("选择脚本文件")}>
              选择
            </Button>
          </div>
        </Field>
      )}

      {runtime === "custom" && (
        <Field label="命令" hint="在 Terminal 中执行的完整命令，请自行确认安全。">
          <input
            className="input is-mono"
            value={command}
            placeholder="python -m pip list"
            onChange={(e) => setCommand(e.target.value)}
          />
        </Field>
      )}

      <Field label="工作目录" hint="留空使用项目根目录；支持相对路径。">
        <div className="path-input-row">
          <input
            className="input is-mono"
            value={workingDir}
            placeholder={project.rootPath}
            onChange={(e) => setWorkingDir(e.target.value)}
          />
          <Button size="sm" icon={<FolderSearch size={12} />} onClick={pickDir}>
            选择
          </Button>
        </div>
      </Field>

      {runtime !== "custom" && runtime !== "web" && runtime !== "html" && (
        <Field label="命令行参数" hint="空格分隔；含空格的参数用引号包裹。不会做 shell 展开。">
          <input
            className="input is-mono"
            value={args}
            placeholder="--input data.csv --verbose"
            onChange={(e) => setArgs(e.target.value)}
          />
        </Field>
      )}

      <div className="env-editor">
        <div className="env-head">
          <span className="field-label">环境变量</span>
          <Button size="sm" variant="ghost" icon={<Plus size={11} />} onClick={() => setEnvs([...envs, { key: "", value: "" }])}>
            添加变量
          </Button>
        </div>
        {envs.length === 0 ? (
          <p className="setting-empty">没有额外环境变量。PATH 会自动使用登录 shell 的配置。</p>
        ) : (
          envs.map((env, i) => (
            <div key={i} className="env-row">
              <input
                className="input is-mono"
                value={env.key}
                placeholder="KEY"
                onChange={(e) => {
                  const next = [...envs];
                  next[i] = { ...next[i], key: e.target.value.toUpperCase().replace(/\s/g, "") };
                  setEnvs(next);
                }}
              />
              <input
                className="input is-mono"
                value={env.value}
                placeholder="value"
                onChange={(e) => {
                  const next = [...envs];
                  next[i] = { ...next[i], value: e.target.value };
                  setEnvs(next);
                }}
              />
              <button className="mini-icon" onClick={() => setEnvs(envs.filter((_, idx) => idx !== i))} title="移除">
                <Trash2 size={12} />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="divider" />

      <div className="switch-row">
        <div>
          <span>设为默认运行配置</span>
          <p>点击项目「运行」时使用的配置。</p>
        </div>
        <Toggle checked={isDefault} onChange={setIsDefault} label="设为默认" />
      </div>
      <div className="switch-row">
        <div>
          <span>允许并发启动</span>
          <p>关闭时，同一配置在运行中不会被重复启动。</p>
        </div>
        <Toggle checked={allowConcurrent} onChange={setAllowConcurrent} label="允许并发启动" />
      </div>

      {entryMissing && (
        <div className="inline-error">
          <AlertTriangle size={13} /> 该运行方式需要入口文件，未填写时运行会失败。
        </div>
      )}
      {error && (
        <div className="inline-error">
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      <p className="form-footnote">
        命令在 Terminal.app 中执行，应用不会自动安装依赖，也不会修改 shell 配置文件。
      </p>
    </Modal>
  );
}
