/* ── State ───────────────────────────────────────────────────────────────── */
let allProjects = []
let currentProject = null
let currentPath = null

/* ── DOM refs ────────────────────────────────────────────────────────────── */
const sidebarEl = document.getElementById('sidebar')
const sidebarProjectsEl = document.getElementById('sidebar-projects')
const contentEl = document.getElementById('content')
const breadcrumbEl = document.getElementById('breadcrumb')
const tocEl = document.getElementById('toc')
const tocPanelEl = document.getElementById('toc-panel')
const searchEl = document.getElementById('search-input')
const statusEl = document.getElementById('connection-status')
const themeToggleEl = document.getElementById('theme-toggle')
const sidebarToggleEl = document.getElementById('sidebar-toggle')

/* ── Theme ───────────────────────────────────────────────────────────────── */
function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark'
  setTheme(saved)
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  themeToggleEl.textContent = theme === 'dark' ? '☀️' : '🌙'
  localStorage.setItem('theme', theme)
  // Re-render mermaid with correct theme if any diagrams are showing
  renderMermaid()
}

themeToggleEl.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme')
  setTheme(current === 'dark' ? 'light' : 'dark')
})

/* ── Sidebar toggle ──────────────────────────────────────────────────────── */
sidebarToggleEl.addEventListener('click', () => {
  sidebarEl.classList.toggle('collapsed')
})

/* ── Projects + sidebar ──────────────────────────────────────────────────── */
async function loadProjects() {
  try {
    const res = await fetch('/api/projects')
    const json = await res.json()
    allProjects = json.data || []
    renderSidebar(allProjects)
  } catch (e) {
    sidebarProjectsEl.innerHTML = '<div class="sidebar-loading">Failed to load projects</div>'
  }
}

function renderSidebar(projects) {
  sidebarProjectsEl.innerHTML = ''

  if (!projects.length) {
    sidebarProjectsEl.innerHTML = '<div class="sidebar-loading">No projects found</div>'
    return
  }

  for (const project of projects) {
    const section = createProjectSection(project)
    sidebarProjectsEl.appendChild(section)
    // Auto-open the project that has the active file
    if (project.name === currentProject) {
      section.classList.add('open')
      // Auto-open folder containing the current file
      autoOpenPath(section, currentPath)
    }
  }
}

function createProjectSection(project) {
  const section = document.createElement('div')
  section.className = 'project-section'
  section.dataset.project = project.name

  const header = document.createElement('div')
  header.className = 'project-header'
  header.innerHTML = `<span class="project-chevron">▶</span> ${project.name}`
  header.addEventListener('click', () => section.classList.toggle('open'))

  const tree = document.createElement('div')
  tree.className = 'project-tree'
  renderTree(tree, project.tree, project.name)

  section.appendChild(header)
  section.appendChild(tree)
  return section
}

function renderTree(container, nodes, project, depth = 0) {
  for (const node of nodes) {
    if (node.type === 'folder') {
      const folderDiv = document.createElement('div')
      folderDiv.className = 'tree-folder'
      folderDiv.dataset.path = node.path

      const label = document.createElement('div')
      label.className = 'tree-folder-label'
      label.innerHTML = `<span class="folder-chevron">▶</span> ${node.name}`
      label.addEventListener('click', () => folderDiv.classList.toggle('open'))

      const children = document.createElement('div')
      children.className = 'tree-children'
      renderTree(children, node.children || [], project, depth + 1)

      folderDiv.appendChild(label)
      folderDiv.appendChild(children)
      container.appendChild(folderDiv)
    } else {
      const fileEl = document.createElement('div')
      fileEl.className = 'tree-file'
      fileEl.dataset.path = node.path
      fileEl.dataset.project = project
      // Show name without .md extension for cleanliness
      fileEl.textContent = node.name.replace(/\.mdx?$/, '')
      fileEl.title = node.path
      fileEl.addEventListener('click', () => navigate(project, node.path))

      if (project === currentProject && node.path === currentPath) {
        fileEl.classList.add('active')
      }

      container.appendChild(fileEl)
    }
  }
}

function autoOpenPath(sectionEl, filePath) {
  if (!filePath) return
  const parts = filePath.split('/')
  if (parts.length <= 1) return  // file is at root level

  // Open folders along the path
  let container = sectionEl.querySelector('.project-tree')
  for (let i = 0; i < parts.length - 1; i++) {
    if (!container) break
    const folderEls = container.querySelectorAll(':scope > .tree-folder')
    for (const folderEl of folderEls) {
      if (folderEl.dataset.path && folderEl.dataset.path.endsWith(parts.slice(0, i + 1).join('/'))) {
        folderEl.classList.add('open')
        container = folderEl.querySelector('.tree-children')
        break
      }
    }
  }
}

/* ── Navigation ──────────────────────────────────────────────────────────── */
async function navigate(project, docPath) {
  currentProject = project
  currentPath = docPath

  // Update URL hash for bookmarkability
  const hash = `#${project}/${docPath}`
  if (location.hash !== hash) {
    history.pushState(null, '', hash)
  }

  // Update active state in sidebar
  document.querySelectorAll('.tree-file').forEach(el => {
    el.classList.toggle('active',
      el.dataset.project === project && el.dataset.path === docPath
    )
  })

  // Open parent folders
  const section = sidebarProjectsEl.querySelector(`.project-section[data-project="${project}"]`)
  if (section) {
    section.classList.add('open')
    autoOpenPath(section, docPath)
  }

  // Show loading
  contentEl.innerHTML = '<div class="loading">Loading…</div>'
  tocPanelEl.classList.remove('visible')
  updateBreadcrumb(project, docPath)

  try {
    const encodedPath = docPath.split('/').map(encodeURIComponent).join('/')
    const res = await fetch(`/api/render/${encodeURIComponent(project)}/${encodedPath}`)
    const json = await res.json()

    if (json.error) {
      contentEl.innerHTML = `<div class="error-msg">⚠ ${json.error}</div>`
      return
    }

    const { html, toc } = json.data
    contentEl.innerHTML = html

    // Render mermaid diagrams
    renderMermaid()

    // Build TOC
    buildToc(toc)

    // Scroll content to top
    contentEl.scrollTop = 0
  } catch (e) {
    contentEl.innerHTML = '<div class="error-msg">⚠ Failed to load document.</div>'
  }
}

