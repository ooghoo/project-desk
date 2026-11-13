import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  Clock,
  FolderOpen,
  Info,
  Square,
  Trash2,
} from "lucide-react";
import { actions, activeRuns, useAppState } from "../lib/store";
import { useUi } from "../lib/ui";
import { call } from "../lib/api";
import {
  durationText,
  fullTime,
  prettyPath,
  relativeTime,
  runStatusMeta,
  RUNTIME_LABEL,
} from "../lib/format";
import { Button, EmptyState, IconButton, Pill, Segmented } from "./primitives";
import { isActiveRun, RunErrorNote, RunItem, stopRun } from "./RunItem";
import { RunTerminal } from "./RunTerminal";
import type { RunRecord } from "../types";

type View = "info" | "terminal";

export function RunsView() {
  const s = useAppState();
  const ui = useUi();
  const runs = s.runs;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>("info");

  useEffect(() => {
    if (selectedId && runs.some((r) => r.id === selectedId)) return;
    const active = runs.find(isActiveRun);
    setSelectedId((active ?? runs[0])?.id ?? null);
  }, [runs, selectedId]);

  const selected = useMemo(() => runs.find((r) => r.id === selectedId) ?? null, [runs, selectedId]);
  const activeCount = activeRuns(runs).length;

  const clearHistory = async () => {
    const ok = await ui.confirm({
      title: "清空运行历史？",
      message: "只会删除已结束任务的运行记录，正在运行的任务不受影响。",
      confirmText: "清空历史",
      danger: true,
    });
    if (!ok) return;
    try {
      await actions.clearRunHistory();
      ui.toast("运行历史已清空", "success");
    } catch (err) {
      ui.toast(err instanceof Error ? err.message : "清空失败", "error");
    }
  };

  const openTaskDir = async (run: RunRecord) => {
    try {
      await call("open_run_folder", { runId: run.id });
    } catch (err) {
      ui.toast(err instanceof Error ? err.message : "打开失败", "error");
    }
  };

  return (
    <>
      <section className="list-pane" style={{ width: s.settings.listWidth }}>
        <header className="list-head" data-drag-window>
          <div className="list-head-main">
            <h1>运行任务</h1>
            <span className="list-count">{runs.length}</span>
          </div>
          <div className="list-head-actions">
            {activeCount > 0 && (
              <span className="live-label">
                <span className="nav-live" />
                {activeCount} 个运行中
              </span>
            )}
            <IconButton label="清空已结束的历史" onClick={clearHistory} disabled={runs.length === 0}>
              <Trash2 size={13} />
            </IconButton>
          </div>
        </header>
        <div className="list-body">
          {runs.length === 0 ? (
            <EmptyState
              icon={<Activity size={26} />}
              title="还没有运行任务"
              description="在项目中点击「运行」后，任务会出现在这里，可以查看状态与实时输出。"
            />
          ) : (
            runs.map((run) => (
              <RunItem
                key={run.id}
                run={run}
                selected={run.id === selectedId}
                showProject
                onClick={() => {
                  setSelectedId(run.id);
                  actions.setActiveRun(run.id);
                }}
                onOpenTerminal={(r) => {
                  setSelectedId(r.id);
                  actions.setActiveRun(r.id);
                  setView("terminal");
                }}
              />
            ))
          )}
        </div>
      </section>

      <aside className="detail-pane">
        {!selected ? (
          <div className="detail-empty">
            <Activity size={26} />
            <h3>未选择任务</h3>
            <p>在左侧选择一条运行记录查看详情。</p>
          </div>
        ) : (
          <>
            <TaskHeader
              run={selected}
              view={view}
              onView={setView}
              onOpenTaskDir={() => openTaskDir(selected)}
            />
            {view === "terminal" ? (
              <RunTerminal key={selected.id} run={selected} />
            ) : (
              <TaskInfo run={selected} />
            )}
          </>
        )}
      </aside>
    </>
  );
}

