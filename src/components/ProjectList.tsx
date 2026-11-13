import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, FolderPlus, Play, SearchX, Star, X } from "lucide-react";
import { actions, activeRuns, navTitle, useAppState, visibleProjects } from "../lib/store";
import { useUi } from "../lib/ui";
import { TYPE_LABEL, prettyPath, relativeTime, runStatusMeta } from "../lib/format";
import { ProjectIcon } from "./ProjectIcon";
import { Button, EmptyState } from "./primitives";
import { projectMenuItems, runProject } from "../lib/projectActions";
import type { Project } from "../types";

export function ProjectList() {
  const s = useAppState();
  const ui = useUi();
  const list = visibleProjects(s);
  const runningMap = new Map(activeRuns(s.runs).map((r) => [r.projectId, r]));

  const onDropCategory = useCallback(
    async (projectId: string, categoryId: string | null) => {
      const project = s.projects.find((p) => p.id === projectId);
      if (!project || (project.categoryId ?? null) === categoryId) return;
      try {
        await actions.setCategory(projectId, categoryId);
        const target = categoryId
          ? s.categories.find((c) => c.id === categoryId)?.name ?? "分类"
          : "未分类";
        ui.toast(`「${project.name}」已移动到「${target}」`, "success");
      } catch (err) {
        ui.toast(err instanceof Error ? err.message : "移动失败", "error");
      }
    },
    [s.projects, s.categories, ui],
  );

  const { ghost, startDrag, shouldSuppressClick } = useProjectDrag(onDropCategory);

  const openRowMenu = (e: React.MouseEvent, project: Project) => {
    ui.menu(e, projectMenuItems(ui, project));
  };

  const selectProject = (project: Project) => {
    if (shouldSuppressClick()) return;
    void actions.selectProject(project.id);
    if (!s.detailVisible) actions.toggleDetail();
  };

  const filtersActive = !!s.typeFilter || !!s.tagFilter || !!s.query;

  return (
    <section
      className={`list-pane${s.detailVisible ? "" : " is-wide"}`}
      style={s.detailVisible ? { width: s.settings.listWidth } : undefined}
    >
      <header className="list-head" data-drag-window>
        <div className="list-head-main">
          <h1>{navTitle(s)}</h1>
          <span className="list-count">{list.length}</span>
        </div>
        <div className="list-head-actions">
          {s.typeFilter && (
            <button className="filter-chip" onClick={() => actions.setTypeFilter(null)}>
              {TYPE_LABEL[s.typeFilter]}
              <X size={11} />
            </button>
          )}
          {s.tagFilter && (
            <button className="filter-chip" onClick={() => actions.setTagFilter(null)}>
              #{s.tagFilter}
              <X size={11} />
            </button>
          )}
        </div>
      </header>

      <div className={`list-body ${s.settings.view}`} data-view={s.settings.view}>
        {list.length === 0 ? (
          <ListEmptyState
            hasQuery={!!s.query}
            filtersActive={filtersActive}
            onAdd={() => ui.openAdd()}
          />
        ) : s.settings.view === "list" ? (
          list.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              selected={project.id === s.selectedProjectId}
              run={runningMap.get(project.id)}
              onPointerDown={(e) => startDrag(e, project)}
              onClick={() => selectProject(project)}
              onDoubleClick={() => runProject(ui, project)}
              onContextMenu={(e) => openRowMenu(e, project)}
              onToggleFavorite={async (e) => {
                e.stopPropagation();
                try {
                  await actions.setFavorite(project.id, !project.isFavorite);
                } catch (err) {
                  ui.toast(err instanceof Error ? err.message : "操作失败", "error");
                }
              }}
            />
          ))
        ) : (
          <div className="card-grid">
            {list.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                selected={project.id === s.selectedProjectId}
                run={runningMap.get(project.id)}
                onPointerDown={(e) => startDrag(e, project)}
                onClick={() => selectProject(project)}
                onDoubleClick={() => runProject(ui, project)}
                onContextMenu={(e) => openRowMenu(e, project)}
              />
            ))}
          </div>
        )}
      </div>

      {ghost &&
        createPortal(
          <div className="drag-ghost" style={{ left: ghost.x + 12, top: ghost.y + 12 }}>
            <span className="drag-ghost-dot" />
            {ghost.name}
          </div>,
          document.body,
        )}
    </section>
  );
}

function ListEmptyState({
  hasQuery,
  filtersActive,
  onAdd,
}: {
  hasQuery: boolean;
  filtersActive: boolean;
  onAdd: () => void;
}) {
  const s = useAppState();
  if (hasQuery || filtersActive) {
    return (
      <EmptyState
        icon={<SearchX size={26} />}
        title="没有匹配的项目"
        description="试试其他关键词，或清除筛选条件。"
        action={
          <Button
            onClick={() => {
              actions.setQuery("");
              actions.setTypeFilter(null);
              actions.setTagFilter(null);
            }}
          >
            清除筛选
          </Button>
        }
      />
    );
  }
  if (s.nav.kind === "favorite") {
    return (
      <EmptyState
        icon={<Star size={26} />}
        title="还没有收藏项目"
        description="在项目上右键，选择「收藏项目」。"
      />
    );
  }
  if (s.nav.kind === "recent") {
    return (
      <EmptyState
        icon={<Play size={26} />}
        title="还没有使用记录"
        description="打开或运行项目后，会出现在这里。"
      />
    );
  }
  if (s.nav.kind === "category") {
    return (
      <EmptyState
        icon={<FolderPlus size={26} />}
        title="这个分类还是空的"
        description="把项目拖到左侧分类上，或在右键菜单里修改分类。"
        action={<Button onClick={onAdd}>添加项目</Button>}
      />
    );
  }
  return (
    <EmptyState
      icon={<FolderPlus size={26} />}
      title="还没有项目"
      description="把项目文件夹拖进窗口，或点击「添加项目」选择目录。"
      action={<Button variant="primary" onClick={onAdd}>添加项目</Button>}
    />
  );
}

