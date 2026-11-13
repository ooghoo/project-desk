import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { LaunchConfig, Project } from "../types";

export type ToastKind = "info" | "success" | "error";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

export type MenuEntry =
  | {
      type?: "item";
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      onClick?: () => void | Promise<void>;
    }
  | { type: "separator" };

export type DialogState =
  | {
      kind: "confirm";
      title: string;
      message?: string;
      details?: string[];
      confirmText?: string;
      cancelText?: string;
      danger?: boolean;
    }
  | {
      kind: "prompt";
      title: string;
      label?: string;
      value?: string;
      placeholder?: string;
      multiline?: boolean;
      confirmText?: string;
    }
  | { kind: "alert"; title: string; message?: string; details?: string[] }
  | { kind: "add"; paths?: string[] }
  | { kind: "config"; project: Project; config?: LaunchConfig }
  | { kind: "rename"; project: Project }
  | { kind: "tags"; project: Project }
  | { kind: "category"; project: Project }
  | { kind: "relocate"; project: Project }
  | { kind: "newCategory" };

export interface UiApi {
  toast: (text: string, kind?: ToastKind) => void;
  confirm: (opts: {
    title: string;
    message?: string;
    details?: string[];
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
  }) => Promise<boolean>;
  prompt: (opts: {
    title: string;
    label?: string;
    value?: string;
    placeholder?: string;
    multiline?: boolean;
    confirmText?: string;
  }) => Promise<string | null>;
  alert: (opts: { title: string; message?: string; details?: string[] }) => Promise<void>;
  menu: (event: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, items: MenuEntry[]) => void;
  openAdd: (paths?: string[]) => void;
  openConfig: (project: Project, config?: LaunchConfig) => void;
  openRename: (project: Project) => void;
  openTags: (project: Project) => void;
  openCategory: (project: Project) => void;
  openRelocate: (project: Project) => void;
  openNewCategory: () => void;
  dialog: DialogState | null;
  closeDialog: (value?: unknown) => void;
}

const UiContext = createContext<UiApi | null>(null);

export function useUi(): UiApi {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi 必须在 UiProvider 内使用");
  return ctx;
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [menuState, setMenuState] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const resolver = useRef<((value: unknown) => void) | null>(null);
  const toastId = useRef(0);

  const toast = useCallback((text: string, kind: ToastKind = "info") => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev.slice(-3), { id, kind, text }]);
    window.setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      kind === "error" ? 7000 : 3600,
    );
  }, []);

  const closeDialog = useCallback((value?: unknown) => {
    setDialog(null);
    const resolve = resolver.current;
    resolver.current = null;
    if (resolve) resolve(value);
  }, []);

  const confirm = useCallback(
    (opts: {
      title: string;
      message?: string;
      details?: string[];
      confirmText?: string;
      cancelText?: string;
      danger?: boolean;
    }) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve as (v: unknown) => void;
        setDialog({ kind: "confirm", ...opts });
      }),
    [],
  );

  const prompt = useCallback(
    (opts: {
      title: string;
      label?: string;
      value?: string;
      placeholder?: string;
      multiline?: boolean;
      confirmText?: string;
    }) =>
      new Promise<string | null>((resolve) => {
        resolver.current = resolve as (v: unknown) => void;
        setDialog({ kind: "prompt", ...opts });
      }),
    [],
  );

  const alert = useCallback(
    (opts: { title: string; message?: string; details?: string[] }) =>
      new Promise<void>((resolve) => {
        resolver.current = resolve as (v: unknown) => void;
        setDialog({ kind: "alert", ...opts });
      }),
    [],
  );

  const menu = useCallback(
    (
      event: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void },
      items: MenuEntry[],
    ) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (!items.length) return;
      setMenuState({ x: event.clientX, y: event.clientY, items });
    },
    [],
  );

  const api = useMemo<UiApi>(
    () => ({
      toast,
      confirm,
      prompt,
      alert,
      menu,
      openAdd: (paths) => setDialog({ kind: "add", paths }),
      openConfig: (project, config) => setDialog({ kind: "config", project, config }),
      openRename: (project) => setDialog({ kind: "rename", project }),
      openTags: (project) => setDialog({ kind: "tags", project }),
      openCategory: (project) => setDialog({ kind: "category", project }),
      openRelocate: (project) => setDialog({ kind: "relocate", project }),
      openNewCategory: () => setDialog({ kind: "newCategory" }),
      dialog,
      closeDialog,
    }),
    [toast, confirm, prompt, alert, menu, dialog, closeDialog],
  );

  return (
    <UiContext.Provider value={api}>
      {children}
      {createPortal(
        <>
          <ToastStack toasts={toasts} />
          {menuState && (
            <ContextMenu
              x={menuState.x}
              y={menuState.y}
              items={menuState.items}
              onClose={() => setMenuState(null)}
            />
          )}
        </>,
        document.body,
      )}
    </UiContext.Provider>
  );
}

function ToastStack({ toasts }: { toasts: ToastItem[] }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span className="toast-dot" />
          <span className="toast-text">{t.text}</span>
        </div>
      ))}
    </div>
  );
}

function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y, visible: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = Math.min(x, window.innerWidth - rect.width - 8);
    const py = Math.min(y, window.innerHeight - rect.height - 8);
    setPos({ x: Math.max(8, px), y: Math.max(8, py), visible: true });
  }, [x, y]);

  useEffect(() => {
    // 注意：必须用「点击目标是否在菜单内」来判断，不能用 stopPropagation。
    // capture 阶段的 window 监听先于 React 处理函数执行，会把刚按下的菜单项直接卸载，
    // 导致所有菜单项点击无反应（这是之前的 bug）。
    const onPointerDown = (e: PointerEvent) => {
      const el = ref.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: pos.x, top: pos.y, opacity: pos.visible ? 1 : 0 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => {
        if (item.type === "separator") return <div key={`sep-${i}`} className="menu-sep" />;
        return (
          <button
            key={`${item.label}-${i}`}
            className={`menu-item${item.danger ? " is-danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              void item.onClick?.();
            }}
          >
            <span className="menu-icon">{item.icon}</span>
            <span className="menu-label">{item.label}</span>
            {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}
