import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { ExternalLink, FileText, FolderSearch } from "lucide-react";
import { call } from "../lib/api";
import { useUi } from "../lib/ui";
import { Button, IconButton, Spinner } from "./primitives";
import type { Project, ReadmePayload } from "../types";

function Markdown({ content }: { content: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(content, { async: false }) as string;
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }, [content]);
  // eslint-disable-next-line react/no-danger
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** 项目说明：直接展示根目录 README 的 markdown 内容 */
export function ReadmePane({ project }: { project: Project }) {
  const ui = useUi();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ReadmePayload | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setData(null);
    call<ReadmePayload | null>("read_project_readme", { projectId: project.id })
      .then((result) => {
        if (alive) setData(result);
      })
      .catch(() => {
        if (alive) setData(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [project.id]);

  if (loading) {
    return (
      <div className="readme-empty">
        <Spinner /> 正在读取 README…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="readme-empty">
        <FileText size={22} />
        <strong>这个项目没有 README</strong>
        <p>
          在项目根目录放一个 <code>README.md</code>，这里会直接显示它的内容。
          <br />
          当前根目录：<span className="is-mono">{project.rootPath}</span>
        </p>
      </div>
    );
  }

  const openFile = async (reveal: boolean) => {
    try {
      await call("open_path", { path: data.path, reveal });
    } catch (err) {
      ui.toast(err instanceof Error ? err.message : "打开失败", "error");
    }
  };

  return (
    <div className="readme-pane">
      <div className="readme-bar">
        <FileText size={13} />
        <span className="readme-name">{data.fileName}</span>
        {data.truncated && <span className="meta-dim">内容过长，仅显示前 256 KB</span>}
        <div className="readme-actions">
          <Button size="sm" icon={<ExternalLink size={11} />} onClick={() => openFile(false)}>
            用默认应用打开
          </Button>
          <IconButton label="在 Finder 中显示" onClick={() => openFile(true)}>
            <FolderSearch size={13} />
          </IconButton>
        </div>
      </div>
      <div className="readme-body">
        <Markdown content={data.content} />
      </div>
    </div>
  );
}
