import type { ProjectType, RunRecord, RunStatus, RuntimeType } from "../types";

export const TYPE_LABEL: Record<ProjectType, string> = {
  web: "Web 应用",
  python: "Python 工具",
  node: "Node.js",
  shell: "Shell 脚本",
  other: "其他项目",
};

export const RUNTIME_LABEL: Record<RuntimeType, string> = {
  python: "Python 脚本",
  html: "静态 HTML",
  web: "本地 Web 服务",
  node: "Node.js",
  shell: "Shell 脚本",
  custom: "自定义命令",
};

export const RUNTIME_HINT: Record<RuntimeType, string> = {
  python: "用指定解释器执行入口文件",
  html: "用默认浏览器直接打开页面",
  web: "在 Terminal 中启动本地服务",
  node: "用 node 执行入口文件",
  shell: "用 bash 执行脚本文件",
  custom: "在 Terminal 中执行自定义命令",
};

/** 依据真实状态 + 退出码给出展示语义 */
export function runStatusMeta(run: Pick<RunRecord, "status" | "exitCode">): {
  label: string;
  tone: "live" | "ok" | "warn" | "fail" | "idle";
} {
  const status: RunStatus = run.status;
  if (status === "running") return { label: "运行中", tone: "live" };
  if (status === "requested" || status === "started") return { label: "正在启动", tone: "warn" };
  if (status === "stopped") return { label: "已停止", tone: "idle" };
  if (status === "failed") return { label: "启动失败", tone: "fail" };
  if (status === "unknown") return { label: "状态未知", tone: "warn" };
  if (status === "exited") {
    if (run.exitCode === null) return { label: "已结束", tone: "ok" };
    return run.exitCode === 0
      ? { label: "已结束", tone: "ok" }
      : { label: `运行失败 · ${run.exitCode}`, tone: "fail" };
  }
  return { label: status, tone: "idle" };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  const now = new Date();
  const diff = now.getTime() - t.getTime();
  if (diff < 0) return "刚刚";
  if (diff < MINUTE) return "刚刚";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`;
  const sameDay =
    now.getFullYear() === t.getFullYear() &&
    now.getMonth() === t.getMonth() &&
    now.getDate() === t.getDate();
  if (sameDay) return `今天 ${pad(t.getHours())}:${pad(t.getMinutes())}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    yesterday.getFullYear() === t.getFullYear() &&
    yesterday.getMonth() === t.getMonth() &&
    yesterday.getDate() === t.getDate();
  if (isYesterday) return `昨天 ${pad(t.getHours())}:${pad(t.getMinutes())}`;
  if (now.getFullYear() === t.getFullYear()) {
    return `${t.getMonth() + 1} 月 ${t.getDate()} 日`;
  }
  return `${t.getFullYear()} 年 ${t.getMonth() + 1} 月 ${t.getDate()} 日`;
}

export function fullTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(
    t.getMinutes(),
  )}:${pad(t.getSeconds())}`;
}

export function clockTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  return `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
}

export function durationText(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return "—";
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (Number.isNaN(end)) return "—";
  const sec = Math.max(0, Math.round((end - start) / 1000));
  if (!endedAt) return `${formatDuration(sec)}（进行中）`;
  return formatDuration(sec);
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} 秒`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s ? `${m} 分 ${s} 秒` : `${m} 分`;
  const h = Math.floor(m / 60);
  return `${h} 小时 ${m % 60} 分`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** 显示路径时压缩 home 目录前缀 */
export function prettyPath(path: string, homeHint = "/Users/"): string {
  const parts = path.split("/");
  if (path.startsWith(homeHint)) {
    const idx = path.indexOf("/", homeHint.length);
    if (idx > 0) return `~${path.slice(idx)}`;
  }
  if (parts.length > 4) return `…/${parts.slice(-2).join("/")}`;
  return path;
}

export function shortCommand(command: string, max = 64): string {
  const one = command.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}
