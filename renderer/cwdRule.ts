import type { AssignedIssue, Repo } from '@shared/models'
import type { ContextChip } from './context'

/** 새 대화에 할당될 이슈. 작업 디렉토리 규칙이 repo 태그를 본다 (docs/sdlc/issue-flow/ FR-3) */
export interface PendingIssue extends AssignedIssue {
  repoIds: string[]
}

/** 작업 디렉토리의 기준이 되는 이슈. `assigned`면 이 대화에 할당될 이슈이고, 아니면 맥락에 담은 이슈다 */
export interface BaseIssue {
  repoIds: string[]
  assigned: boolean
}

/** 할당 예정 이슈, 없으면 하나만 담은 이슈다 (FR-1·FR-4). 둘 이상 담았으면 어느 쪽을 따를지 알 수 없어 기준이 없다. */
export function baseIssueOf(pendingIssue: PendingIssue | null, chips: ContextChip[]): BaseIssue | null {
  if (pendingIssue) return { repoIds: pendingIssue.repoIds, assigned: true }
  const picked = chips.filter((chip) => chip.type === 'issue')
  return picked.length === 1 ? { repoIds: picked[0]!.repoIds, assigned: false } : null
}

export interface CwdInput {
  repos: Repo[]
  /** "다시 실행"이 요구한 경로 */
  draftCwd: string | null
  /** 사람이 알약으로 고른 경로 */
  pickedCwd: string | null
  issue: BaseIssue | null
  /** 사이드바에서 고른 repo의 경로 */
  selectedPath: string | null
  current: string
}

function reposOf(repos: Repo[], issue: BaseIssue): Repo[] {
  return repos.filter((r) => issue.repoIds.includes(r.id))
}

/**
 * 새 대화의 작업 디렉토리 (docs/sdlc/issue-flow/ FR-1). 순서가 곧 규칙이다. `missing`은 "다시 실행"이 요구한 경로가 목록에
 * 없을 때의 그 경로다 — 조용히 첫 repo로 떨어뜨리면 원본과 다른 저장소에서 agent가 돈다.
 */
export function pickCwd({ repos, draftCwd, pickedCwd, issue, selectedPath, current }: CwdInput): {
  cwd: string
  missing: string | null
} {
  const known = (path: string | null) => repos.some((r) => r.path === path)
  if (draftCwd !== null) return { cwd: draftCwd, missing: known(draftCwd) ? null : draftCwd }
  if (known(pickedCwd)) return { cwd: pickedCwd!, missing: null }
  const tagged = issue ? reposOf(repos, issue) : []
  if (tagged.length === 1) return { cwd: tagged[0]!.path, missing: null }
  if (selectedPath !== null) return { cwd: selectedPath, missing: null }
  if (known(current)) return { cwd: current, missing: null }
  return { cwd: repos[0]?.path ?? '', missing: null }
}

/** 지금 작업 디렉토리가 이슈의 repo가 아니면 그 이슈의 repo들이다. 어긋나지 않았거나 기준이 없으면 빈 배열이다 (FR-4). */
export function cwdMismatch(repos: Repo[], issue: BaseIssue | null, cwd: string): Repo[] {
  if (!issue) return []
  const tagged = reposOf(repos, issue)
  return tagged.some((r) => r.path === cwd) ? [] : tagged
}
