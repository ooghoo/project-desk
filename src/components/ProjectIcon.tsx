import type { LucideIcon } from "lucide-react";
import { Blocks, Code2, FolderClosed, Globe2, Hexagon, TerminalSquare } from "lucide-react";
import type { Project, ProjectType } from "../types";

const ICONS: Record<ProjectType, LucideIcon> = {
  web: Globe2,
  python: Code2,
  node: Hexagon,
  shell: TerminalSquare,
  other: FolderClosed,
};

export function typeIcon(type: ProjectType): LucideIcon {
  return ICONS[type] ?? Blocks;
}

export function ProjectIcon({
  project,
  size = 30,
  dim = false,
}: {
  project: Project;
  size?: number;
  dim?: boolean;
}) {
  const Icon = typeIcon(project.projectType);
  return (
    <span
      className={`p-icon p-icon-${project.projectType}${dim ? " is-dim" : ""}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
      aria-hidden
    >
      <Icon size={Math.round(size * 0.52)} strokeWidth={1.7} />
    </span>
  );
}
