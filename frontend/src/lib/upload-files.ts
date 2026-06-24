/**
 * POSTs files to the upload endpoint for a project folder. Path segments are
 * encoded individually so slashes stay as path separators while each segment
 * is escaped. Shared by the per-folder upload button and the sidebar toolbar.
 */
export async function uploadFiles(
  project: string,
  folderPath: string,
  files: FileList,
) {
  const formData = new FormData()
  for (const file of Array.from(files)) {
    formData.append("files", file)
  }
  const encodedPath = folderPath.split("/").map(encodeURIComponent).join("/")
  const res = await fetch(
    `/api/upload/${encodeURIComponent(project)}/${encodedPath}`,
    {
      method: "POST",
      body: formData,
    },
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Upload failed" }))
    throw new Error(err.error || "Upload failed")
  }
  return res.json()
}
