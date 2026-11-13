import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  File as FileIcon,
  FileCode2,
  FileJson2,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  RefreshCw,
  FolderSearch,
} from "lucide-react";
import { call } from "../lib/api";
import { copyPath } from "../lib/projectActions";
import { useUi } from "../lib/ui";
import { formatSize } from "../lib/format";
import { IconButton, Spinner } from "./primitives";
import type { FileEntry } from "../types";

function fileIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) return <FileJson2 size={13} />;
  if (/\.(png|jpe?g|gif|svg|webp|icns|avif)$/.test(lower)) return <ImageIcon size={13} />;
  if (/\.(md|txt|log|ya?ml|toml|ini|cfg)$/.test(lower)) return <FileText size={13} />;
  if (/\.(ts|tsx|js|jsx|py|sh|css|html|rs|go|java|rb|php|vue|svelte)$/.test(lower))
    return <FileCode2 size={13} />;
  return <FileIcon size={13} />;
}

export function FileTree({ rootPath, projectName }: { rootPath: string; projectName: string }) {
  const ui = useUi();
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set([rootPath]));
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showHidden, setShowHidden] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async (path: string) => {
    setLoading((prev) => new Set(prev).add(path));
    try {
      const entries = await call<FileEntry[]>("read_directory", { path });
      setChildren((prev) => ({ ...prev, [path]: entries }));
      setErrors((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [path]: err instanceof Error ? err.message : "读取失败",
      }));
    } finally {
      setLoading((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    setChildren({});
    setExpanded(new Set([rootPath]));
    setErrors({});
    setSelected(null);
    void load(rootPath);
  }, [rootPath, load]);

  // 单击展开；双击时第二次点击不再反向收起（否则双击等于没反应）
  const lastToggle = useRef<{ path: string; at: number }>({ path: "", at: 0 });

  const toggle = async (entry: FileEntry) => {
    const path = entry.path;
    const now = Date.now();
    if (lastToggle.current.path === path && now - lastToggle.current.at < 260) return;
    lastToggle.current = { path, at: now };
    if (expanded.has(path)) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
      return;
    }
    setExpanded((prev) => new Set(prev).add(path));
    if (!children[path]) await load(path);
  };

  const refresh = async () => {
    const targets = [rootPath, ...expanded];
    await Promise.all(targets.map((p) => load(p)));
  };

  const visible = (entries: FileEntry[] | undefined) =>
    (entries ?? []).filter((e) => showHidden || !e.name.startsWith("."));

  const rows = useMemo(() => {
    const out: { entry: FileEntry; depth: number }[] = [];
    const walk = (path: string, depth: number) => {
      for (const entry of visible(children[path])) {
        out.push({ entry, depth });
        if (entry.isDir && expanded.has(entry.path)) {
          walk(entry.path, depth + 1);
        }
      }
    };
    walk(rootPath, 0);
    return out;
  }, [children, expanded, rootPath, showHidden]);

  const rowMenu = (e: React.MouseEvent, entry: FileEntry) => {
    ui.menu(e, [
      { label: "复制路径", icon: <Copy size={13} />, onClick: () => copyPath(ui, entry.path) },
      {
        label: "在 Finder 中显示",
        icon: <FolderSearch size={13} />,
        onClick: async () => {
          try {
            await call("open_path", { path: entry.path, reveal: true });
          } catch (err) {
            ui.toast(err instanceof Error ? err.message : "打开失败", "error");
          }
        },
      },
      {
        label: "用默认应用打开",
        icon: <ExternalLink size={13} />,
        disabled: entry.isDir,
        onClick: async () => {
          try {
            await call("open_path", { path: entry.path, reveal: false });
          } catch (err) {
            ui.toast(err instanceof Error ? err.message : "打开失败", "error");
          }
        },
      },
    ]);
  };

  const openEntry = async (entry: FileEntry) => {
    if (entry.isDir) {
      await toggle(entry);
      return;
    }
    try {
      await call("open_path", { path: entry.path, reveal: false });
    } catch (err) {
      ui.toast(err instanceof Error ? err.message : "打开失败", "error");
    }
  };

  const rootLoading = loading.has(rootPath) && !children[rootPath];

  return (
    <div className="file-tree">
      <div className="tree-toolbar">
        <span className="tree-root" title={rootPath}>
          <FolderOpen size={13} /> {projectName}
        </span>
        <div className="tree-tools">
          <IconButton
            label={showHidden ? "隐藏隐藏文件" : "显示隐藏文件"}
            onClick={() => setShowHidden((v) => !v)}
            active={showHidden}
          >
            {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
          </IconButton>
          <IconButton label="刷新" onClick={refresh}>
            <RefreshCw size={13} />
          </IconButton>
        </div>
      </div>

      {rootLoading ? (
        <div className="tree-loading">
          <Spinner /> 正在读取目录…
        </div>
      ) : errors[rootPath] ? (
        <div className="tree-error">
          <AlertCircle size={14} /> {errors[rootPath]}
        </div>
      ) : rows.length === 0 ? (
        <div className="tree-empty">该目录为空</div>
      ) : (
        <div className="tree-rows" role="tree">
          {rows.map(({ entry, depth }) => {
            const isOpen = expanded.has(entry.path);
            const isLoading = loading.has(entry.path);
            return (
              <div
                key={entry.path}
                role="treeitem"
                aria-expanded={entry.isDir ? isOpen : undefined}
                className={`tree-row${selected === entry.path ? " is-selected" : ""}`}
                style={{ paddingLeft: 8 + depth * 14 }}
                onClick={() => {
                  setSelected(entry.path);
                  if (entry.isDir) void toggle(entry);
                }}
                onDoubleClick={() => {
                  if (!entry.isDir) void openEntry(entry);
                }}
                onContextMenu={(e) => rowMenu(e, entry)}
                title={entry.path}
              >
                <span className="tree-caret">
                  {entry.isDir ? (
                    isLoading ? (
                      <Spinner size={10} />
                    ) : isOpen ? (
                      <ChevronDown size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    )
                  ) : null}
                </span>
                <span className={`tree-icon${entry.isDir ? " is-dir" : ""}`}>
                  {entry.isDir ? <Folder size={13} /> : fileIcon(entry.name)}
                </span>
                <span className="tree-name">{entry.name}</span>
                {entry.isSymlink && <span className="tree-link">链接</span>}
                {!entry.isDir && <span className="tree-size">{formatSize(entry.size)}</span>}
                {errors[entry.path] && (
                  <span className="tree-row-error" title={errors[entry.path]}>
                    <AlertCircle size={11} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="tree-footnote">
        文件树仅用于浏览与打开，不会修改、重命名或删除任何源文件。
      </p>
    </div>
  );
}
