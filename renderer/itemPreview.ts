import type { Repo } from '@shared/models'

const MAX_PREVIEW = 200

/** 목록 줄 둘째 줄의 repo 이름 — 태그 순서대로 쉼표로. 없거나 모르는 id뿐이면 null (이슈·메모가 같이 쓴다) */
export function repoNamesOf(repoIds: readonly string[], repos: readonly Repo[]): string | null {
  const names = repoIds.map((id) => repos.find((r) => r.id === id)?.name).filter((n): n is string => Boolean(n))
  return names.length ? names.join(', ') : null
}

/**
 * 메모 목록 줄의 둘째 줄 — 본문 앞부분을 마크다운 기호 없이 한 줄로 (docs/sdlc/item-look/ FR-3).
 * 읽기 화면처럼 렌더하지 않는다: 줄머리 기호(제목·인용·목록·할 일 상자)만 떼고 줄을 가운뎃점으로 잇는다.
 */
export function previewOf(body: string): string | null {
  const parts: string[] = []
  let length = 0
  for (const raw of body.split('\n')) {
    const line = raw
      .replace(/^\s*(#{1,6}\s+|>\s?)+/, '')
      .replace(/^\s*([-*+]|\d+[.)])\s+/, '')
      .replace(/^\[[ xX]\]\s+/, '')
      .trim()
    if (!line || /^(`{3,}|~{3,}|-{3,}|\*{3,}|_{3,})/.test(line)) continue
    parts.push(line)
    length += line.length + 3
    if (length >= MAX_PREVIEW) break
  }
  if (parts.length === 0) return null
  return parts.join(' · ').slice(0, MAX_PREVIEW)
}
