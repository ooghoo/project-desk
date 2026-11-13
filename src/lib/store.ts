import { useSyncExternalStore } from "react";
import { call } from "./api";
import type {
  AppSettings,
  Bootstrap,
  Category,
  ConfigInput,
  LaunchConfig,
  LaunchOutcome,
  ManifestReport,
  Project,
  ProjectType,
  RunRecord,
  Tag,
  PathIssue,
} from "../types";

export type NavKind = "all" | "recent" | "favorite" | "running" | "category" | "settings";
export type SortKey = "recent" | "name" | "created" | "manual";

export interface Nav {
  kind: NavKind;
  categoryId?: string | null;
}

export interface State {
  ready: boolean;
  bootError: string | null;
  projects: Project[];
  categories: Category[];
  tags: Tag[];
  runs: RunRecord[];
  projectRuns: RunRecord[];
  configs: LaunchConfig[];
  pathIssues: PathIssue[];
  settings: AppSettings;
  dataDir: string;
  dbPath: string;
  appVersion: string;
  loginPath: string;
  nav: Nav;
  selectedProjectId: string | null;
  selectedRunId: string | null;
  /** 当前在终端面板里查看的运行 */
  activeRunId: string | null;
  query: string;
  typeFilter: ProjectType | null;
  tagFilter: string | null;
  detailVisible: boolean;
  loadingProject: boolean;
}

const defaultSettings: AppSettings = {
  theme: "system",
  view: "list",
  startup: "last",
  restoreWorkspace: true,
  sidebarWidth: 236,
  listWidth: 348,
  showDetail: true,
  sort: "recent",
  sortDirection: "desc",
  lastProjectId: null,
  lastNav: "all",
  pythonInterpreters: [],
  defaultTerminal: "Terminal",
  defaultPort: 8000,
  keepWindow: true,
  checkPathsOnLaunch: true,
  missingStrategy: "keep",
  collapsedCategories: [],
};

export const initialState: State = {
  ready: false,
  bootError: null,
  projects: [],
  categories: [],
  tags: [],
  runs: [],
  projectRuns: [],
  configs: [],
  pathIssues: [],
  settings: defaultSettings,
  dataDir: "",
  dbPath: "",
  appVersion: "",
  loginPath: "",
  nav: { kind: "all" },
  selectedProjectId: null,
  selectedRunId: null,
  activeRunId: null,
  query: "",
  typeFilter: null,
  tagFilter: null,
  detailVisible: true,
  loadingProject: false,
};

let state: State = initialState;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  emit();
}

