import { invoke } from "@tauri-apps/api/core";
import type { IpcErrorShape } from "../types";

export class IpcError extends Error {
  code: string;
  projectId?: string;
  runId?: string;

  constructor(shape: IpcErrorShape) {
    super(shape.message || "操作失败");
    this.name = "IpcError";
    this.code = shape.code || "error";
    this.projectId = shape.projectId;
    this.runId = shape.runId;
  }
}

function normalize(raw: unknown): IpcError {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.message === "string") {
      return new IpcError({
        code: typeof obj.code === "string" ? obj.code : "error",
        message: obj.message,
        projectId: typeof obj.projectId === "string" ? obj.projectId : undefined,
        runId: typeof obj.runId === "string" ? obj.runId : undefined,
      });
    }
  }
  if (typeof raw === "string") {
    return new IpcError({ code: "error", message: raw });
  }
  return new IpcError({ code: "error", message: "未知错误" });
}

/** 所有后端调用都经过这里，错误统一成带 code 的 IpcError */
export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    throw normalize(err);
  }
}

export function isIpcError(err: unknown): err is IpcError {
  return err instanceof IpcError;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "未知错误";
}
