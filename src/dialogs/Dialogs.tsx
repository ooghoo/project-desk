import { useMemo, useState } from "react";
import { Check, FolderSearch, Plus, X, Tag as TagIcon, AlertTriangle } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { actions, useAppState } from "../lib/store";
import { useUi } from "../lib/ui";
import { TYPE_LABEL } from "../lib/format";
import { Button, Field, Modal } from "../components/primitives";
import type { Project, ProjectType } from "../types";
import { AddProjectDialog } from "./AddProjectDialog";
import { ConfigEditor } from "./ConfigEditor";

export function DialogHost() {
  const ui = useUi();
  const dialog = ui.dialog;
  if (!dialog) return null;
  switch (dialog.kind) {
    case "confirm":
      return (
        <Modal
          title={dialog.title}
          onClose={() => ui.closeDialog(false)}
          width={460}
          footer={
            <>
              <Button onClick={() => ui.closeDialog(false)}>{dialog.cancelText ?? "取消"}</Button>
              <Button
                variant={dialog.danger ? "danger" : "primary"}
                onClick={() => ui.closeDialog(true)}
              >
                {dialog.confirmText ?? "确定"}
              </Button>
            </>
          }
        >
          {dialog.message && <p className="dialog-text">{dialog.message}</p>}
          {dialog.details && (
            <ul className="dialog-details">
              {dialog.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </Modal>
      );

    case "alert":
      return (
        <Modal
          title={dialog.title}
          onClose={() => ui.closeDialog()}
          width={480}
          footer={
            <Button variant="primary" onClick={() => ui.closeDialog()}>
              知道了
            </Button>
          }
        >
          {dialog.message && <p className="dialog-text">{dialog.message}</p>}
          {dialog.details && (
            <ul className="dialog-details is-scroll">
              {dialog.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </Modal>
      );

    case "prompt":
      return <PromptDialog dialog={dialog} />;
    case "rename":
      return <ProjectInfoDialog project={dialog.project} />;
    case "tags":
      return <TagsDialog project={dialog.project} />;
    case "category":
      return <CategoryDialog project={dialog.project} />;
    case "relocate":
      return <RelocateDialog project={dialog.project} />;
    case "newCategory":
      return <NewCategoryDialog />;
    case "add":
      // key 必须随拖入路径变化：否则在「添加项目」对话框已打开时再拖入文件夹，
      // React 会复用同一个组件实例，useState 的初始值不会重新计算，看起来就像"拖入无效"。
      return (
        <AddProjectDialog
          key={(dialog.paths ?? []).join("|") || "add-empty"}
          paths={dialog.paths}
        />
      );
    case "config":
      return <ConfigEditor project={dialog.project} config={dialog.config} />;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */

function PromptDialog({ dialog }: { dialog: { title: string; label?: string; value?: string; placeholder?: string; multiline?: boolean; confirmText?: string } }) {
  const ui = useUi();
  const [value, setValue] = useState(dialog.value ?? "");
  return (
    <Modal
      title={dialog.title}
      onClose={() => ui.closeDialog(null)}
      width={460}
      footer={
        <>
          <Button onClick={() => ui.closeDialog(null)}>取消</Button>
          <Button variant="primary" disabled={!value.trim()} onClick={() => ui.closeDialog(value.trim())}>
            {dialog.confirmText ?? "确定"}
          </Button>
        </>
      }
    >
      <Field label={dialog.label ?? "名称"}>
        {dialog.multiline ? (
          <textarea
            className="textarea"
            rows={4}
            value={value}
            placeholder={dialog.placeholder}
            onChange={(e) => setValue(e.target.value)}
          />
        ) : (
          <input
            className="input"
            value={value}
            placeholder={dialog.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) ui.closeDialog(value.trim());
            }}
          />
        )}
      </Field>
    </Modal>
  );
}

function ProjectInfoDialog({ project }: { project: Project }) {
  const ui = useUi();
  const s = useAppState();
  const [name, setName] = useState(project.name);
  const [type, setType] = useState<ProjectType>(project.projectType);
  const [categoryId, setCategoryId] = useState(project.categoryId ?? "");
  const [notes, setNotes] = useState(project.notes ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await actions.updateProject(project.id, {
        name: name.trim(),
        projectType: type,
        categoryId: categoryId || null,
        notes: notes.trim() || null,
      });
      ui.toast("项目信息已更新", "success");
      ui.closeDialog();
    } catch (err) {
      ui.toast(err instanceof Error ? err.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="编辑项目信息"
      subtitle={`${project.rootPath}`}
      onClose={() => ui.closeDialog()}
      width={520}
      footer={
        <>
          <Button onClick={() => ui.closeDialog()}>取消</Button>
          <Button variant="primary" onClick={save} disabled={saving || !name.trim()}>
            保存
          </Button>
        </>
      }
    >
      <Field label="显示名称" hint="只修改应用内名称，不会重命名磁盘上的文件夹。">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) void save();
          }}
        />
      </Field>
      <Field label="项目类型">
        <select className="select" value={type} onChange={(e) => setType(e.target.value as ProjectType)}>
          {(Object.keys(TYPE_LABEL) as ProjectType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="分类">
        <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">未分类</option>
          {s.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="备注" hint="仅保存在本机数据库中。">
        <textarea
          className="textarea"
          rows={3}
          value={notes}
          placeholder="例如：客户项目，发布前需要跑 build"
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
    </Modal>
  );
}

function TagsDialog({ project }: { project: Project }) {
  const ui = useUi();
  const s = useAppState();
  const [tags, setTags] = useState<string[]>(project.tags.map((t) => t.name));
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  const all = useMemo(() => {
    const set = new Set(s.tags.map((t) => t.name));
    tags.forEach((t) => set.add(t));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }, [s.tags, tags]);

  const add = (raw: string) => {
    const value = raw.trim().replace(/^#/, "");
    if (!value || tags.includes(value)) return;
    setTags([...tags, value]);
    setInput("");
  };

  const save = async () => {
    setSaving(true);
    try {
      await actions.setTags(project.id, tags);
      ui.toast("标签已更新", "success");
      ui.closeDialog();
    } catch (err) {
      ui.toast(err instanceof Error ? err.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="管理标签"
      subtitle={project.name}
      onClose={() => ui.closeDialog()}
      width={480}
      footer={
        <>
          <Button onClick={() => ui.closeDialog()}>取消</Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            保存
          </Button>
        </>
      }
    >
      <div className="tag-editor">
        <div className="tag-editor-input">
          <TagIcon size={13} />
          <input
            className="input bare"
            value={input}
            placeholder="输入标签后回车"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(input);
              }
              if (e.key === "Backspace" && !input && tags.length) {
                setTags(tags.slice(0, -1));
              }
            }}
          />
          <Button size="sm" onClick={() => add(input)} disabled={!input.trim()}>
            添加
          </Button>
        </div>
        <div className="tag-cloud">
          {tags.length === 0 && <span className="setting-empty">还没有标签</span>}
          {tags.map((t) => (
            <span key={t} className="tag-chip is-removable">
              #{t}
              <button onClick={() => setTags(tags.filter((x) => x !== t))} title="移除">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        {all.length > 0 && (
          <div className="tag-suggest">
            <span className="tag-suggest-label">已有标签</span>
            <div className="tag-cloud">
              {all
                .filter((t) => !tags.includes(t))
                .map((t) => (
                  <button key={t} className="tag-chip is-ghost" onClick={() => add(t)}>
                    #{t}
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function CategoryDialog({ project }: { project: Project }) {
  const ui = useUi();
  const s = useAppState();
  const [busy, setBusy] = useState<string | null>(null);

  const pick = async (categoryId: string | null) => {
    setBusy(categoryId ?? "__none__");
    try {
      await actions.setCategory(project.id, categoryId);
      ui.toast("分类已更新", "success");
      ui.closeDialog();
    } catch (err) {
      ui.toast(err instanceof Error ? err.message : "更新失败", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title="修改分类"
      subtitle={project.name}
      onClose={() => ui.closeDialog()}
      width={420}
      footer={
        <Button
          icon={<Plus size={12} />}
          onClick={async () => {
            const name = await ui.prompt({ title: "新建分类", label: "分类名称", placeholder: "例如：客户项目" });
            if (!name) return;
            try {
              await actions.createCategory(name);
              ui.toast("分类已创建", "success");
            } catch (err) {
              ui.toast(err instanceof Error ? err.message : "创建失败", "error");
            }
          }}
        >
          新建分类
        </Button>
      }
    >
      <div className="choice-list">
        <button
          className={`choice-row${!project.categoryId ? " is-active" : ""}`}
          onClick={() => pick(null)}
        >
          <span>未分类</span>
          {!project.categoryId && <Check size={14} />}
        </button>
        {s.categories.map((c) => (
          <button
            key={c.id}
            className={`choice-row${project.categoryId === c.id ? " is-active" : ""}`}
            onClick={() => pick(c.id)}
            disabled={busy !== null}
          >
            <span>
              {c.name}
              <em>{c.projectCount} 个项目</em>
            </span>
            {project.categoryId === c.id && <Check size={14} />}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function NewCategoryDialog() {
  const ui = useUi();
  return (
    <Modal
      title="新建分类"
      subtitle="分类只存在于应用内，与磁盘目录无关。"
      onClose={() => ui.closeDialog()}
      width={420}
      footer={null}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const input = (e.currentTarget.elements.namedItem("cat-name") as HTMLInputElement).value;
          if (!input.trim()) return;
          try {
            await actions.createCategory(input.trim());
            ui.toast("分类已创建", "success");
            ui.closeDialog();
          } catch (err) {
            ui.toast(err instanceof Error ? err.message : "创建失败", "error");
          }
        }}
      >
        <Field label="分类名称">
          <input className="input" name="cat-name" placeholder="例如：客户项目" autoFocus />
        </Field>
        <div className="form-actions">
          <Button type="button" onClick={() => ui.closeDialog()}>
            取消
          </Button>
          <Button type="submit" variant="primary">
            创建
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RelocateDialog({ project }: { project: Project }) {
  const ui = useUi();
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async () => {
    const dir = await openDialog({
      title: `重新定位「${project.name}」`,
      directory: true,
      multiple: false,
      defaultPath: project.rootPath,
    });
    if (typeof dir === "string") {
      setPicked(dir);
      setError(null);
    }
  };

  const apply = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await actions.relocateProject(project.id, picked);
      ui.toast("项目已重新定位", "success");
      ui.closeDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "重新定位失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="重新定位项目"
      onClose={() => ui.closeDialog()}
      width={520}
      footer={
        <>
          <Button onClick={() => ui.closeDialog()}>取消</Button>
          <Button variant="primary" onClick={apply} disabled={!picked || busy}>
            重新定位
          </Button>
        </>
      }
    >
      <div className="relocate-block">
        <span className="info-label">原路径</span>
        <code className="path-box is-missing">{project.rootPath}</code>
        <Button size="sm" icon={<FolderSearch size={12} />} onClick={choose}>
          选择新的项目文件夹
        </Button>
        {picked && (
          <>
            <span className="info-label">新路径</span>
            <code className="path-box">{picked}</code>
          </>
        )}
        <p className="dialog-text">
          重新定位只更新真实路径，项目 ID、显示名称、分类、标签、收藏状态与运行配置都会保留。
        </p>
        {error && (
          <div className="inline-error">
            <AlertTriangle size={13} /> {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
