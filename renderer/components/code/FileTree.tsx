import { useState, type KeyboardEvent } from 'react'
import { IconChevronRight, IconFile } from '../icons'
import type { TreeRow } from '../../code/tree'
import type { FileHit } from '@shared/models'

/**
 * 코드 칸의 트리와 찾기 (docs/sdlc/code-editor/ FR-8·FR-9). **그리기만 한다** — 줄은 `code/tree.ts`가, 퍼지 결과는
 * `@` 피커와 같은 `files.search`(`useFileSearch`)가 만든다. 펼침은 스토어가 쥔다. 여기 state는 찾기 결과에서 고른 줄뿐이다.
 */
export function FileTree({ rows, openPath, dirtyPaths, query, onQueryChange, search, onToggleDir, onOpenFile }: {
  rows: TreeRow[]
  openPath: string | null
  /** 저장하지 않은 파일 — 줄에 점이 선다(FR-20) */
  dirtyPaths: ReadonlySet<string>
  query: string
  onQueryChange: (query: string) => void
  /** 찾기 결과. 질의가 비면 null — 트리를 그린다 */
  search: { files: FileHit[]; reason: string | null; loading: boolean } | null
  onToggleDir: (path: string) => void
  onOpenFile: (path: string) => void
}) {
  const [picked, setPicked] = useState(0)
  const results = search?.files ?? []
  const pickedIndex = Math.min(picked, Math.max(0, results.length - 1))

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!search) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setPicked(Math.min(pickedIndex + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setPicked(Math.max(pickedIndex - 1, 0)) }
    else if (e.key === 'Enter' && results[pickedIndex]) { e.preventDefault(); onOpenFile(results[pickedIndex]!.path) }
  }

  return (
    <div className="code-tree">
      <input
        className="code-tree-filter"
        type="search"
        aria-label="파일 이름으로 찾기"
        placeholder="파일 이름으로 찾기"
        value={query}
        onChange={(e) => { onQueryChange(e.target.value); setPicked(0) }}
        onKeyDown={onKeyDown}
      />
      {search
        ? (
          <ul className="code-tree-list" role="listbox" aria-label="찾은 파일">
            {search.reason && <li className="code-tree-note">{search.reason}</li>}
            {!search.reason && !search.loading && results.length === 0 && (
              <li className="code-tree-note">일치하는 파일이 없습니다</li>
            )}
            {results.map((hit, i) => (
              <li
                key={hit.path}
                role="option"
                aria-selected={i === pickedIndex}
                className={['code-tree-row', i === pickedIndex && 'code-tree-picked'].filter(Boolean).join(' ')}
                title={hit.path}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onOpenFile(hit.path)}
              >
                <IconFile className="code-tree-icon" width="12" height="12" />
                <span className="path-text code-tree-name">{hit.path}</span>
                {dirtyPaths.has(hit.path) && <span className="code-tree-dirty" aria-hidden="true" title="저장하지 않음" />}
              </li>
            ))}
          </ul>
        )
        : (
          <ul className="code-tree-list" aria-label="파일 목록">
            {rows.map((row) => (
              <li key={row.path}>
                <button
                  type="button"
                  className={['code-tree-row', row.path === openPath && 'code-tree-current'].filter(Boolean).join(' ')}
                  style={{ paddingLeft: `${0.375 + row.depth * 0.75}rem` }}
                  title={row.path}
                  {...(row.kind === 'dir' ? { 'aria-expanded': row.expanded } : {})}
                  {...(row.path === openPath ? { 'aria-current': 'true' as const } : {})}
                  onClick={() => (row.kind === 'dir' ? onToggleDir(row.path) : onOpenFile(row.path))}
                >
                  {row.kind === 'dir'
                    ? <IconChevronRight className={row.expanded ? 'code-tree-chevron code-tree-chevron-open' : 'code-tree-chevron'} width="10" height="10" />
                    : <IconFile className="code-tree-icon" width="12" height="12" />}
                  <span className="code-tree-name">{row.name}</span>
                  {row.kind === 'file' && dirtyPaths.has(row.path) && (
                    <span className="code-tree-dirty" aria-hidden="true" title="저장하지 않음" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}