function TaskHeader({
  run,
  view,
  onView,
  onOpenTaskDir,
}: {
  run: RunRecord;
  view: View;
  onView: (v: View) => void;
  onOpenTaskDir: () => void;
}) {
  const ui = useUi();
  const meta = runStatusMeta(run);
  const active = isActiveRun(run);

  return (
    <header className="task-head">
      <div className="task-head-main">
        <div className="task-title-row">
          <span className={`status-dot tone-${meta.tone}`} />
          <h1>{run.configName ?? "运行任务"}</h1>
          <Pill tone={meta.tone}>{meta.label}</Pill>
        </div>
        <div className="task-sub">
          <button
            className="link-inline"
            onClick={async () => {
              actions.setNav({ kind: "all" });
              await actions.selectProject(run.projectId);
            }}
          >
            {run.projectName}
          </button>
          <span className="meta-dim">{RUNTIME_LABEL[run.runtimeType]}</span>
        </div>
      </div>
      <div className="task-actions">
        <Segmented
          value={view}
          onChange={onView}
          size="sm"
          options={[
            { value: "info", label: "概览" },
            { value: "terminal", label: "终端" },
          ]}
        />
        {active && (
          <Button
            variant="default"
            icon={<Square size={11} fill="currentColor" />}
            onClick={() => stopRun(ui, run)}
          >
            停止
          </Button>
        )}
        <IconButton label="打开任务目录" onClick={onOpenTaskDir}>
          <FolderOpen size={15} />
        </IconButton>
      </div>
    </header>
  );
}

function TaskInfo({ run }: { run: RunRecord }) {
  return (
    <div className="task-body">
      <RunErrorNote run={run} />
      {run.status === "unknown" && (
        <div className="callout callout-warn">
          <AlertCircle size={14} />
          <div className="callout-body">
            <strong>无法确认运行状态</strong>
            <div className="callout-text">
              任务进程已不存在，也没有捕获到退出码（可能是在终端里被手动关闭，或应用重启后无法再追踪）。
              可以在「终端」里查看输出，或重新运行。
            </div>
          </div>
        </div>
      )}

      <section className="panel-section">
        <div className="section-head">
          <h3>执行信息</h3>
          <span className="section-hint">{relativeTime(run.startedAt)}</span>
        </div>
        <div className="info-grid">
          <div className="info-item is-full">
            <span className="info-label">命令</span>
            <code className="command-line is-full">{run.command}</code>
          </div>
          <div className="info-item is-full">
            <span className="info-label">工作目录</span>
            <span className="info-value is-mono" title={run.workingDirectory}>
              {prettyPath(run.workingDirectory)}
            </span>
          </div>
          <div className="info-item">
            <span className="info-label">启动时间</span>
            <span className="info-value">{fullTime(run.startedAt)}</span>
          </div>
          <div className="info-item">
            <span className="info-label">结束时间</span>
            <span className="info-value">{run.endedAt ? fullTime(run.endedAt) : "—"}</span>
          </div>
          <div className="info-item">
            <span className="info-label">持续时间</span>
            <span className="info-value">
              <Clock size={11} /> {durationText(run.startedAt, run.endedAt)}
            </span>
          </div>
          <div className="info-item">
            <span className="info-label">进程 PID</span>
            <span className="info-value is-mono">{run.pid ?? "—"}</span>
          </div>
          <div className="info-item">
            <span className="info-label">退出码</span>
            <span className="info-value is-mono">{run.exitCode ?? "—"}</span>
          </div>
          <div className="info-item">
            <span className="info-label">日志文件</span>
            <span className="info-value is-mono" title={run.logPath}>
              {run.logPath ? prettyPath(run.logPath) : "—"}
            </span>
          </div>
        </div>
      </section>

      <section className="panel-section">
        <div className="section-head">
          <h3>说明</h3>
        </div>
        <ul className="task-notes">
          <li>任务在应用内嵌终端中执行，输出实时显示并写入日志文件，支持交互式输入。</li>
          <li>「停止」会按进程树终止任务（先 SIGTERM，必要时 SIGKILL），避免子进程继续占用端口。</li>
          <li>应用重启后不会沿用旧状态，只根据真实进程与退出码推断。</li>
        </ul>
      </section>
    </div>
  );
}

export function TaskDetailHint() {
  return (
    <p className="section-empty">
      <Info size={11} /> 选择左侧任务查看详情
    </p>
  );
}
