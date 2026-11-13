/* 与 Rust 后端模型一一对应（serde camelCase） */

export type ProjectType = "web" | "python" | "node" | "shell" | "other";
export type RuntimeType = "python" | "html" | "web" | "node" | "shell" | "custom";
export type RunStatus = "requested" | "started" | "running" | "exited" | "stopped" | "unknown" | "failed";
export type PathStatus = "ok" | "missing";

export interface Tag {
  id: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
  kind: string;
  sortOrder: number;
  isBuiltin: boolean;
  projectCount: number;
}

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  projectType: ProjectType;
  categoryId: string | null;
  icon: string | null;
  isFavorite: boolean;
  sortOrder: number;
  notes: string | null;
  pathStatus: PathStatus;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  lastRunAt: string | null;
  tags: Tag[];
  configCount: number;
}

export interface EnvPair {
  key: string;
  value: string;
}

export interface LaunchConfig {
  id: string;
  projectId: string;
  name: string;
  runtimeType: RuntimeType;
  executablePath: string | null;
  entryPath: string | null;
  workingDirectory: string | null;
  arguments: string[];
  envVars: EnvPair[];
  command: string | null;
  launchMode: string;
  port: number | null;
  url: string | null;
  openBrowser: boolean;
  keepWindow: boolean;
  unbuffered: boolean;
  isDefault: boolean;
  allowConcurrent: boolean;
  /** manual | manifest —— manifest 来源的配置在重新同步 launcher.json 时会被刷新 */
  source: string;
  sourceConfigId: string | null;
  configType: string;
  stopStrategy: string;
  startupTimeout: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigInput {
  name: string;
  runtimeType: RuntimeType;
  executablePath?: string | null;
  entryPath?: string | null;
  workingDirectory?: string | null;
  arguments: string[];
  envVars: EnvPair[];
  command?: string | null;
  launchMode?: string | null;
  port?: number | null;
  url?: string | null;
  openBrowser?: boolean | null;
  keepWindow?: boolean | null;
  unbuffered?: boolean | null;
  isDefault?: boolean | null;
  allowConcurrent?: boolean | null;
}

export interface RunRecord {
  id: string;
  projectId: string;
  projectName: string;
  configId: string | null;
  configName: string | null;
  runtimeType: RuntimeType;
  command: string;
  workingDirectory: string;
  status: RunStatus;
  exitCode: number | null;
  error: string | null;
  pid: number | null;
  logPath: string;
  taskDir: string;
  pidFile: string;
  exitFile: string;
  startedAt: string;
  endedAt: string | null;
}

export interface ManifestConfig {
  id: string;
  name: string;
  configType: string;
  runtime: string;
  workingDirectory: string;
  command: string | null;
  args: string[];
  /** null 表示没有固定地址，需从实际运行结果获取 */
  url: string | null;
  startupTimeout: number | null;
  stopStrategy: string;
  entry: string | null;
  port: number | null;
  configInput: ConfigInput;
}

export interface ManifestReport {
  found: boolean;
  valid: boolean;
  path: string | null;
  schemaVersion: string | null;
  projectName: string | null;
  projectType: string | null;
  defaultConfig: string | null;
  configurations: ManifestConfig[];
  errors: string[];
  warnings: string[];
}

export interface Detection {
  rootPath: string;
  suggestedName: string;
  projectType: ProjectType;
  categoryKind: string;
  runtimeType: RuntimeType;
  entryPath: string | null;
  executablePath: string | null;
  workingDirectory: string | null;
  command: string | null;
  port: number | null;
  signals: string[];
  warnings: string[];
  scripts: string[];
  topLevel: string[];
  manifest: ManifestReport | null;
  /** manifest（配置文件优先）| auto（自动识别） */
  source: string;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modified: string | null;
  hasChildren: boolean;
}

export interface PathIssue {
  projectId: string;
  name: string;
  rootPath: string;
  status: string;
}

export interface PythonInfo {
  path: string;
  version: string | null;
  label: string;
  source: string;
}

export interface ImportReport {
  imported: number;
  skippedExisting: number;
  missingPaths: string[];
  errors: string[];
  categoriesCreated: number;
}

/** 项目根目录 README 的内容 */
export interface ReadmePayload {
  path: string;
  fileName: string;
  content: string;
  truncated: boolean;
}

/** 「运行」的结果：真正起进程，还是直接用浏览器打开 */
export type LaunchOutcome =
  | { kind: "run"; run: RunRecord }
  | { kind: "opened"; path: string };

export interface DropItem {
  path: string;
  name: string;
  isDir: boolean;
  exists: boolean;
}

export interface RuntimePath {
  name: string;
  path: string;
}

export interface AppSettings {
  theme: "system" | "light" | "dark";
  view: "list" | "grid";
  startup: "last" | "all" | "recent" | "favorite";
  restoreWorkspace: boolean;
  sidebarWidth: number;
  listWidth: number;
  showDetail: boolean;
  sort: "recent" | "name" | "created" | "manual";
  sortDirection: "asc" | "desc";
  lastProjectId: string | null;
  lastNav: string;
  pythonInterpreters: string[];
  defaultTerminal: string;
  defaultPort: number;
  keepWindow: boolean;
  checkPathsOnLaunch: boolean;
  missingStrategy: string;
  collapsedCategories: string[];
  newProjectCategoryId?: string | null;
}

export interface Bootstrap {
  projects: Project[];
  categories: Category[];
  tags: Tag[];
  runs: RunRecord[];
  settings: AppSettings;
  dataDir: string;
  dbPath: string;
  appVersion: string;
  loginPath: string;
}

export interface IpcErrorShape {
  code: string;
  message: string;
  projectId?: string;
  runId?: string;
}
