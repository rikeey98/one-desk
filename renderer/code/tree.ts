/**
 * 코드 칸의 파일 트리 (docs/sdlc/code-editor/ spec FR-8). git 목록은 파일 경로뿐이라 폴더는 경로에서 만든다.
 * 규칙은 전부 여기 있고 `FileTree`는 그리기만 한다(NFR-1).
 */
export interface TreeDir {
  name: string
  /** repo 상대, `/` 구분. 루트는 '' */
  path: string
  dirs: TreeDir[]
  files: { name: string; path: string }[]
}

export interface TreeRow {
  kind: 'dir' | 'file'
  name: string
  path: string
  depth: number
  /** 폴더가 펼쳐져 있는가. 파일은 늘 false */
  expanded: boolean
}

/** 폴더가 먼저, 이름순(대소문자 무시, 같으면 원래 글자순) */
function byName(a: { name: string }, b: { name: string }): number {
  const x = a.name.toLowerCase()
  const y = b.name.toLowerCase()
  if (x !== y) return x < y ? -1 : 1
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

export function buildTree(paths: readonly string[]): TreeDir {
  const root: TreeDir = { name: '', path: '', dirs: [], files: [] }
  // 폴더 경로 → 노드. 경로마다 조상을 한 번씩만 찾는다.
  const dirs = new Map<string, TreeDir>([['', root]])
  for (const path of paths) {
    const parts = path.split('/')
    let parent = root
    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join('/')
      let dir = dirs.get(dirPath)
      if (!dir) {
        dir = { name: parts[i]!, path: dirPath, dirs: [], files: [] }
        dirs.set(dirPath, dir)
        parent.dirs.push(dir)
      }
      parent = dir
    }
    parent.files.push({ name: parts[parts.length - 1]!, path })
  }
  for (const dir of dirs.values()) {
    dir.dirs.sort(byName)
    dir.files.sort(byName)
  }
  return root
}

/** 보이는 줄. 접힌 폴더의 아래는 훑지 않는다 — 5만 개 repo에서도 그리는 줄은 펼친 만큼이다(NFR-6). */
export function visibleRows(root: TreeDir, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (dir: TreeDir, depth: number): void => {
    for (const child of dir.dirs) {
      const open = expanded.has(child.path)
      rows.push({ kind: 'dir', name: child.name, path: child.path, depth, expanded: open })
      if (open) walk(child, depth + 1)
    }
    for (const file of dir.files) {
      rows.push({ kind: 'file', name: file.name, path: file.path, depth, expanded: false })
    }
  }
  walk(root, 0)
  return rows
}

/** 이 파일을 보이려면 펼쳐야 할 폴더들 — 대화록에서 연 파일을 트리에 드러낸다(FR-23) */
export function ancestorsOf(path: string): string[] {
  const parts = path.split('/')
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
}
