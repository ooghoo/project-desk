import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  ExternalLink,
  FolderOpen,
  FolderSearch,
  Info,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Square,
  Star,
  Terminal,
  Trash2,
} from "lucide-react";
import { actions, selectedProject, useAppState } from "../lib/store";
import { useUi, type MenuEntry } from "../lib/ui";
import { TYPE_LABEL, RUNTIME_LABEL, fullTime, prettyPath, relativeTime, runStatusMeta, shortCommand, durationText } from "../lib/format";
import { ProjectIcon } from "./ProjectIcon";
import { Button, Callout, IconButton, Pill, Segmented, Spinner } from "./primitives";
import { FileTree } from "./FileTree";
import { ReadmePane } from "./ReadmePane";
import { isActiveRun, RunErrorNote, RunItem, stopRun } from "./RunItem";
import { RunTerminal } from "./RunTerminal";
import {
  copyPath,
  openProjectTerminal,
  projectMenuItems,
  revealProject,
  runProject,
} from "../lib/projectActions";
import type { LaunchConfig, RunRecord } from "../types";

type Tab = "readme" | "overview" | "files" | "runs" | "terminal";

function basename(path: string | null | undefined) {
  if (!path) return "";
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function configSummary(cfg: LaunchConfig): string {
  if (cfg.command) return cfg.command;
  switch (cfg.runtimeType) {
    case "python":
      return `${basename(cfg.executablePath) || "python"} ${cfg.entryPath ?? "—"}`;
    case "html":
      return `/usr/bin/open ${cfg.entryPath ?? "index.html"}`;
    case "node":
      return `node ${cfg.entryPath ?? ""}`.trim();
    case "shell":
      return `bash ${cfg.entryPath ?? ""}`.trim();
    default:
      return cfg.entryPath ?? "未配置";
  }
}

export function DetailPanel() {
  const s = useAppState();
  const ui = useUi();
  const project = selectedProject(s);
  const [tab, setTab] = useState<Tab>("overview");
  const activeRun = useMemo(
    () => s.projectRuns.find((r) => r.id === s.activeRunId) ?? null,
    [s.projectRuns, s.activeRunId],
  );

  useEffect(() => {
    setTab("overview");
  }, [project?.id]);

  useEffect(() => {
    if (activeRun) setTab("terminal");
  }, [activeRun?.id]);

  const projectRuns = useMemo(
    () => s.projectRuns.filter((r) => r.projectId === project?.id),
    [s.projectRuns, project?.id],
  );
  const active = projectRuns.filter(isActiveRun);
  const defaultConfig = s.configs.find((c) => c.isDefault) ?? s.configs[0];
  // 静态页面不跑进程，直接交给浏览器打开
  const directOpen = defaultConfig?.runtimeType === "html";

  /* 点击标题直接改名（内联编辑，回车保存、Esc 取消） */
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  const commitRename = async () => {
    if (!project) return;
    const next = nameDraft.trim();
    setEditingName(false);
    if (!next || next === project.name) return;
    try {
      await actions.updateProject(project.id, { name: next });
      ui.toast("已重命名", "success");
    } catch (err) {
      ui.toast(err instanceof Error ? err.message : "重命名失败", "error");
    }
  };
  const lastRun: RunRecord | undefined = projectRuns[0];

  if (!project) {
    return (
      <aside className="detail-pane is-empty">
        <div className="detail-empty">
          <Info size={26} />
          <h3>未选择项目</h3>
          <p>在左侧列表中选择一个项目，查看概览、文件与运行记录。</p>
        </div>
      </aside>
    );
  }

  const openConfigMenu = (e: React.MouseEvent) => {
    const items: MenuEntry[] = s.configs.map((cfg) => ({
      label: cfg.name,
      icon: cfg.id === defaultConfig?.id ? <Play size={13} /> : <span style={{ width: 13 }} />,
      onClick: () => runProject(ui, project, cfg.id),
    }));
    if (items.length) items.push({ type: "separator" });
    items.push(
      {
        label: "新建运行配置…",
        icon: <Plus size={13} />,
        onClick: () => ui.openConfig(project),
      },
      {
        label: "管理运行配置…",
        icon: <ListChecks size={13} />,
        onClick: () => ui.openConfig(project, defaultConfig),
      },
    );
    ui.menu(e, items);
  };

  const categoryName = project.categoryId
    ? s.categories.find((c) => c.id === project.categoryId)?.name ?? "未分类"
    : "未分类";

  return (
    <aside className="detail-pane">
      <header className="detail-head">
        <ProjectIcon project={project} size={44} dim={project.pathStatus !== "ok"} />
        <div className="detail-title">
          <div className="detail-title-row">
            {editingName ? (
              <input
                ref={nameInputRef}
                className="detail-title-input"
                value={nameDraft}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setNameDraft(project.name);
                    setEditingName(false);
                  }
                }}
              />
            ) : (
              <h1
                className="detail-title-text"
                title="点击重命名"
                onClick={() => {
                  setNameDraft(project.name);
                  setEditingName(true);
                }}
              >
                {project.name}
              </h1>
            )}
            <button
              className={`fav-btn${project.isFavorite ? " is-on" : ""}`}
              title={project.isFavorite ? "取消收藏" : "收藏"}
              onClick={() => actions.setFavorite(project.id, !project.isFavorite)}
            >
              {project.isFavorite ? <Star size={14} fill="currentColor" /> : <Star size={14} />}
            </button>
          </div>
          <div className="detail-sub">
            <span className="type-chip">{TYPE_LABEL[project.projectType]}</span>
            <button
              className="path-chip"
              title={`${project.rootPath}\n点击复制路径`}
              onClick={() => copyPath(ui, project.rootPath, "项目路径已复制")}
            >
              <span className="path-chip-text">{prettyPath(project.rootPath)}</span>
              <Copy size={10} />
            </button>
            {project.pathStatus !== "ok" && (
              <span className="badge-danger">
                <AlertTriangle size={10} /> 路径失效
              </span>
            )}
          </div>
        </div>
        <div className="detail-actions">
          {active.length > 0 ? (
            <Button
              variant="default"
              icon={<Square size={12} fill="currentColor" />}
              onClick={() => stopRun(ui, active[0])}
            >
              停止
            </Button>
          ) : null}
          <div className="run-split">
            <Button
              variant="primary"
              icon={
                directOpen ? (
                  <ExternalLink size={12} />
                ) : (
                  <Play size={12} fill="currentColor" />
                )
              }
              disabled={project.pathStatus !== "ok"}
              onClick={() =>
                project.configCount === 0 ? ui.openConfig(project) : runProject(ui, project, defaultConfig?.id)
              }
            >
              {project.configCount === 0 ? "配置运行" : directOpen ? "打开" : "运行"}
            </Button>
            <button className="run-caret" onClick={openConfigMenu} title="选择运行配置">
              <ChevronDown size={12} />
            </button>
          </div>
          <IconButton label="在 Finder 中显示" onClick={() => revealProject(ui, project)}>
            <FolderOpen size={15} />
          </IconButton>
          <IconButton label="在终端中打开" onClick={() => openProjectTerminal(ui, project)}>
            <Terminal size={15} />
          </IconButton>
          <IconButton
            label="更多操作"
            onClick={(e) => ui.menu(e, projectMenuItems(ui, project))}
          >
            <MoreHorizontal size={16} />
          </IconButton>
        </div>
      </header>

      <div className="detail-tabs">
        <Segmented
          value={tab}
          onChange={setTab}
          size="sm"
          options={[
            { value: "readme", label: "说明" },
            { value: "overview", label: "概览" },
            { value: "files", label: "文件" },
            {
              value: "runs",
              label: projectRuns.length ? `运行记录（${projectRuns.length}）` : "运行记录",
            },
            ...(activeRun ? [{ value: "terminal" as Tab, label: "终端" }] : []),
          ]}
        />
      </div>

      <div
        className={`detail-body${tab === "terminal" ? " is-terminal" : ""}${
          tab === "readme" ? " is-readme" : ""
        }`}
      >
        {project.pathStatus !== "ok" && (
          <Callout
            tone="danger"
            icon={<AlertTriangle size={15} />}
            title="项目目录不可用"
            action={
              <Button size="sm" onClick={() => ui.openRelocate(project)} icon={<FolderSearch size={12} />}>
                重新定位
              </Button>
            }
          >
            磁盘上找不到 {project.rootPath}。项目记录、分类、标签与运行配置都已保留，重新定位后即可继续使用。
          </Callout>
        )}

        {tab === "overview" && (
          <div className="tab-panel">
            <section className="panel-section">
              <div className="section-head">
                <h3>项目信息</h3>
              </div>
              <div className="info-grid">
                <InfoItem label="项目类型" value={TYPE_LABEL[project.projectType]} />
                <InfoItem label="分类" value={categoryName} />
                <InfoItem
                  label="实际路径"
                  value={project.rootPath}
                  mono
                  full
                  action={
                    <button className="link-btn" onClick={() => revealProject(ui, project)}>
                      <FolderOpen size={11} /> 显示
                    </button>
                  }
                />
                <InfoItem
                  label="标签"
                  full
                  value={
                    project.tags.length ? (
                      <span className="tag-list">
                        {project.tags.map((t) => (
                          <button
                            key={t.name}
                            className="tag-chip"
                            onClick={() => {
                              actions.setTagFilter(t.name);
                              actions.setNav({ kind: "all" });
                            }}
                            title={`筛选标签 #${t.name}`}
                          >
                            #{t.name}
                          </button>
                        ))}
                        <button className="tag-add" onClick={() => ui.openTags(project)}>
                          <Plus size={11} />
                        </button>
                      </span>
                    ) : (
                      <button className="link-btn" onClick={() => ui.openTags(project)}>
                        <Plus size={11} /> 添加标签
                      </button>
                    )
                  }
                />
                <InfoItem label="添加时间" value={fullTime(project.createdAt)} />
                <InfoItem
                  label="最近运行"
                  value={project.lastRunAt ? relativeTime(project.lastRunAt) : "尚未运行"}
                />
              </div>
            </section>

            <section className="panel-section">
              <div className="section-head">
                <h3>运行配置</h3>
                <div className="section-actions">
                  <span className="section-hint">{s.configs.length} 个配置</span>
                  <IconButton label="新建运行配置" onClick={() => ui.openConfig(project)}>
                    <Plus size={14} />
                  </IconButton>
                </div>
              </div>
              {s.loadingProject && s.configs.length === 0 ? (
                <div className="inline-loading">
                  <Spinner /> 加载中…
                </div>
              ) : s.configs.length === 0 ? (
                <div className="config-empty">
                  <p>还没有运行配置。为这个项目添加 Python 脚本、静态页面或本地服务等运行方式。</p>
                  <Button size="sm" variant="primary" icon={<Plus size={12} />} onClick={() => ui.openConfig(project)}>
                    新建运行配置
                  </Button>
                </div>
              ) : (
                <div className="config-list">
                  {s.configs.map((cfg) => (
                    <ConfigCard
                      key={cfg.id}
                      cfg={cfg}
                      projectId={project.id}
                      onRun={() => runProject(ui, project, cfg.id)}
                      onEdit={() => ui.openConfig(project, cfg)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="panel-section">
              <div className="section-head">
                <h3>最近一次运行</h3>
                {lastRun && (
                  <div className="section-actions">
                    <span className="section-hint">{relativeTime(lastRun.startedAt)}</span>
                  </div>
                )}
              </div>
              {lastRun ? (
                <div className="last-run">
                  <div className="last-run-top">
                    <Pill tone={runStatusMeta(lastRun).tone} dot>
                      {runStatusMeta(lastRun).label}
                    </Pill>
                    <span className="last-run-name">{lastRun.configName ?? "任务"}</span>
                    <span className="meta-dim">{durationText(lastRun.startedAt, lastRun.endedAt)}</span>
                    {lastRun.exitCode !== null && (
                      <span className="meta-dim">退出码 {lastRun.exitCode}</span>
                    )}
                    <div className="last-run-actions">
                      <Button
                        size="sm"
                        icon={<Terminal size={11} />}
                        onClick={() => {
                          actions.setActiveRun(lastRun.id);
                          setTab("terminal");
                        }}
                      >
                        查看输出
                      </Button>
                    </div>
                  </div>
                  <code className="command-line">{lastRun.command}</code>
                  <RunErrorNote run={lastRun} />
                </div>
              ) : (
                <p className="section-empty">还没有运行记录。</p>
              )}
            </section>
          </div>
        )}

        {tab === "readme" && <ReadmePane project={project} />}

        {tab === "files" && (
          <div className="tab-panel is-files">
            {project.pathStatus === "ok" ? (
              <FileTree rootPath={project.rootPath} projectName={project.name} />
            ) : (
              <p className="section-empty">项目目录不可用，无法浏览文件。</p>
            )}
          </div>
        )}

        {tab === "runs" && (
          <div className="tab-panel">
            {projectRuns.length === 0 ? (
              <p className="section-empty">还没有运行记录。点击右上角「运行」开始。</p>
            ) : (
              <div className="run-list">
                {projectRuns.map((run) => (
                  <RunItem
                    key={run.id}
                    run={run}
                    selected={run.id === s.activeRunId}
                    onClick={() => {
                      actions.setActiveRun(run.id);
                      setTab("terminal");
                    }}
                    onOpenTerminal={(r) => {
                      actions.setActiveRun(r.id);
                      setTab("terminal");
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "terminal" &&
          (activeRun ? (
            <RunTerminal key={activeRun.id} run={activeRun} />
          ) : (
            <p className="section-empty">没有可显示的任务终端。</p>
          ))}
      </div>
    </aside>
  );
}

function InfoItem({
  label,
  value,
  full,
  mono,
  action,
}: {
  label: string;
  value: React.ReactNode;
  full?: boolean;
  mono?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className={`info-item${full ? " is-full" : ""}`}>
      <span className="info-label">{label}</span>
      <span className={`info-value${mono ? " is-mono" : ""}`} title={typeof value === "string" ? value : undefined}>
        {value}
      </span>
      {action && <span className="info-action">{action}</span>}
    </div>
  );
}

function ConfigCard({
  cfg,
  projectId,
  onRun,
  onEdit,
}: {
  cfg: LaunchConfig;
  projectId: string;
  onRun: () => void;
  onEdit: () => void;
}) {
  const ui = useUi();
  const menu = (e: React.MouseEvent) => {
    ui.menu(e, [
      {
        label: "运行此配置",
        icon: <Play size={13} />,
        onClick: onRun,
      },
      { label: "编辑配置", icon: <Pencil size={13} />, onClick: onEdit },
      {
        label: "设为默认",
        icon: <Star size={13} />,
        disabled: cfg.isDefault,
        onClick: async () => {
          try {
            await actions.saveConfig(projectId, cfg.id, {
              name: cfg.name,
              runtimeType: cfg.runtimeType,
              executablePath: cfg.executablePath,
              entryPath: cfg.entryPath,
              workingDirectory: cfg.workingDirectory,
              arguments: cfg.arguments,
              envVars: cfg.envVars,
              command: cfg.command,
              launchMode: cfg.launchMode,
              port: cfg.port,
              url: cfg.url,
              openBrowser: cfg.openBrowser,
              keepWindow: cfg.keepWindow,
              unbuffered: cfg.unbuffered,
              isDefault: true,
              allowConcurrent: cfg.allowConcurrent,
            });
            ui.toast("已设为默认运行配置", "success");
          } catch (err) {
            ui.toast(err instanceof Error ? err.message : "设置失败", "error");
          }
        },
      },
      { label: "复制命令", icon: <Copy size={13} />, onClick: () => copyPath(ui, configSummary(cfg), "命令已复制") },
      { type: "separator" },
      {
        label: "删除配置",
        icon: <Trash2 size={13} />,
        danger: true,
        onClick: async () => {
          const ok = await ui.confirm({
            title: `删除运行配置「${cfg.name}」？`,
            message: "只删除应用内的运行配置，不会影响项目文件。",
            confirmText: "删除",
            danger: true,
          });
          if (!ok) return;
          try {
            await actions.deleteConfig(projectId, cfg.id);
            ui.toast("运行配置已删除", "success");
          } catch (err) {
            ui.toast(err instanceof Error ? err.message : "删除失败", "error");
          }
        },
      },
    ]);
  };

  return (
    <div className="config-card">
      <div className="config-main">
        <div className="config-title">
          <span>{cfg.name}</span>
          {cfg.isDefault && <span className="mini-pill">默认</span>}
        </div>
        <div className="config-meta">
          <span>{RUNTIME_LABEL[cfg.runtimeType]}</span>
          {cfg.port ? <span className="meta-dim">端口 {cfg.port}</span> : null}
          {cfg.allowConcurrent ? <span className="meta-dim">允许并发</span> : null}
        </div>
        <code className="config-cmd" title={configSummary(cfg)}>
          {shortCommand(configSummary(cfg), 78)}
        </code>
      </div>
      <div className="config-actions">
        <Button size="sm" variant="default" icon={<Play size={11} />} onClick={onRun}>
          运行
        </Button>
        <IconButton label="编辑配置" onClick={onEdit}>
          <Pencil size={13} />
        </IconButton>
        <IconButton label="更多" onClick={menu}>
          <MoreHorizontal size={14} />
        </IconButton>
      </div>
    </div>
  );
}
