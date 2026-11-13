import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { AlertCircle, FolderDown, Loader2 } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { ProjectList } from "./components/ProjectList";
import { DetailPanel } from "./components/DetailPanel";
import { RunsView } from "./components/RunsView";
import { Settings } from "./components/Settings";
import { DialogHost } from "./dialogs/Dialogs";
import { actions, getState, useAppState } from "./lib/store";
import { useUi } from "./lib/ui";
import { call } from "./lib/api";
import type { DropItem } from "./types";

/** 诊断日志：写到数据目录 debug.log，出问题时可直接查看 */
function debugLog(text: string) {
  call("debug_log", { text }).catch(() => {});
}

export default function App() {
  const s = useAppState();
  const ui = useUi();
  const [dragOver, setDragOver] = useState(0);
  const initialized = useRef(false);

  /* 初始化 */
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void actions.init();
  }, []);

  /* 主题 */
  useEffect(() => {
    const apply = () => {
      const pref = s.settings.theme;
      const dark =
        pref === "dark" ||
        (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => apply();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [s.settings.theme]);

  /* 运行状态轮询：只有存在活动任务或停留在"正在运行"时才刷新 */
  useEffect(() => {
    const timer = window.setInterval(() => {
      void actions.tick();
    }, 2500);
    const onFocus = () => void actions.tick();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  /* 系统级拖拽文件夹添加 */
  useEffect(() => {
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    let lastDropAt = 0;

    const handleDrop = async (paths: string[], source: string) => {
      // 原生事件与兜底监听可能同时触发，800ms 内只处理一次
      const now = Date.now();
      if (now - lastDropAt < 800) return;
      lastDropAt = now;
      debugLog(`drop(${source}) paths=${paths.join(" | ") || "(空)"}`);
      if (!paths.length) {
        ui.toast("没有读取到文件夹路径，请直接拖入 Finder 中的文件夹", "error");
        return;
      }
      try {
        const items = await call<DropItem[]>("inspect_drop_paths", { pathsIn: paths });
        const dirs = items.filter((i) => i.isDir && i.exists).map((i) => i.path);
        if (!dirs.length) {
          ui.toast("只能添加文件夹，请拖入项目目录", "error");
          return;
        }
        // 延后一拍：拖放结束的合成事件先处理完，避免刚弹出的确认页被立即关掉
        window.setTimeout(() => ui.openAdd(dirs), 60);
      } catch (err) {
        debugLog(`drop-error ${err instanceof Error ? err.message : String(err)}`);
        ui.toast(err instanceof Error ? err.message : "无法读取拖入的文件夹", "error");
      }
    };

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          if (payload.type === "enter") {
            debugLog(`drag-enter ${(payload.paths ?? []).join(" | ")}`);
          }
          setDragOver((n) => (n === 0 ? 1 : n));
          return;
        }
        if (payload.type === "leave") {
          setDragOver(0);
          return;
        }
        if (payload.type === "drop") {
          setDragOver(0);
          void handleDrop(payload.paths ?? [], "native");
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisteners.push(fn);
      })
      .catch((err) => {
        debugLog(`drag-listen-error ${err instanceof Error ? err.message : String(err)}`);
        ui.toast("拖拽监听注册失败，请用「添加项目」按钮选择文件夹", "error");
      });

    // 兜底：直接监听 Tauri 的原生拖放事件
    listen<{ paths?: string[] }>("tauri://drag-drop", (event) => {
      void handleDrop(event.payload?.paths ?? [], "raw");
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisteners.push(fn);
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [ui]);

  /* 自定义标题栏：显式处理拖动窗口 / 双击缩放 */
  useEffect(() => {
    const isInteractive = (el: Element | null) =>
      !!el?.closest("button, input, textarea, select, a, [role='button'], [data-no-drag]");

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.("[data-drag-window]")) return;
      if (isInteractive(target)) return;
      e.preventDefault();
      getCurrentWindow()
        .startDragging()
        .catch((err) => debugLog(`startDragging-error ${err instanceof Error ? err.message : String(err)}`));
    };

    const onDoubleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.("[data-drag-window]")) return;
      if (isInteractive(target)) return;
      getCurrentWindow()
        .toggleMaximize()
        .catch((err) => debugLog(`toggleMaximize-error ${err instanceof Error ? err.message : String(err)}`));
    };

    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("dblclick", onDoubleClick, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("dblclick", onDoubleClick, true);
    };
  }, []);

  /* 诊断：记录弹窗切换（排查拖放后确认页是否被异常关闭） */
  useEffect(() => {
    debugLog(`dialog=${ui.dialog?.kind ?? "none"}`);
  }, [ui.dialog]);

  /* 任务结束时同步状态（退出码 / 结束时间 / 清空 pty 会话） */
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let disposed = false;
    listen<{ runId: string; exitCode: number | null }>("run://exit", () => {
      void actions.refreshRuns();
      const pid = getState().selectedProjectId;
      if (pid) void actions.loadProjectDetail(pid);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisteners.push(fn);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  /* 菜单栏事件（中文菜单 → 前端） */
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let disposed = false;
    const push = (p: Promise<UnlistenFn>) =>
      p.then((fn) => {
        if (disposed) fn();
        else unlisteners.push(fn);
      }).catch(() => {});

    push(listen("menu://settings", () => actions.setNav({ kind: "settings" })));
    push(
      listen("menu://about", () => {
        const st = getState();
        void ui.alert({
          title: "项目台",
          message: `版本 ${st.appVersion || "0.1.0"} · 本地项目管理与脚本启动器`,
          details: [
            "项目文件始终保留在原始位置，应用只保存引用与运行配置。",
            `数据目录：${st.dataDir}`,
            "脚本通过 macOS Terminal.app 执行，不内置终端模拟器。",
          ],
        });
      }),
    );

    return () => {
      disposed = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [ui]);

  const beginResize = useCallback(
    (kind: "sidebar" | "list", e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const start = kind === "sidebar" ? getState().settings.sidebarWidth : getState().settings.listWidth;
      document.body.classList.add("is-resizing");
      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startX;
        if (kind === "sidebar") {
          const width = Math.min(360, Math.max(184, start + delta));
          actions.updateLocalSettings({ sidebarWidth: width });
        } else {
          const max = Math.max(280, window.innerWidth - getState().settings.sidebarWidth - 420);
          const width = Math.min(max, Math.max(272, start + delta));
          actions.updateLocalSettings({ listWidth: width });
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.classList.remove("is-resizing");
        const cur = getState().settings;
        actions.persistSettings({
          sidebarWidth: cur.sidebarWidth,
          listWidth: cur.listWidth,
        });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [],
  );

  const resetSidebar = () => actions.persistSettings({ sidebarWidth: 236 });
  const resetList = () => actions.persistSettings({ listWidth: 348 });

  if (!s.ready) {
    return (
      <div className="boot-screen">
        <Loader2 className="boot-spin" size={22} />
        <span>正在打开工作台…</span>
      </div>
    );
  }

  if (s.bootError) {
    return (
      <div className="boot-screen is-error">
        <AlertCircle size={22} />
        <strong>工作台无法启动</strong>
        <p>{s.bootError}</p>
        <p className="boot-hint">请检查数据目录权限，或重新启动应用。</p>
      </div>
    );
  }

  const settingsMode = s.nav.kind === "settings";

  return (
    <div className="app">
      <Sidebar />
      <div
        className="splitter"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={(e) => beginResize("sidebar", e)}
        onDoubleClick={resetSidebar}
        title="拖动调整宽度（双击复位）"
      />

      <main className="workspace">
        <TopBar />
        <div className="workspace-body">
          {settingsMode ? (
            <Settings />
          ) : s.nav.kind === "running" ? (
            <RunsView />
          ) : (
            <>
              <ProjectList />
              {s.detailVisible && (
                <>
                  <div
                    className="splitter is-inner"
                    role="separator"
                    aria-orientation="vertical"
                    onPointerDown={(e) => beginResize("list", e)}
                    onDoubleClick={resetList}
                    title="拖动调整宽度（双击复位）"
                  />
                  <DetailPanel />
                </>
              )}
            </>
          )}
        </div>
      </main>

      {dragOver > 0 && (
        <div className="drop-overlay">
          <div className="drop-overlay-inner">
            <FolderDown size={14} />
            <strong>松开以添加项目</strong>
          </div>
        </div>
      )}

      <DialogHost />
    </div>
  );
}
