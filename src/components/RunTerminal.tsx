import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Copy, FolderOpen, Square, Trash2 } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { call } from "../lib/api";
import { actions } from "../lib/store";
import { useUi } from "../lib/ui";
import { runStatusMeta } from "../lib/format";
import { Button, IconButton, Pill, Spinner } from "./primitives";
import type { RunRecord } from "../types";

const LIGHT_THEME = {
  background: "#ffffff",
  foreground: "#1d1d1f",
  cursor: "#0b74ff",
  cursorAccent: "#ffffff",
  selectionBackground: "rgba(11,116,255,0.18)",
  black: "#1d1d1f",
  red: "#d13b32",
  green: "#2f9e5f",
  yellow: "#b47100",
  blue: "#0b74ff",
  magenta: "#a550a8",
  cyan: "#0a8f8f",
  white: "#8c8c92",
  brightBlack: "#66666b",
  brightRed: "#e0574e",
  brightGreen: "#3fb571",
  brightYellow: "#c98721",
  brightBlue: "#3b9bff",
  brightMagenta: "#c06bc4",
  brightCyan: "#19a8a8",
  brightWhite: "#1d1d1f",
};

const DARK_THEME = {
  background: "#1c1c1e",
  foreground: "#f2f2f4",
  cursor: "#3b9bff",
  cursorAccent: "#1c1c1e",
  selectionBackground: "rgba(59,155,255,0.28)",
  black: "#1d1d1f",
  red: "#ff6b60",
  green: "#4ec27e",
  yellow: "#e0a53a",
  blue: "#3b9bff",
  magenta: "#d18bd6",
  cyan: "#4fc3c3",
  white: "#a4a4aa",
  brightBlack: "#7e7e85",
  brightRed: "#ff8579",
  brightGreen: "#6fd79b",
  brightYellow: "#efbd60",
  brightBlue: "#6cb4ff",
  brightMagenta: "#e0a3e4",
  brightCyan: "#6fd6d6",
  brightWhite: "#ffffff",
};

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function useDarkMode(): boolean {
  const [dark, setDark] = useState(
    () => document.documentElement.dataset.theme === "dark",
  );
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.dataset.theme === "dark"),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export function RunTerminal({ run }: { run: RunRecord }) {
  const ui = useUi();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const liveRef = useRef(false);
  const dark = useDarkMode();
  const [loading, setLoading] = useState(true);
  const [shellMissing, setShellMissing] = useState(false);

  const meta = runStatusMeta(run);
  const live = ["requested", "started", "running"].includes(run.status);
  liveRef.current = live;

  /* 创建终端 */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontSize: 12,
      lineHeight: 1.35,
      fontFamily: '"SF Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      cursorBlink: true,
      scrollback: 8000,
      theme: document.documentElement.dataset.theme === "dark" ? DARK_THEME : LIGHT_THEME,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      /* 容器刚挂载时尺寸为 0 */
    }
    termRef.current = term;
    fitRef.current = fit;

    // 实时输出：先挂监听并缓冲，回放结束后再按顺序写入，避免丢首屏
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    let replayed = false;
    const pending: Uint8Array[] = [];
    listen<{ runId: string; data: string }>("run://output", (event) => {
      if (event.payload.runId !== run.id) return;
      const bytes = base64ToBytes(event.payload.data);
      if (replayed) term.write(bytes);
      else pending.push(bytes);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    // 键盘输入 → pty
    const dataSub = term.onData((data) => {
      if (!liveRef.current) return;
      call("run_input", { runId: run.id, data }).catch(() => {});
    });

    // 回放历史输出
    call<string>("read_run_log", { runId: run.id, maxBytes: 240_000 })
      .then((text) => {
        if (text) term.write(text.replace(/\r?\n/g, "\r\n"));
      })
      .catch(() => setShellMissing(true))
      .finally(() => {
        replayed = true;
        pending.forEach((bytes) => term.write(bytes));
        pending.length = 0;
        setLoading(false);
      });

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        if (liveRef.current) {
          call("resize_pty", { runId: run.id, cols: term.cols, rows: term.rows }).catch(() => {});
        }
      } catch {
        /* 忽略尺寸抖动 */
      }
    });
    observer.observe(host);

    return () => {
      disposed = true;
      dataSub.dispose();
      observer.disconnect();
      unlisten?.();
      term.dispose();
      termRef.current = null;
    };
  }, [run.id]);

  /* 主题切换 */
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = dark ? DARK_THEME : LIGHT_THEME;
    }
  }, [dark]);

  const clear = useCallback(() => termRef.current?.clear(), []);

  const copyAll = useCallback(async () => {
    const term = termRef.current;
    if (!term) return;
    const buffer = term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i += 1) {
      const line = buffer.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }
    const text = lines.join("\n").trim();
    if (!text) {
      ui.toast("终端还没有输出", "info");
      return;
    }
    try {
      await call("copy_text", { text });
      ui.toast("终端内容已复制", "success");
    } catch (err) {
      ui.toast(err instanceof Error ? err.message : "复制失败", "error");
    }
  }, [ui]);

  return (
    <div className="terminal-pane">
      <div className="terminal-bar">
        <span className={`status-dot tone-${meta.tone}`} />
        <span className="terminal-title">{run.configName ?? "运行任务"}</span>
        <Pill tone={meta.tone}>{meta.label}</Pill>
        {live && <span className="terminal-live">输出实时写入下方终端，可直接输入</span>}
        {!live && run.exitCode !== null && (
          <span className="meta-dim">退出码 {run.exitCode}</span>
        )}
        <div className="terminal-actions">
          {live && (
            <Button
              size="sm"
              icon={<Square size={10} fill="currentColor" />}
              onClick={async () => {
                try {
                  await actions.stopRun(run.id);
                  ui.toast("任务已停止", "success");
                } catch (err) {
                  ui.toast(err instanceof Error ? err.message : "停止失败", "error");
                }
              }}
            >
              停止
            </Button>
          )}
          <Button size="sm" icon={<Copy size={11} />} onClick={copyAll}>
            复制
          </Button>
          <IconButton label="清屏" onClick={clear}>
            <Trash2 size={13} />
          </IconButton>
          <IconButton
            label="打开任务目录"
            onClick={async () => {
              try {
                await call("open_run_folder", { runId: run.id });
              } catch (err) {
                ui.toast(err instanceof Error ? err.message : "打开失败", "error");
              }
            }}
          >
            <FolderOpen size={14} />
          </IconButton>
        </div>
      </div>

      <div className="terminal-body">
        <div className="terminal-host" ref={hostRef} />
        {loading && (
          <div className="terminal-loading">
            <Spinner /> 正在载入输出…
          </div>
        )}
        {shellMissing && !loading && (
          <div className="terminal-hint">这次运行没有产生输出（例如直接打开浏览器的任务）。</div>
        )}
      </div>
    </div>
  );
}
