import type { Repo, Issue, Memo, AssetKind } from '@shared/models'
import { rewriteMentions } from '@shared/mentions'

/** 지시문의 `@경로`에서 해석해 읽은 파일 (docs/sdlc/input-triggers/ FR-14). 본문은 호출자가 읽는다 */
export interface FileForPrompt {
  repoName: string
  /** repo 상대 경로, `/` 구분 */
  path: string
  content: string
}

/** 프롬프트에 실을 asset. 본문은 호출자가 채운다 — discovered는 디스크에서 읽는다 */
export interface AssetForPrompt {
  kind: AssetKind
  name: string
  description: string | null
  content: string
}

export interface AssembleInput {
  repos: Repo[]
  issues: Issue[]
  memos: Memo[]
  assets: AssetForPrompt[]
  /** 지시문의 멘션에서 읽은 파일. 없으면 `<files>` 블록이 없다 */
  files?: FileForPrompt[]
  /**
   * 해석된 멘션의 `@` 자리(원문 `userPrompt` 기준). 이 자리의 `@`만 떼고 나머지 멘션의 `@`는
   * 중화한다(FR-12) — 비우면 지시문의 멘션이 전부 중화된다.
   */
  resolvedMentions?: number[]
  userPrompt: string
}

/**
 * 본문이 태그 구조를 깨뜨리지 못하게 막는다.
 *
 * **`@`도 엔티티로 바꾼다** — claude는 맥락 본문 속 `@경로`(태그 안, `&lt;` 뒤라도)를 도구 권한 밖에서
 * 펼치고 `..`·절대 경로로 repo 밖까지 읽는다(docs/sdlc/input-triggers/ spec §6 실측, §7의 2). 이
 * 치환을 지우면 이슈·메모·asset·파일 본문이 권한 밖 읽기 통로가 된다.
 */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/@/g, '&#64;')
}

/**
 * 속성 값. `esc`에 `"`까지 막는다 — git이 주는 경로에는 `"`가 올 수 있다. 기존 블록(`repo name=` 등)은
 * 조립 결과를 바꾸지 않으려고 `esc` 그대로 두었다.
 */
function attr(text: string): string {
  return esc(text).replace(/"/g, '&quot;')
}

const NEEDS_ANSWER_GUIDE = `
사용자의 결정이 필요해 작업을 진행할 수 없으면, 최종 응답의 첫 줄에
[NEEDS_ANSWER] 만 단독으로 출력하고 그 다음 줄부터 질문을 쓸 것.
작업을 마쳤다면 이 표식을 쓰지 말 것.
`.trim()

export function assemblePrompt(input: AssembleInput): string {
  const sections: string[] = []

  if (input.repos.length > 0) {
    const items = input.repos.map((r) =>
      `  <repo name="${esc(r.name)}" path="${esc(r.path)}">${esc(r.description ?? '')}</repo>`
    )
    sections.push(`  <repos>\n${items.join('\n')}\n  </repos>`)
  }

  if (input.issues.length > 0) {
    const items = input.issues.map((i) =>
      `    <issue id="${esc(i.id)}" status="${i.status}">\n` +
      `      <title>${esc(i.title)}</title>\n` +
      `      <body>${esc(i.body)}</body>\n` +
      `    </issue>`
    )
    sections.push(`  <issues>\n${items.join('\n')}\n  </issues>`)
  }

  if (input.memos.length > 0) {
    const items = input.memos.map((m) =>
      `    <memo id="${esc(m.id)}">\n` +
      `      <title>${esc(m.title)}</title>\n` +
      `      <body>${esc(m.body)}</body>\n` +
      `    </memo>`
    )
    sections.push(`  <memos>\n${items.join('\n')}\n  </memos>`)
  }

  // 멘션한 파일 (FR-14). 외부 repo의 파일이라 신뢰할 수 없는 입력이다 — 반드시 이스케이프한다.
  const files = input.files ?? []
  if (files.length > 0) {
    const items = files.map((f) =>
      `    <file repo="${attr(f.repoName)}" path="${attr(f.path)}">${esc(f.content)}</file>`
    )
    sections.push(`  <files>\n${items.join('\n')}\n  </files>`)
  }

  // discovered asset의 본문은 호출자가 디스크에서 읽어 넘긴다 — 조립기는 순수하게
  // 둔다(설계 §5-2). 본문은 반드시 이스케이프한다: 외부 repo의 파일이라
  // 신뢰할 수 없는 입력이다.
  const assetBlock = (kind: AssetKind, tag: string): void => {
    const picked = input.assets.filter((a) => a.kind === kind)
    if (picked.length === 0) return
    const items = picked.map((a) =>
      `    <${kind} name="${esc(a.name)}">\n` +
      `      <description>${esc(a.description ?? '')}</description>\n` +
      `      <content>${esc(a.content)}</content>\n` +
      `    </${kind}>`
    )
    sections.push(`  <${tag}>\n${items.join('\n')}\n  </${tag}>`)
  }
  assetBlock('skill', 'skills')
  assetBlock('agent', 'agents')

  const contextBlock =
    sections.length > 0 ? `<context>\n${sections.join('\n')}\n</context>` : null

  // 슬래시로 시작하면 조립 결과의 첫 글자도 '/'여야 CLI가 커맨드로 확장한다. 맥락과
  // 안내문을 뒤로 밀고 <task> 래퍼는 쓰지 않는다(FR-7). 앞 공백을 남겨 보내면 우리는
  // 슬래시로 보고 CLI는 아니라고 보므로, 판정한 것과 같은 trimStart된 문자열을 보낸다.
  //
  // 지시문의 `@`는 CLI에 그대로 가지 않는다 (FR-12) — 해석된 멘션은 `@`만 떼고(파일은 위 `<files>`에
  // 있다), 나머지는 claude가 펼치지 못하게 중화한다. 바꾸는 것은 `@` 한 글자라 슬래시 판정과
  // 위치는 그대로이고, `@`가 없으면 글자 하나 바뀌지 않는다.
  const userPrompt = rewriteMentions(input.userPrompt, new Set(input.resolvedMentions ?? []))
  const trimmedPrompt = userPrompt.trimStart()
  if (trimmedPrompt.startsWith('/')) {
    const slashParts = [trimmedPrompt]
    if (contextBlock) slashParts.push(contextBlock)
    slashParts.push(NEEDS_ANSWER_GUIDE)
    return slashParts.join('\n\n')
  }

  const parts: string[] = []
  if (contextBlock) parts.push(contextBlock)

  // userPrompt는 이스케이프하지 않는다. 사용자가 직접 쓴 지시이므로 그대로 전달한다.
  // 맥락 데이터만 이스케이프한다 — 4단계에서 agent가 create_memo로 쓴 내용도 거기 들어온다.
  parts.push(`<task>\n${userPrompt}\n</task>`)
  parts.push(NEEDS_ANSWER_GUIDE)

  return parts.join('\n\n')
}
