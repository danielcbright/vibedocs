import { Folder } from "lucide-react"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import type { FileNode, ProjectInfo } from "@/hooks/use-projects"

interface ProjectPickerProps {
  projects: ProjectInfo[]
  onNavigate: (project: string, path: string) => void
}

/**
 * Recursively counts the markdown files in a project tree, excluding assets
 * and non-markdown files. Used to render "N docs" subtitles in the picker.
 */
export function countMarkdownDocs(nodes: FileNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (
      node.type === "file" &&
      !node.isAsset &&
      (node.path.endsWith(".md") || node.path.endsWith(".markdown"))
    ) {
      count += 1
    }
    if (node.type === "folder" && node.children) {
      count += countMarkdownDocs(node.children)
    }
  }
  return count
}

export function ProjectPicker({ projects, onNavigate }: ProjectPickerProps) {
  return (
    <Empty className="border-0 p-6 md:p-12">
      <EmptyHeader className="max-w-none">
        <EmptyTitle>Browse a project</EmptyTitle>
        <EmptyDescription>
          {projects.length} {projects.length === 1 ? "project" : "projects"} in this workspace
        </EmptyDescription>
      </EmptyHeader>
      <div className="grid w-full max-w-5xl grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => {
          const docCount = countMarkdownDocs(project.tree)
          return (
            <Card
              key={project.name}
              data-testid="project-picker-card"
              role="button"
              tabIndex={0}
              onClick={() => onNavigate(project.name, "")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  onNavigate(project.name, "")
                }
              }}
              className="cursor-pointer text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Open ${project.name}`}
            >
              <CardHeader>
                <Folder className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                <CardTitle>{project.name}</CardTitle>
                <CardDescription>
                  {docCount} {docCount === 1 ? "doc" : "docs"}
                </CardDescription>
              </CardHeader>
            </Card>
          )
        })}
      </div>
    </Empty>
  )
}