function updateBreadcrumb(project, docPath) {
  const parts = docPath.split('/')
  const html = [
    `<span class="bc-project">${project}</span>`,
    ...parts.map((p, i) => {
      const name = p.replace(/\.mdx?$/, '')
      const cls = i === parts.length - 1 ? 'bc-part last' : 'bc-part'
      return `<span class="bc-sep">›</span><span class="${cls}">${name}</span>`
    }),
  ].join('')
  breadcrumbEl.innerHTML = html
}

/* ── Table of contents ───────────────────────────────────────────────────── */
function buildToc(items) {
  tocEl.innerHTML = ''

  if (!items || items.length < 2) {
    tocPanelEl.classList.remove('visible')
    return
  }

  for (const item of items) {
    const a = document.createElement('a')
    a.href = `#${item.id}`
    a.textContent = item.text
    a.className = `toc-h${item.level}`
    a.addEventListener('click', e => {
      e.preventDefault()
      const target = contentEl.querySelector(`#${CSS.escape(item.id)}`)
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    tocEl.appendChild(a)
  }

  tocPanelEl.classList.add('visible')

  // Highlight active heading on scroll
  setupTocScrollSpy()
}

function setupTocScrollSpy() {
  const headings = [...contentEl.querySelectorAll('h1[id], h2[id], h3[id]')]
  if (!headings.length) return

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        tocEl.querySelectorAll('a').forEach(a => a.classList.remove('active'))
        const active = tocEl.querySelector(`a[href="#${CSS.escape(entry.target.id)}"]`)
        if (active) active.classList.add('active')
      }
    }
  }, { rootMargin: '-10% 0px -80% 0px', root: contentEl })

  headings.forEach(h => observer.observe(h))
}

/* ── Mermaid ─────────────────────────────────────────────────────────────── */
function renderMermaid() {
  const diagrams = contentEl.querySelectorAll('.mermaid')
  if (!diagrams.length || typeof mermaid === 'undefined') return

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'

  mermaid.initialize({
    startOnLoad: false,
    theme: isDark ? 'dark' : 'default',
    securityLevel: 'loose',
  })

  // Reset already-rendered diagrams so mermaid can re-render them
  diagrams.forEach(el => {
    el.removeAttribute('data-processed')
    if (el.dataset.mermaidSrc) {
      el.textContent = el.dataset.mermaidSrc
    } else {
      el.dataset.mermaidSrc = el.textContent
    }
  })

  mermaid.run({ nodes: diagrams })
}

/* ── Search / filter ─────────────────────────────────────────────────────── */
searchEl.addEventListener('input', () => {
  const query = searchEl.value.toLowerCase().trim()

  document.querySelectorAll('.tree-file').forEach(el => {
    const name = el.textContent.toLowerCase()
    const path = (el.dataset.path || '').toLowerCase()
    const matches = !query || name.includes(query) || path.includes(query)
    el.classList.toggle('hidden', !matches)
  })

  // Auto-expand folders that have matching children
  if (query) {
    document.querySelectorAll('.tree-folder').forEach(folder => {
      const hasMatch = [...folder.querySelectorAll('.tree-file')]
        .some(f => !f.classList.contains('hidden'))
      folder.classList.toggle('open', hasMatch)
    })
    document.querySelectorAll('.project-section').forEach(section => {
      const hasMatch = [...section.querySelectorAll('.tree-file')]
        .some(f => !f.classList.contains('hidden'))
      section.classList.toggle('open', hasMatch)
    })
  }
})

/* ── Live reload (WebSocket) ─────────────────────────────────────────────── */
function setupLiveReload() {
  let ws
  let retryTimer

  function connect() {
    ws = new WebSocket(`ws://${location.host}`)

    ws.onopen = () => {
      statusEl.className = 'connected'
      statusEl.title = 'Live reload connected'
    }

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'reload' && currentProject && currentPath) {
        await navigate(currentProject, currentPath)
      } else if (data.type === 'refresh-tree') {
        await loadProjects()
      }
    }

    ws.onclose = () => {
      statusEl.className = 'disconnected'
      statusEl.title = 'Live reload disconnected — reconnecting…'
      clearTimeout(retryTimer)
      retryTimer = setTimeout(connect, 2000)
    }

    ws.onerror = () => ws.close()
  }

  connect()
}

/* ── Hash routing ────────────────────────────────────────────────────────── */
function parseHash() {
  const hash = location.hash.slice(1)  // remove '#'
  if (!hash) return null

  const slash = hash.indexOf('/')
  if (slash === -1) return null

  const project = decodeURIComponent(hash.slice(0, slash))
  const docPath = hash.slice(slash + 1)  // keep slashes as-is
  return { project, docPath }
}

window.addEventListener('popstate', () => {
  const route = parseHash()
  if (route) navigate(route.project, route.docPath)
})

/* ── Init ────────────────────────────────────────────────────────────────── */
async function init() {
  initTheme()
  await loadProjects()

  const route = parseHash()
  if (route) {
    await navigate(route.project, route.docPath)
  }

  setupLiveReload()
}

init()
