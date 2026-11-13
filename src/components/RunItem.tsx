import { AlertCircle, Square, Terminal } from "lucide-react";
import { actions } from "../lib/store";
import { useUi } from "../lib/ui";
import { durationText, relativeTime, runStatusMeta, shortCommand } from "../lib/format";
import { Pill } from "./primitives";
import type { RunRecord } from "../types";

export const ACTIVE_STATUS = ["requested", "started", "running"];

export function isActiveRun(run: RunRecord) {
  return ACTIVE_STATUS.includes(run.status);
}

export async function stopRun(ui: ReturnType<typeof useUi>, run: RunRecord) {
  try {
    await actions.stopRun(run.id);
    ui.toast("任务已停止", "success");
  } catch (err) {
    ui.toast(err instanceof Error ? err.message : "停止失败", "error");
  }
}

export function RunItem({
  run,
  selected,
  onClick,
  showProject,
  onOpenTerminal,
}: {
  run: RunRecord;
  selected: boolean;
  onClick: () => void;
  showProject?: boolean;
  onOpenTerminal: (run: RunRecord) => void;
}) {
  const ui = useUi();
  const meta = runStatusMeta(run);
  const active = isActiveRun(run);
  return (
    <div
      className={`run-row${selected ? " is-selected" : ""}`}
      onClick={onClick}
      title={run.command}
    >
      <div className="run-row-main">
        <div className="run-row-title">
          <span className={`status-dot tone-${meta.tone}`} />
          <span className="run-name">
            {showProject ? run.projectName : run.configName ?? "任务"}
          </span>
          {showProject && run.configName && <span className="run-sep">·</span>}
          {showProject && <span className="run-sub">{run.configName}</span>}
        </div>
        <div className="run-row-meta">
          <Pill tone={meta.tone}>{meta.label}</Pill>
          <span>{relativeTime(run.startedAt)}</span>
          <span className="meta-dim">{durationText(run.startedAt, run.endedAt)}</span>
        </div>
        <div className="run-row-cmd">{shortCommand(run.command, 68)}</div>
      </div>
      <div className="run-row-actions" onClick={(e) => e.stopPropagation()}>
        {active && (
          <button className="mini-btn" onClick={() => stopRun(ui, run)} title="停止任务">
            <Square size={10} fill="currentColor" /> 停止
          </button>
        )}
        <button
          className="mini-btn"
          onClick={() => onOpenTerminal(run)}
          title="在内嵌终端中查看"
        >
          <Terminal size={11} /> 终端
        </button>
      </div>
    </div>
  );
}

export function RunErrorNote({ run }: { run: RunRecord }) {
  if (!run.error) return null;
  return (
    <div className="run-error-note">
      <AlertCircle size={13} />
      <span>{run.error}</span>
    </div>
  );
}
