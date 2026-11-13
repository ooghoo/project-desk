import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { X } from "lucide-react";

/* ------------------------------------------------------------------ */
/* 按钮                                                               */
/* ------------------------------------------------------------------ */

type ButtonVariant = "primary" | "default" | "ghost" | "danger";

export function Button({
  variant = "default",
  size = "md",
  icon,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon?: ReactNode;
}) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} {...rest}>
      {icon && <span className="btn-icon">{icon}</span>}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  active,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      className={`icon-btn${active ? " is-active" : ""} ${className}`}
      title={label}
      aria-label={label}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* 弹窗                                                               */
/* ------------------------------------------------------------------ */

export function Modal({
  title,
  subtitle,
  children,
  footer,
  onClose,
  width = 520,
  scrollable = true,
  dismissOnBackdrop = true,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  width?: number;
  scrollable?: boolean;
  /** 点击灰色蒙版是否关闭。表单类弹窗可设为 false，避免误触丢失已填内容。 */
  dismissOnBackdrop?: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  // 记录按下蒙版的起点：只有"按下并松开都在蒙版上"才算点击，
  // 避免从弹窗内部拖出（选中文本、拖拽）松手时误关弹窗。
  const backdropDown = useRef<{ x: number; y: number } | null>(null);
  // 拖放结束时系统可能补发一次 pointerdown，若弹窗是这次拖放刚打开的，
  // 会被背板误判为"点击外部"而瞬间关闭。刚打开的 400ms 内忽略蒙版点击。
  const openedAt = useRef(Date.now());

  /* 顶部拖动：像窗口一样把弹窗挪开，避免挡住背后的内容 */
  const modalRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    baseLeft: number;
    baseTop: number;
    w: number;
    h: number;
  } | null>(null);

  const clampAxis = (value: number, min: number, max: number) =>
    min > max ? min : Math.min(max, Math.max(min, value));

  const onHeadDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, input, textarea, select, a")) return;
    const el = modalRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      ox: offset.x,
      oy: offset.y,
      baseLeft: rect.left - offset.x,
      baseTop: rect.top - offset.y,
      w: rect.width,
      h: rect.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add("is-moving-modal");
    e.preventDefault();
  };

  const onHeadMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const minX = 8 - d.baseLeft;
    const maxX = window.innerWidth - 8 - (d.baseLeft + d.w);
    const minY = 8 - d.baseTop;
    const maxY = window.innerHeight - 8 - (d.baseTop + d.h);
    setOffset({
      x: clampAxis(d.ox + e.clientX - d.sx, minX, maxX),
      y: clampAxis(d.oy + e.clientY - d.sy, minY, maxY),
    });
  };

  const endHeadDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    document.body.classList.remove("is-moving-modal");
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // 窗口尺寸变化时回到居中，避免弹窗被留在屏幕外
  useEffect(() => {
    const onResize = () => setOffset({ x: 0, y: 0 });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const first = bodyRef.current?.querySelector<HTMLElement>(
      "input:not([type=hidden]), textarea, select",
    );
    first?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        // 蒙版挡住了顶部栏：在窗口拖动热区按下时，仍然拖动窗口而不是关闭弹窗
        if (e.button === 0) {
          const surfaces = Array.from(
            document.querySelectorAll<HTMLElement>("[data-drag-window]"),
          );
          const onDragSurface = surfaces.some((el) => {
            const rect = el.getBoundingClientRect();
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              e.clientX >= rect.left &&
              e.clientX <= rect.right &&
              e.clientY >= rect.top &&
              e.clientY <= rect.bottom
            );
          });
          if (onDragSurface) {
            e.preventDefault();
            backdropDown.current = null;
            getCurrentWindow()
              .startDragging()
              .catch(() => {});
            return;
          }
        }
        if (!dismissOnBackdrop) return;
        // 只记录按下位置，是否关闭在 pointerup 时判定
        backdropDown.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        if (!dismissOnBackdrop) return;
        const start = backdropDown.current;
        backdropDown.current = null;
        if (!start) return;
        // 拖动过就不算点击（用于选中文本后拖出弹窗的场景）
        if (Math.abs(e.clientX - start.x) > 3 || Math.abs(e.clientY - start.y) > 3) return;
        if (Date.now() - openedAt.current < 400) return;
        // 仅左键，普通点击蒙版才关闭
        if (e.button !== 0) return;
        onClose();
      }}
    >
      <div
        className="modal"
        ref={modalRef}
        style={{ width, transform: `translate(${offset.x}px, ${offset.y}px)` }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        <header
          className="modal-head"
          onPointerDown={onHeadDown}
          onPointerMove={onHeadMove}
          onPointerUp={endHeadDrag}
          onPointerCancel={endHeadDrag}
          onDoubleClick={() => setOffset({ x: 0, y: 0 })}
        >
          <div className="modal-head-text">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </header>
        <div className={`modal-body${scrollable ? " is-scroll" : ""}`} ref={bodyRef}>
          {children}
        </div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* 表单控件                                                            */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  children,
  inline = false,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  inline?: boolean;
}) {
  return (
    <label className={`field${inline ? " is-inline" : ""}`}>
      <span className="field-label">{label}</span>
      <span className="field-control">{children}</span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`toggle${checked ? " is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className={`segmented segmented-${size}`} role="tablist">
      {options.map((opt) => (
        <button
          key={opt.value}
          role="tab"
          aria-selected={value === opt.value}
          title={opt.title}
          className={value === opt.value ? "is-active" : ""}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Pill({
  tone = "neutral",
  children,
  dot,
}: {
  tone?: "neutral" | "live" | "ok" | "warn" | "fail" | "accent" | "idle";
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span className={`pill pill-${tone}`}>
      {dot && <span className="pill-dot" />}
      {children}
    </span>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="加载中" />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Callout({
  tone = "warn",
  icon,
  title,
  children,
  action,
}: {
  tone?: "warn" | "danger" | "info";
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`callout callout-${tone}`}>
      {icon && <span className="callout-icon">{icon}</span>}
      <div className="callout-body">
        <strong>{title}</strong>
        {children && <div className="callout-text">{children}</div>}
      </div>
      {action && <div className="callout-action">{action}</div>}
    </div>
  );
}