function StatusInline({ run }: { run?: ReturnType<typeof activeRuns>[number] }) {
  if (!run) return null;
  const meta = runStatusMeta(run);
  return (
    <span className={`inline-status tone-${meta.tone}`}>
      <span className="inline-status-dot" />
      {meta.label}
    </span>
  );
}

function ProjectRow({
  project,
  selected,
  run,
  onClick,
  onDoubleClick,
  onContextMenu,
  onPointerDown,
  onToggleFavorite,
}: {
  project: Project;
  selected: boolean;
  run?: ReturnType<typeof activeRuns>[number];
  onClick: () => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onToggleFavorite: (e: React.MouseEvent) => void;
}) {
  const missing = project.pathStatus !== "ok";
  return (
    <div
      className={`project-row${selected ? " is-selected" : ""}${missing ? " is-missing" : ""}`}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDoubleClick();
      }}
      title={project.rootPath}
    >
      <ProjectIcon project={project} size={30} dim={missing} />
      <div className="row-main">
        <div className="row-title">
          <span className="row-name">{project.name}</span>
          {project.isFavorite && (
            <button className="fav-mark" onClick={onToggleFavorite} title="取消收藏">
              <Star size={11} fill="currentColor" />
            </button>
          )}
        </div>
        <div className="row-meta">
          <span>{TYPE_LABEL[project.projectType]}</span>
          {missing ? (
            <span className="meta-warn">
              <AlertTriangle size={10} /> 路径失效
            </span>
          ) : (
            <span className="meta-dim">
              {run ? "运行中" : relativeTime(project.lastRunAt ?? project.lastOpenedAt ?? project.updatedAt)}
            </span>
          )}
        </div>
      </div>
      <div className="row-side">
        <StatusInline run={run} />
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  selected,
  run,
  onClick,
  onDoubleClick,
  onContextMenu,
  onPointerDown,
}: {
  project: Project;
  selected: boolean;
  run?: ReturnType<typeof activeRuns>[number];
  onClick: () => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const missing = project.pathStatus !== "ok";
  return (
    <div
      className={`project-card${selected ? " is-selected" : ""}${missing ? " is-missing" : ""}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      title={project.rootPath}
      role="option"
      aria-selected={selected}
    >
      <div className="card-top">
        <ProjectIcon project={project} size={34} dim={missing} />
        {project.isFavorite && <Star size={12} className="card-fav" fill="currentColor" />}
      </div>
      <div className="card-name">{project.name}</div>
      <div className="card-meta">{TYPE_LABEL[project.projectType]}</div>
      <div className="card-bottom">
        {missing ? (
          <span className="meta-warn">
            <AlertTriangle size={10} /> 路径失效
          </span>
        ) : run ? (
          <StatusInline run={run} />
        ) : (
          <span className="meta-dim">
            {relativeTime(project.lastRunAt ?? project.lastOpenedAt ?? project.updatedAt)}
          </span>
        )}
        <span className="card-path">{prettyPath(project.rootPath)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 指针拖拽：把项目拖到左侧分类                                          */
/* ------------------------------------------------------------------ */

function useProjectDrag(onDrop: (projectId: string, categoryId: string | null) => void) {
  const [ghost, setGhost] = useState<{ x: number; y: number; name: string } | null>(null);
  const drag = useRef<{
    id: string;
    name: string;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const suppress = useRef(false);
  const hovered = useRef<HTMLElement | null>(null);

  const startDrag = useCallback((e: React.PointerEvent, project: Project) => {
    if (e.button !== 0) return;
    drag.current = {
      id: project.id,
      name: project.name,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
    suppress.current = false;
  }, []);

  const clearHover = () => {
    if (hovered.current) {
      hovered.current.classList.remove("is-drop-hover");
      hovered.current = null;
    }
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.active) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 8) return;
        d.active = true;
        suppress.current = true;
        document.body.classList.add("is-dragging-project");
      }
      e.preventDefault();
      setGhost({ x: e.clientX, y: e.clientY, name: d.name });
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const target = el?.closest("[data-drop-category]") as HTMLElement | null;
      if (target !== hovered.current) {
        clearHover();
        if (target) {
          target.classList.add("is-drop-hover");
          hovered.current = target;
        }
      }
    };

    const finish = (e: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      document.body.classList.remove("is-dragging-project");
      clearHover();
      setGhost(null);
      if (!d || !d.active) return;
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const target = el?.closest("[data-drop-category]") as HTMLElement | null;
      if (target) {
        const raw = target.dataset.dropCategory ?? "";
        onDrop(d.id, raw === "__none__" ? null : raw);
      }
      window.setTimeout(() => {
        suppress.current = false;
      }, 30);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [onDrop]);

  return {
    ghost,
    startDrag,
    shouldSuppressClick: () => suppress.current,
  };
}
