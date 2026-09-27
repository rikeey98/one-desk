/**
 * 마크다운으로 그려도 되는 글인가 (`docs/sdlc/conversation-timeline/` spec FR-20 다듬음 — 리뷰가
 * 찾은 것).
 *
 * **agent 답은 신뢰할 수 없는 입력이다**(CLAUDE.md). 마크다운을 그리는 사슬(micromark →
 * mdast → hast → JSX)은 입력 모양에 따라 두 가지로 무너진다 — 전부 실측이다(Node 22):
 *
 * - **중첩이 깊으면 스택을 넘긴다.** `- ` 1,000번(2KB)이나 `>` 3,000번이 `Maximum call stack
 *   size exceeded`를 던진다(mdast-util-to-hast의 list-item·blockquote 재귀). 렌더 중에 던지면
 *   React 19가 루트를 통째로 내려 창 전체가 빈 화면이 된다.
 * - **흔한 모양에서도 시간이 제곱으로 는다.** 여는 기호 없는 닫는 기호(`a_ ` 33,000번 = 100KB)가
 *   15초, 중첩된 강조 1,000겹(6KB)이 0.3초, 3,000겹이 3초 뒤에 던진다 — 파서가 닫는 기호마다
 *   문단을 거슬러 훑는다. 렌더러의 메인 스레드라 그동안 앱 전체가 멈춘다.
 *
 * 파싱을 시작한 뒤에는 멈출 수 없으므로 **파싱하기 전에** 한 번 훑어 잰다. 넘으면 호출자는
 * 평문으로 그린다 — 글은 전부 보이고 서식만 빠진다. 재는 것은 셋이다:
 *
 * 1. **글자 수** — 보통 문서도 크기에 비례해 느려진다(14만 자에 0.7초).
 * 2. **컨테이너 깊이의 위 한계** — 줄마다 `들여쓰기 칸 ÷ 2 + 줄머리 표지 수`. 목록 항목은 내용
 *    칸이 최소 두 칸이라 이어 가는 줄의 들여쓰기가 그 깊이를 말하고, 인용은 줄마다 `>`를 다시
 *    적어야 이어진다. 그래서 어떤 줄의 실제 깊이도 이 값을 넘지 않는다.
 * 3. **인라인 기호의 제곱** — 문단(빈 줄 사이)마다 파서가 거슬러 훑을 수 있는 기호의 수를 세어
 *    그 제곱을 문서 전체에서 더한다. 표의 `|`는 한 칸에 드는 비용이 훨씬 작아 따로 센다.
 *
 * **코드 울타리(```)를 쫓지 않는다.** 코드 블록 안은 인라인 파싱을 하지 않으니 세지 않는 편이
 * 정확하지만, 울타리 판정이 파서와 한 번이라도 어긋나면(HTML 블록 안의 ```, 목록 항목이 끝나며
 * 같이 닫히는 울타리) 그 뒤의 문단을 세지 않게 되어 이 판정 전체가 뚫린다. 대가는 빈 줄 없이
 * 수백 줄 이어지는 코드가 평문으로 떨어지는 것 — 잘못 그리는 쪽이 멈추는 쪽보다 낫다.
 *
 * 상한은 실측으로 골랐다: 이 저장소의 spec·plan·CLAUDE.md와 빈 줄을 뺀 소스 파일들이 인라인 비용
 * 36만 아래였고, 상한에 닿는 적대적 입력은 0.3초 안팎에 그려진다.
 */
export const MARKDOWN_BUDGET = {
  /** 글자 수 */
  chars: 100_000,
  /** 컨테이너 깊이의 위 한계 */
  depth: 64,
  /** 문단마다 (인라인 기호 수)²의 문서 합 */
  inline: 2_000_000,
  /** 문단마다 (`|` 수)²의 문서 합 */
  pipes: 100_000_000
} as const

/** 파서가 닫는 짝을 찾아 거슬러 훑는 기호 — 강조·취소선·링크·이미지·HTML·코드 스팬. */
const INLINE = new Set(['*', '_', '~', '[', ']', '<', '`'])

/** 줄머리의 컨테이너 표지 하나 — 인용 `>`, 글머리 `-*+`, 번호 `1.`·`1)`. 뒤의 공백까지 먹는다. */
const MARKER = /(?:>|[-*+](?=[ \t]|$)|\d{1,9}[.)](?=[ \t]|$))[ \t]*/y

export function fitsMarkdownBudget(text: string): boolean {
  if (text.length > MARKDOWN_BUDGET.chars) return false

  let inlineCost = 0
  let pipeCost = 0
  let inline = 0
  let pipes = 0

  const closeParagraph = (): boolean => {
    inlineCost += inline * inline
    pipeCost += pipes * pipes
    inline = 0
    pipes = 0
    return inlineCost <= MARKDOWN_BUDGET.inline && pipeCost <= MARKDOWN_BUDGET.pipes
  }

  for (const line of text.split('\n')) {
    // 빈 줄이 문단을 끝낸다. CR만 남은 줄도 빈 줄이다.
    if (line.trim() === '') {
      if (!closeParagraph()) return false
      continue
    }

    let i = 0
    let columns = 0
    while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
      columns += line[i] === '\t' ? 4 : 1
      i++
    }
    let markers = 0
    MARKER.lastIndex = i
    while (MARKER.exec(line) !== null) markers++
    if (Math.floor(columns / 2) + markers > MARKDOWN_BUDGET.depth) return false

    for (let j = i; j < line.length; j++) {
      const ch = line[j]!
      if (ch === '|') pipes++
      else if (INLINE.has(ch)) inline++
    }
  }
  return closeParagraph()
}
