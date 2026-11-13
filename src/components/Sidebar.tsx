import type { ReactNode } from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Clock,
  Folder,
  LayoutGrid,
  Plus,
  Settings2,
  Star,
  Trash2,
  PencilLine,
} from "lucide-react";
import { actions, activeRuns, keyToNav, useAppState, type Nav } from "../lib/store";
import { useUi } from "../lib/ui";

function NavRow({
  icon,
  label,
  count,
  active,
  onClick,
  onContextMenu,
  live,
  dropCategory,
}: {
  icon: ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  live?: boolean;
  dropCategory?: string;
}) {
  return (
    <button
      className={`nav-row${active ? " is-active" : ""}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      data-drop-category={dropCategory}
      type="button"
    >
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
      {live && <span className="nav-live" />}
      {typeof count === "number" && count > 0 && <span className="nav-count">{count}</span>}
    </button>
  );
}

export function Sidebar() {
  const s = useAppState();
  const ui = useUi();
  const runningCount = activeRuns(s.runs).length;
  const groupCollapsed = s.settings.collapsedCategories.includes("group");
  const favorites = s.projects.filter((p) => p.isFavorite).length;
  const recentCount = s.projects.filter((p) => p.lastOpenedAt || p.lastRunAt).length;
  const uncategorized = s.projects.filter((p) => !p.categoryId).length;

  const go = (nav: Nav) => actions.setNav(nav);
  const isActive = (nav: Nav) =>
    s.nav.kind === nav.kind &&
    (nav.kind !== "category" || (s.nav.categoryId ?? null) === (nav.categoryId ?? null));

  const toggleGroup = () => {
    const next = groupCollapsed
      ? s.settings.collapsedCategories.filter((k) => k !== "group")
      : [...s.settings.collapsedCategories, "group"];
    actions.persistSettings({ collapsedCategories: next });
  };

  const categoryMenu = (categoryId: string, name: string, count: number) =>
    (e: React.MouseEvent) => {
      ui.menu(e, [
        {
          label: "重命名分类",
          icon: <PencilLine size={13} />,
          onClick: async () => {
            const next = await ui.prompt({ title: "重命名分类", label: "分类名称", value: name });
            if (!next || next.trim() === name) return;
            try {
              await actions.renameCategory(categoryId, next.trim());
            } catch (err) {
              ui.toast(err instanceof Error ? err.message : "重命名失败", "error");
            }
          },
        },
        { type: "separator" },
        {
          label: "删除分类",
          icon: <Trash2 size={13} />,
          danger: true,
          onClick: async () => {
            const ok = await ui.confirm({
              title: `删除分类「${name}」？`,
              message:
                count > 0
                  ? `分类内${count} 个项目不会被删除，只会回到「未分类」。`
                  : "分类内的项目不会被删除，只会回到「未分类」。",
              confirmText: "删除分类",
              danger: true,
            });
            if (!ok) return;
            try {
              await actions.deleteCategory(categoryId);
              ui.toast("分类已删除", "success");
            } catch (err) {
              ui.toast(err instanceof Error ? err.message : "删除失败", "error");
            }
          },
        },
      ]);
    };

  return (
    <aside className="sidebar" style={{ width: s.settings.sidebarWidth }}>
      <div className="sidebar-drag" data-drag-window />
      <div className="sidebar-scroll">
        <div className="nav-group">
          <div className="nav-group-title">工作台</div>
          <NavRow
            icon={<LayoutGrid size={15} />}
            label="所有项目"
            count={s.projects.length}
            active={s.nav.kind === "all"}
            onClick={() => go({ kind: "all" })}
          />
          <NavRow
            icon={<Clock size={15} />}
            label="最近使用"
            count={recentCount}
            active={s.nav.kind === "recent"}
            onClick={() => go({ kind: "recent" })}
          />
          <NavRow
            icon={<Star size={15} />}
            label="收藏项目"
            count={favorites}
            active={s.nav.kind === "favorite"}
            onClick={() => go({ kind: "favorite" })}
          />
          <NavRow
            icon={<Activity size={15} />}
            label="正在运行"
            count={runningCount}
            live={runningCount > 0}
            active={s.nav.kind === "running"}
            onClick={() => go({ kind: "running" })}
          />
        </div>

        <div className="nav-group">
          <div className="nav-group-title is-row">
            <button className="nav-group-toggle" onClick={toggleGroup} type="button">
              {groupCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              项目分类
            </button>
            <button
              className="nav-group-add"
              title="新建分类"
              onClick={() => ui.openNewCategory()}
              type="button"
            >
              <Plus size={13} />
            </button>
          </div>
          {!groupCollapsed && (
            <>
              {s.categories.map((cat) => (
                <NavRow
                  key={cat.id}
                  icon={<Folder size={15} />}
                  label={cat.name}
                  count={cat.projectCount}
                  active={isActive({ kind: "category", categoryId: cat.id })}
                  onClick={() => go({ kind: "category", categoryId: cat.id })}
                  onContextMenu={categoryMenu(cat.id, cat.name, cat.projectCount)}
                  dropCategory={cat.id}
                />
              ))}
              {uncategorized > 0 && (
                <NavRow
                  icon={<Folder size={15} />}
                  label="未分类"
                  count={uncategorized}
                  active={isActive({ kind: "category", categoryId: null })}
                  onClick={() => go({ kind: "category", categoryId: null })}
                  dropCategory="__none__"
                />
              )}
            </>
          )}
        </div>
      </div>

      <div className="sidebar-foot">
        <NavRow
          icon={<Settings2 size={15} />}
          label="设置"
          active={s.nav.kind === "settings"}
          onClick={() => go({ kind: "settings" })}
        />
      </div>
    </aside>
  );
}

export function initialNavFromSettings(lastNav: string): Nav {
  return keyToNav(lastNav);
}
