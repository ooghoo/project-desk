import {
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  Check,
  ChevronDown,
  LayoutGrid,
  List,
  PanelRight,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { actions, useAppState, visibleProjects } from "../lib/store";
import { TYPE_LABEL } from "../lib/format";
import { useUi } from "../lib/ui";
import { IconButton } from "./primitives";
import type { ProjectType } from "../types";

const TYPE_OPTIONS: (ProjectType | null)[] = [null, "web", "python", "node", "shell", "other"];

export function TopBar() {
  const s = useAppState();
  const ui = useUi();
  const inputRef = useRef<HTMLInputElement>(null);
  const count = visibleProjects(s).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        ui.openAdd();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ui]);

  const openTypeMenu = (e: React.MouseEvent) => {
    ui.menu(
      e,
      TYPE_OPTIONS.map((t) => ({
        label: t ? TYPE_LABEL[t] : "全部类型",
        icon: s.typeFilter === t ? <Check size={13} /> : <span style={{ width: 13 }} />,
        onClick: () => actions.setTypeFilter(t),
      })),
    );
  };

  const openSortMenu = (e: React.MouseEvent) => {
    const item = (key: "recent" | "name" | "created" | "manual", label: string) => ({
      label,
      icon: s.settings.sort === key ? <Check size={13} /> : <span style={{ width: 13 }} />,
      onClick: () => actions.setSort(key),
    });
    ui.menu(e, [
      item("recent", "最近使用"),
      item("name", "名称"),
      item("created", "创建时间"),
      item("manual", "手动排序"),
      { type: "separator" },
      {
        label: s.settings.sortDirection === "desc" ? "改为升序" : "改为降序",
        icon:
          s.settings.sortDirection === "desc" ? (
            <ArrowUpWideNarrow size={13} />
          ) : (
            <ArrowDownWideNarrow size={13} />
          ),
        onClick: () =>
          actions.setSort(s.settings.sort, s.settings.sortDirection === "desc" ? "asc" : "desc"),
      },
    ]);
  };

  return (
    <header className="topbar" data-drag-window>
      <div className="topbar-drag" data-drag-window aria-hidden />
      <div className="search-box">
        <Search size={14} className="search-icon" />
        <input
          ref={inputRef}
          value={s.query}
          spellCheck={false}
          placeholder="搜索项目、路径或标签"
          onChange={(e) => actions.setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              actions.setQuery("");
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {s.query ? (
          <button className="search-clear" onClick={() => actions.setQuery("")} title="清除搜索">
            <X size={12} />
          </button>
        ) : (
          <span className="search-kbd">⌘K</span>
        )}
      </div>

      <div className="topbar-spacer" data-drag-window />

      <button className={`tool-btn${s.typeFilter ? " is-active" : ""}`} onClick={openTypeMenu}>
        <SlidersHorizontal size={14} />
        <span>{s.typeFilter ? TYPE_LABEL[s.typeFilter] : "类型"}</span>
        <ChevronDown size={11} className="tool-caret" />
      </button>

      <button className="tool-btn" onClick={openSortMenu}>
        {s.settings.sortDirection === "desc" ? (
          <ArrowDownWideNarrow size={14} />
        ) : (
          <ArrowUpWideNarrow size={14} />
        )}
        <span>
          {s.settings.sort === "recent"
            ? "最近使用"
            : s.settings.sort === "name"
              ? "名称"
              : s.settings.sort === "manual"
                ? "手动排序"
                : "创建时间"}
        </span>
        <ChevronDown size={11} className="tool-caret" />
      </button>

      <div className="view-switch">
        <button
          className={s.settings.view === "list" ? "is-active" : ""}
          onClick={() => actions.setView("list")}
          title="列表视图"
        >
          <List size={14} />
        </button>
        <button
          className={s.settings.view === "grid" ? "is-active" : ""}
          onClick={() => actions.setView("grid")}
          title="网格视图"
        >
          <LayoutGrid size={14} />
        </button>
      </div>

      <IconButton
        label={s.detailVisible ? "隐藏详情面板" : "显示详情面板"}
        active={s.detailVisible}
        onClick={() => actions.toggleDetail()}
      >
        <PanelRight size={15} />
      </IconButton>

      <button className="btn btn-primary btn-md add-btn" onClick={() => ui.openAdd()}>
        <Plus size={14} />
        <span>添加项目</span>
      </button>

      {s.nav.kind !== "settings" && count > 0 && <span className="sr-only">{count} 个项目</span>}
    </header>
  );
}