export function getState(): State {
  return state;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useAppState(): State {
  return useSyncExternalStore(subscribe, getState, getState);
}

/* ------------------------------------------------------------------ */
/* 导航编码                                                            */
/* ------------------------------------------------------------------ */

export function navToKey(nav: Nav): string {
  if (nav.kind === "category") return `category:${nav.categoryId ?? "__none__"}`;
  return nav.kind;
}

export function keyToNav(key: string | null | undefined): Nav {
  if (!key) return { kind: "all" };
  if (key.startsWith("category:")) {
    const raw = key.slice(9);
    return { kind: "category", categoryId: raw === "__none__" || raw === "null" ? null : raw };
  }
  if (["all", "recent", "favorite", "running", "settings"].includes(key)) {
    return { kind: key as NavKind };
  }
  return { kind: "all" };
}

/* ------------------------------------------------------------------ */
/* 派生数据                                                            */
/* ------------------------------------------------------------------ */

export function activeRuns(runs: RunRecord[]): RunRecord[] {
  return runs.filter((r) => ["requested", "started", "running"].includes(r.status));
}

export function projectActiveRun(state: State, projectId: string): RunRecord | undefined {
  return activeRuns(state.runs).find((r) => r.projectId === projectId);
}

function lastUsed(p: Project): number {
  const docs = [p.lastOpenedAt, p.lastRunAt, p.updatedAt];
  const times = docs
    .map((d) => (d ? new Date(d).getTime() : 0))
    .filter((n) => Number.isFinite(n));
  return times.length ? Math.max(...times) : 0;
}

export function visibleProjects(s: State): Project[] {
  const q = s.query.trim().toLowerCase();
  let list = s.projects.filter((p) => {
    if (s.nav.kind === "favorite" && !p.isFavorite) return false;
    if (s.nav.kind === "category" && (p.categoryId ?? null) !== (s.nav.categoryId ?? null)) return false;
    if (s.nav.kind === "recent" && !p.lastOpenedAt && !p.lastRunAt) return false;
    if (s.nav.kind === "running" && !projectActiveRun(s, p.id)) return false;
    if (s.typeFilter && p.projectType !== s.typeFilter) return false;
    if (s.tagFilter && !p.tags.some((t) => t.name === s.tagFilter)) return false;
    if (q) {
      const haystack = [p.name, p.rootPath, p.notes ?? "", ...p.tags.map((t) => t.name)]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const dir = s.settings.sortDirection === "asc" ? 1 : -1;
  const sort = s.nav.kind === "recent" ? "recent" : s.settings.sort;
  list = [...list].sort((a, b) => {
    if (sort === "name") {
      return a.name.localeCompare(b.name, "zh-Hans-CN") * dir;
    }
    if (sort === "created") {
      return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
    }
    if (sort === "manual") {
      return a.sortOrder - b.sortOrder;
    }
    return (lastUsed(a) - lastUsed(b)) * dir;
  });
  return list;
}

export function navTitle(s: State): string {
  switch (s.nav.kind) {
    case "all":
      return "所有项目";
    case "recent":
      return "最近使用";
    case "favorite":
      return "收藏项目";
    case "running":
      return "正在运行";
    case "settings":
      return "设置";
    case "category":
      return s.categories.find((c) => c.id === s.nav.categoryId)?.name ?? "未分类";
  }
}

export function selectedProject(s: State): Project | null {
  return s.projects.find((p) => p.id === s.selectedProjectId) ?? null;
}

/* ------------------------------------------------------------------ */
/* 动作                                                               */
/* ------------------------------------------------------------------ */

let settingsTimer: ReturnType<typeof setTimeout> | null = null;

export const actions = {
  async init() {
    try {
      const boot = await call<Bootstrap>("bootstrap");
      const nav = boot.settings.restoreWorkspace
        ? keyToNav(boot.settings.lastNav)
        : { kind: boot.settings.startup === "favorite" ? "favorite" : boot.settings.startup === "recent" ? "recent" : "all" } as Nav;
      const selected =
        boot.settings.restoreWorkspace && boot.settings.lastProjectId
          ? boot.projects.find((p) => p.id === boot.settings.lastProjectId)?.id ?? null
          : null;
      const initialId = selected ?? boot.projects[0]?.id ?? null;
      set({
        ready: true,
        projects: boot.projects,
        categories: boot.categories,
        tags: boot.tags,
        runs: boot.runs,
        settings: boot.settings,
        dataDir: boot.dataDir,
        dbPath: boot.dbPath,
        appVersion: boot.appVersion,
        loginPath: boot.loginPath,
        nav,
        selectedProjectId: initialId,
        detailVisible: boot.settings.showDetail,
      });
      if (initialId) {
        await actions.loadProjectDetail(initialId);
      }
      await actions.checkPaths();
    } catch (err) {
      set({ ready: true, bootError: err instanceof Error ? err.message : String(err) });
    }
  },

  async checkPaths() {
    try {
      const issues = await call<PathIssue[]>("check_project_paths");
      await actions.refreshProjects();
      set({ pathIssues: issues });
    } catch {
      /* 路径检查失败不阻塞主流程 */
    }
  },

  async refreshProjects() {
    const [projects, categories, tags] = await Promise.all([
      call<Project[]>("list_projects"),
      call<Category[]>("list_categories"),
      call<Tag[]>("list_tags"),
    ]);
    set({
      projects,
      categories,
      tags,
      pathIssues: projects
        .filter((p) => p.pathStatus === "missing")
        .map((p) => ({
          projectId: p.id,
          name: p.name,
          rootPath: p.rootPath,
          status: p.pathStatus,
        })),
    });
  },

  async refreshRuns() {
    const runs = await call<RunRecord[]>("list_runs", { projectId: null, limit: 120 });
    set({ runs });
    if (state.selectedProjectId) {
      const projectRuns = await call<RunRecord[]>("list_runs", {
        projectId: state.selectedProjectId,
        limit: 40,
      });
      set({ projectRuns });
    }
  },

  async loadProjectDetail(projectId: string) {
    set({ loadingProject: true });
    try {
      const [configs, projectRuns] = await Promise.all([
        call<LaunchConfig[]>("list_configs", { projectId }),
        call<RunRecord[]>("list_runs", { projectId, limit: 40 }),
      ]);
      if (state.selectedProjectId === projectId) {
        set({ configs, projectRuns, loadingProject: false });
      }
    } catch (err) {
      set({ loadingProject: false });
      throw err;
    }
  },

  /** 重新从项目根目录的 launcher.json 同步运行配置。
   *  仅刷新 manifest 来源的配置，用户手动创建的配置不受影响。 */
  async syncLauncherConfig(projectId: string) {
    const report = await call<ManifestReport>("sync_launcher_config", { id: projectId });
    if (state.selectedProjectId === projectId) {
      const configs = await call<LaunchConfig[]>("list_configs", { projectId });
      set({ configs });
    }
    return report;
  },

  async selectProject(projectId: string | null) {
    // 只切换选中态：不更新 lastOpenedAt，列表顺序保持稳定（选中不会跳到最上方）
    set({ selectedProjectId: projectId, selectedRunId: null, configs: [], projectRuns: [] });
    if (projectId) {
      actions.persistLast({ lastProjectId: projectId });
      await actions.loadProjectDetail(projectId);
    }
  },

  setNav(nav: Nav) {
    set({ nav });
    actions.persistLast({ lastNav: navToKey(nav) });
    if (nav.kind === "running") {
      actions.refreshRuns().catch(() => {});
      const first = activeRuns(state.runs)[0];
      set({ selectedRunId: first?.id ?? state.runs[0]?.id ?? null });
    }
  },

  setQuery(query: string) {
    set({ query });
  },

  setTypeFilter(type: ProjectType | null) {
    set({ typeFilter: type });
  },

  setTagFilter(tag: string | null) {
    set({ tagFilter: tag });
  },

  setView(view: "list" | "grid") {
    set({ settings: { ...state.settings, view } });
    actions.persistSettings({ view });
  },

  setSort(sort: SortKey, direction?: "asc" | "desc") {
    const dir = direction ?? (sort === "name" ? "asc" : "desc");
    set({ settings: { ...state.settings, sort, sortDirection: dir } });
    actions.persistSettings({ sort, sortDirection: dir });
  },

  toggleDetail() {
    const next = !state.detailVisible;
    set({ detailVisible: next });
    actions.persistSettings({ showDetail: next });
  },

  setPanelWidths(sidebarWidth: number, listWidth: number) {
    set({ settings: { ...state.settings, sidebarWidth, listWidth } });
    actions.persistSettings({ sidebarWidth, listWidth });
  },

  updateLocalSettings(patch: Partial<AppSettings>) {
    set({ settings: { ...state.settings, ...patch } });
  },

  persistSettings(patch: Partial<AppSettings>) {
    actions.updateLocalSettings(patch);
    if (settingsTimer) clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      call("save_settings", { settings: state.settings }).catch(() => {});
    }, 320);
  },

  persistLast(patch: Partial<AppSettings>) {
    if (!state.settings.restoreWorkspace) {
      set({ settings: { ...state.settings, ...patch } });
      return;
    }
    set({ settings: { ...state.settings, ...patch } });
    call("save_settings", { settings: state.settings }).catch(() => {});
  },

  async addProject(input: {
    name: string;
    rootPath: string;
    projectType: ProjectType;
    categoryId: string | null;
    tags: string[];
    config?: ConfigInput | null;
  }): Promise<Project> {
    const project = await call<Project>("add_project", { input });
    await actions.refreshProjects();
    set({ selectedProjectId: project.id, nav: { kind: "all" }, detailVisible: true });
    await actions.loadProjectDetail(project.id);
    return project;
  },

  async updateProject(id: string, patch: Record<string, unknown>): Promise<Project> {
    const project = await call<Project>("update_project", { id, patch });
    await actions.refreshProjects();
    return project;
  },

  async renameProject(id: string, name: string): Promise<Project> {
    const project = await call<Project>("rename_project", { id, name });
    await actions.refreshProjects();
    return project;
  },

  async setFavorite(id: string, favorite: boolean) {
    await actions.updateProject(id, { isFavorite: favorite });
  },

  async setCategory(id: string, categoryId: string | null) {
    await actions.updateProject(id, { categoryId });
  },

  async reorderProjects(ids: string[]) {
    await call("reorder_projects", { ids });
    await actions.refreshProjects();
  },

  async setTags(projectId: string, tags: string[]) {
    await call<Project>("set_project_tags", { id: projectId, tags });
    await actions.refreshProjects();
  },

  async removeProject(id: string, stopRunning = false) {
    await call<string[]>("remove_project", { id, stopRunning });
    const nextSelection = state.projects.find((p) => p.id !== id)?.id ?? null;
    await actions.refreshProjects();
    await actions.refreshRuns();
    if (state.selectedProjectId === id) {
      set({ selectedProjectId: nextSelection, configs: [], projectRuns: [] });
      if (nextSelection) await actions.loadProjectDetail(nextSelection);
    }
  },

  async relocateProject(id: string, newPath: string) {
    const project = await call<Project>("relocate_project", { id, newPath });
    await actions.refreshProjects();
    await actions.loadProjectDetail(project.id);
    return project;
  },

  async runProject(
    projectId: string,
    configId?: string | null,
    size?: { cols: number; rows: number },
  ): Promise<LaunchOutcome> {
    const outcome = await call<LaunchOutcome>("run_project", {
      projectId,
      configId: configId ?? null,
      cols: size?.cols ?? null,
      rows: size?.rows ?? null,
    });
    if (outcome.kind === "run") set({ activeRunId: outcome.run.id });
    await actions.refreshRuns();
    await actions.loadProjectDetail(projectId);
    return outcome;
  },

  setActiveRun(runId: string | null) {
    set({ activeRunId: runId });
  },

  async stopRun(runId: string) {
    const run = await call<RunRecord>("stop_run", { runId });
    await actions.refreshRuns();
    if (state.selectedProjectId) await actions.loadProjectDetail(state.selectedProjectId);
    return run;
  },

  async saveConfig(projectId: string, configId: string | null, input: ConfigInput) {
    const cfg = await call<LaunchConfig>("save_config", { projectId, configId, input });
    await actions.loadProjectDetail(projectId);
    await actions.refreshProjects();
    return cfg;
  },

  async deleteConfig(projectId: string, configId: string) {
    await call("delete_config", { id: configId });
    await actions.loadProjectDetail(projectId);
    await actions.refreshProjects();
  },

  async createCategory(name: string): Promise<Category[]> {
    const cats = await call<Category[]>("create_category", { name });
    set({ categories: cats });
    return cats;
  },

  async renameCategory(id: string, name: string) {
    const cats = await call<Category[]>("rename_category", { id, name });
    set({ categories: cats });
  },

  async deleteCategory(id: string) {
    const cats = await call<Category[]>("delete_category", { id });
    set({ categories: cats });
    await actions.refreshProjects();
    if (state.nav.kind === "category" && state.nav.categoryId === id) {
      set({ nav: { kind: "all" } });
    }
  },

  async saveSettings(next: AppSettings) {
    const saved = await call<AppSettings>("save_settings", { settings: next });
    set({ settings: saved });
    return saved;
  },

  async clearRunHistory() {
    await call("clear_run_history");
    await actions.refreshRuns();
  },

  async tick() {
    const hasActive = activeRuns(state.runs).length > 0;
    if (!hasActive && state.nav.kind !== "running") return;
    try {
      await actions.refreshRuns();
    } catch {
      /* 轮询失败静默，避免打断用户 */
    }
  },
};
