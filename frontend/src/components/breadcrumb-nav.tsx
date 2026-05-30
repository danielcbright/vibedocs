import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown, Folder, FileText } from "lucide-react"
import { Fragment } from "react"
import type { FileNode } from "@/hooks/use-projects"

interface BreadcrumbNavProps {
  project: string | null
  docPath: string | null
  /** Active project's file tree. When provided, folder/project segments
   *  render a dropdown listing direct children. */
  tree?: FileNode[]
  onNavigate?: (project: string, path: string) => void
}

function findNodeAt(nodes: FileNode[], path: string): FileNode | null {
  for (const n of nodes) {
    if (n.path === path) return n
    if (n.type === "folder" && n.children) {
      const found = findNodeAt(n.children, path)
      if (found) return found
    }
  }
  return null
}

// Direct children at a given folder path. Empty path → tree root.
function getFolderChildren(tree: FileNode[], path: string): FileNode[] {
  if (!path) return tree
  const node = findNodeAt(tree, path)
  return node?.type === "folder" ? node.children ?? [] : []
}

function DirectoryDropdown({
  label,
  children,
  onPick,
}: {
  label: string
  children: FileNode[]
  onPick: (path: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="tap-target tap-active-feedback inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-foreground">
        <span>{label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[60vh] overflow-y-auto">
        {children.length === 0 ? (
          <DropdownMenuItem disabled>(empty)</DropdownMenuItem>
        ) : (
          children.map((c) => {
            const Icon = c.type === "folder" ? Folder : FileText
            return (
              <DropdownMenuItem key={c.path} onSelect={() => onPick(c.path)}>
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{c.name}</span>
              </DropdownMenuItem>
            )
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function BreadcrumbNav({ project, docPath, tree, onNavigate }: BreadcrumbNavProps) {
  if (!project || !docPath) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage className="text-muted-foreground">
              Select a document
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    )
  }

  const parts = docPath.split("/")
  const projectTree = tree ?? []

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink
            href="#"
            onClick={(e) => {
              e.preventDefault()
              window.location.hash = ""
            }}
          >
            Projects
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          {/* The project segment is always a DirectoryDropdown rooted at the
              project tree, regardless of how deep docPath goes. At
              single-segment paths the user still needs a way to browse
              sibling root-level files without backtracking to the picker. */}
          <DirectoryDropdown
            label={project}
            children={projectTree}
            onPick={(childPath) => onNavigate?.(project, childPath)}
          />
        </BreadcrumbItem>
        {parts.map((part, i) => {
          const isLast = i === parts.length - 1
          const partialPath = parts.slice(0, i + 1).join("/")

          return (
            <Fragment key={i}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage className="font-medium">{part}</BreadcrumbPage>
                ) : (
                  <DirectoryDropdown
                    label={part}
                    children={getFolderChildren(projectTree, partialPath)}
                    onPick={(childPath) => onNavigate?.(project, childPath)}
                  />
                )}
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
