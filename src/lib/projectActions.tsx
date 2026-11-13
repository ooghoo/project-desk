import {
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  Copy,
  FolderOpen,
  FolderSearch,
  PencilLine,
  Play,
  Settings2,
  Square,
  Star,
  Tag as TagIcon,
  Terminal,
  Trash2,
  FolderInput,
  ListChecks,
} from "lucide-react";
import { call, IpcError } from "./api";
import { actions, getState, visibleProjects } from "./store";
import type { Project } from "../types";
import type { MenuEntry, UiApi } from "./ui";

export async function copyPath(ui: UiApi, text: string, label = "路径已复制") {
  try {
    await call("copy_text", { text });
    ui.toast(label, "success");
  } catch (err) {
    ui.toast(err instanceof Error ? err.message : "复制失败", "error");
  }
}

export async function showRunError(ui: UiApi, err: unknown) {
  if (err instanceof IpcError) {
    if (err.code === "no_config") {
      ui.toast("该项目还没有运行配置", "error");
      return;
    }
    if (err.code === "already_running") {
      ui.toast("该配置已有任务在运行", "error");
      return;
    }
    await ui.alert({ title: "无法启动任务", message: err.message });
    return;
  }
  await ui.alert({ title: "操作失败", message: err instanceof Error ? err.message : String(err) });
}

export async function runProject(ui: UiApi, project: Project, configId?: string | null) {
  if (project.pathStatus !== "ok") {
    const go = await ui.confirm({
      title: "项目路径不可用",
      message: "磁盘上的项目目录已不存在，无法运行。是否现在重新定位项目？",
      confirmText: "重新定位",
    });
    if (go) ui.openRelocate(project);
    return;
  }
  if (project.configCount === 0) {
    ui.openConfig(project);
    return;
  }
  try {
    const outcome = await actions.runProject(project.id, configId ?? null);
    if (outcome.kind === "opened") {
      const name = outcome.path.split("/").pop() ?? "页面";
      ui.toast(`已在浏览器中打开：${name}`, "success");
      return;
    }
    const run = outcome.run;
    if (run.status === "running" || run.status === "started" || run.status === "requested") {
      ui.toast(`已在应用内启动：${run.configName ?? "任务"}`, "success");
    } else {
      ui.toast(`任务已结束：${run.configName ?? "任务"}`, "success");
    }
  } catch (err) {
    await showRunError(ui, err);
  }
}

export async function stopProjectTask(ui: UiApi, project: Project) {
  const run = [...getState().runs]
    .filter((r) => r.projectId === project.id && ["requested", "started", "running"].includes(r.status))
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
  if (!run) {
    ui.toast("该项目当前没有运行中的任务", "info");
    return;
  }
  try {
    await actions.stopRun(run.id);
    ui.toast("任务已停止", "success");
  } catch (err) {
    await showRunError(ui, err);
  }
}

export async function removeProjectFlow(ui: UiApi, project: Project) {
  const ok = await ui.confirm({
    title: `从工作台移除「${project.name}」？`,
    message: "只会删除应用内的项目记录、标签与运行配置。",
    details: [`磁盘上的文件夹不会受到任何影响：${project.rootPath}`],
    confirmText: "从工作台移除",
    danger: true,
  });
  if (!ok) return;
  try {
    await actions.removeProject(project.id, false);
    ui.toast("已从工作台移除", "success");
  } catch (err) {
    if (err instanceof IpcError && err.code === "has_running") {
      const stop = await ui.confirm({
        title: "项目仍有任务在运行",
        message: err.message,
        confirmText: "停止任务并移除",
        danger: true,
      });
      if (!stop) return;
      try {
        await actions.removeProject(project.id, true);
        ui.toast("任务已停止，项目已移除", "success");
      } catch (inner) {
        ui.toast(inner instanceof Error ? inner.message : "移除失败", "error");
      }
      return;
    }
    ui.toast(err instanceof Error ? err.message : "移除失败", "error");
  }
}

export async function revealProject(ui: UiApi, project: Project) {
  try {
    await call("reveal_project", { id: project.id });
  } catch (err) {
    if (err instanceof IpcError && err.code === "path_missing") {
      const go = await ui.confirm({
        title: "项目路径不存在",
        message: err.message,
        confirmText: "重新定位",
      });
      if (go) ui.openRelocate(project);
      return;
    }
    ui.toast(err instanceof Error ? err.message : "打开失败", "error");
  }
}

