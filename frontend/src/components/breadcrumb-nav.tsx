import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Fragment } from "react"

interface BreadcrumbNavProps {
  project: string | null
  docPath: string | null
  onNavigate?: (project: string, path: string) => void
}

export function BreadcrumbNav({ project, docPath, onNavigate }: BreadcrumbNavProps) {
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
          {parts.length > 1 ? (
            <BreadcrumbLink
              href="#"
              onClick={(e) => {
                e.preventDefault()
                // Navigate to the first root-level file in this project
                // For now, just clear to project level
                window.location.hash = project
              }}
            >
              {project}
            </BreadcrumbLink>
          ) : (
            <BreadcrumbPage className="font-medium">{project}</BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {parts.map((part, i) => {
          const isLast = i === parts.length - 1
          // Build the partial path up to this segment
          const partialPath = parts.slice(0, i + 1).join("/")

          return (
            <Fragment key={i}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage className="font-medium">{part}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      // Navigate to the folder level — append first child if it's a folder
                      // For now just show the folder path in the hash
                      if (onNavigate) {
                        onNavigate(project, partialPath)
                      }
                    }}
                  >
                    {part}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
