import { pathKey, repoOfConversation, type Conversation } from '../conversation'
import type { Repo } from '@shared/models'

/** 코드 칸이 여는 repo, 또는 열 수 없는 이유 — 버튼의 비활성 `title`이 이것이다 */
export type PaneTarget = { repo: Repo } | { repo: null; reason: string }

/**
 * 코드 칸의 대상 repo (docs/sdlc/code-editor/ spec FR-6).
 *
 * 이어 가는 대화는 **뿌리 턴의 cwd**와 경로가 같은 등록 repo다 — 도크 목록의 구획·헤더의 repo 이름과 같은 판정
 * (`repoOfConversation`). 새 대화는 입력부의 작업 디렉토리 알약이 지금 고른 경로(`newCwd`)의 repo다.
 */
export function paneTarget(conversation: Conversation | null, newCwd: string, repos: readonly Repo[]): PaneTarget {
  if (conversation) {
    const repo = repoOfConversation(conversation, repos)
    return repo ? { repo } : { repo: null, reason: '이 대화의 작업 디렉토리는 등록된 repo가 아닙니다' }
  }
  if (repos.length === 0) return { repo: null, reason: '먼저 repo를 등록하세요' }
  if (newCwd === '') return { repo: null, reason: '작업 디렉토리를 먼저 고르세요' }
  const key = pathKey(newCwd)
  const repo = repos.find((r) => pathKey(r.path) === key)
  return repo ? { repo } : { repo: null, reason: '작업 디렉토리가 등록된 repo가 아닙니다' }
}