export async function openProjectTerminal(ui: UiApi, project: Project) {
  try {
    await call("open_project_terminal", { id: project.id });
  } catch (err) {
    if (err instanceof IpcError && err.code === "path_missing") {
      ui.toast(err.message, "error");
      return;
    }
    await ui.alert({
      title: "无法打开终端",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function moveProject(ui: UiApi, project: Project, direction: "top" | "up" | "down") {
  const list = visibleProjects(getState());
  const index = list.findIndex((p) => p.id === project.id);
  if (index < 0) return;
  const target = direction === "top" ? 0 : direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= list.length || target === index) return;
  const ids = list.map((p) => p.id);
  ids.splice(index, 1);
  ids.splice(target, 0, project.id);
  try {
    await actions.reorderProjects(ids);
  } catch (err) {
    ui.toast(err instanceof Error ? err.message : "调整排序失败", "error");
  }
}

export function projectMenuItems(ui: UiApi, project: Project): MenuEntry[] {
  const manualSort = getState().settings.sort === "manual";
  const sortItems: MenuEntry[] = manualSort
    ? [
        { label: "移到最前", icon: <ArrowUpToLine size={13} />, onClick: () => moveProject(ui, project, "top") },
        { label: "上移一位", icon: <ArrowUp size={13} />, onClick: () => moveProject(ui, project, "up") },
        { label: "下移一位", icon: <ArrowDown size={13} />, onClick: () => moveProject(ui, project, "down") },
      ]
    : [
        {
          label: "切换为手动排序",
          icon: <ListChecks size={13} />,
          onClick: () => {
            actions.setSort("manual");
            ui.toast("已切换为手动排序，可用右键菜单调整顺序", "info");
          },
        },
      ];
  const running = getState().runs.some(
    (r) => r.projectId === project.id && ["requested", "started", "running"].includes(r.status),
  );
  return [
    {
      label: "运行项目",
      icon: <Play size={13} />,
      onClick: () => runProject(ui, project),
    },
    {
      label: "停止运行",
      icon: <Square size={13} />,
      disabled: !running,
      onClick: () => stopProjectTask(ui, project),
    },
    { type: "separator" },
    {
      label: "运行配置…",
      icon: <ListChecks size={13} />,
      onClick: () => ui.openConfig(project),
    },
    {
      label: "编辑项目信息",
      icon: <Settings2 size={13} />,
      onClick: () => ui.openRename(project),
    },
    {
      label: "修改分类",
      icon: <FolderInput size={13} />,
      onClick: () => ui.openCategory(project),
    },
    {
      label: "管理标签",
      icon: <TagIcon size={13} />,
      onClick: () => ui.openTags(project),
    },
    ...sortItems,
    { type: "separator" },
    {
      label: project.isFavorite ? "取消收藏" : "收藏项目",
      icon: <Star size={13} fill={project.isFavorite ? "currentColor" : "none"} />,
      onClick: async () => {
        try {
          await actions.setFavorite(project.id, !project.isFavorite);
        } catch (err) {
          ui.toast(err instanceof Error ? err.message : "操作失败", "error");
        }
      },
    },
    { type: "separator" },
    {
      label: "在 Finder 中显示",
      icon: <FolderOpen size={13} />,
      onClick: () => revealProject(ui, project),
    },
    {
      label: "在终端中打开",
      icon: <Terminal size={13} />,
      onClick: () => openProjectTerminal(ui, project),
    },
    {
      label: "复制项目路径",
      icon: <Copy size={13} />,
      onClick: () => copyPath(ui, project.rootPath, "项目路径已复制"),
    },
    { type: "separator" },
    {
      label: "重新定位项目",
      icon: <FolderSearch size={13} />,
      onClick: () => ui.openRelocate(project),
    },
    {
      label: "从工作台移除",
      icon: <Trash2 size={13} />,
      danger: true,
      onClick: () => removeProjectFlow(ui, project),
    },
  ];
}

export function renameLabel(ui: UiApi, project: Project) {
  ui.openRename(project);
}

export function editLabel(ui: UiApi, project: Project) {
  // "编辑项目配置" 同时提供元信息与运行配置入口
  ui.menu({ clientX: 0, clientY: 0 }, [
    { label: "项目信息", icon: <PencilLine size={13} />, onClick: () => ui.openRename(project) },
    { label: "运行配置", icon: <Settings2 size={13} />, onClick: () => ui.openConfig(project) },
  ]);
}
