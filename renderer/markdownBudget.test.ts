import { describe, it, expect } from 'vitest'
import { fitsMarkdownBudget, MARKDOWN_BUDGET } from './markdownBudget'

/**
 * 마크다운으로 그려도 되는 글인가 (`docs/sdlc/conversation-timeline/` spec FR-20 다듬음).
 *
 * agent 답은 신뢰할 수 없는 입력이다(CLAUDE.md). 마크다운 파서(micromark)와 mdast → hast 변환은
 * 중첩이 깊으면 재귀로 스택을 넘기고(2KB의 `- - - …`), 여는 기호 없는 닫는 기호처럼 흔한 모양에서도
 * 시간이 제곱으로 는다(`a_ ` 33,000번 = 100KB에 15초). 파싱하기 **전에** 선형으로 재서 넘으면
 * 평문으로 그린다 — 파싱을 시작한 뒤에는 멈출 수 없다.
 */
describe('fitsMarkdownBudget', () => {
  it('보통 답은 통과한다 — 제목·목록·표·코드·링크', () => {
    const answer = [
      '## 원인', '', '토큰 만료 검사가 `<`가 아니라 `<=`여서 **경계**에서 깨졌습니다.', '',
      '- [x] 재현', '- [ ] 고침', '  - 하위 항목', '', '> 참고: [문서](https://example.com)', '',
      '| 파일 | 바뀐 줄 |', '|---|---|', '| `src/auth.ts` | +1 −1 |', '',
      '```ts', 'if (now >= expiresAt) return refresh()', '```'
    ].join('\n')
    expect(fitsMarkdownBudget(answer)).toBe(true)
  })

  it('빈 줄 없는 긴 코드 블록도 통과한다 — 코드 안의 기호가 흔하다', () => {
    // 코드 블록 안은 인라인 파싱을 하지 않지만 이 판정은 울타리를 쫓지 않는다(아래 모듈 주석).
    // 그래서 상한은 이 정도 코드가 넉넉히 들어가게 잡았다 — 줄마다 기호 셋, 400줄.
    const lines = Array.from({ length: 400 }, (_, i) => `  const a${i} = items[${i}] as Array<string>`)
    expect(fitsMarkdownBudget(['```ts', ...lines, '```'].join('\n'))).toBe(true)
  })

  it('글자 수 상한을 넘으면 평문이다 — 경계는 상한 그대로 통과한다', () => {
    const at = 'a'.repeat(MARKDOWN_BUDGET.chars)
    expect(fitsMarkdownBudget(at)).toBe(true)
    expect(fitsMarkdownBudget(at + 'a')).toBe(false)
  })

  describe('컨테이너 중첩 (목록·인용) — 재귀가 스택을 넘긴다', () => {
    it('한 줄의 표지로 깊어지는 목록·인용', () => {
      expect(fitsMarkdownBudget('- '.repeat(MARKDOWN_BUDGET.depth) + 'x')).toBe(true)
      expect(fitsMarkdownBudget('- '.repeat(MARKDOWN_BUDGET.depth + 1) + 'x')).toBe(false)
      expect(fitsMarkdownBudget('>'.repeat(MARKDOWN_BUDGET.depth + 1) + ' x')).toBe(false)
      expect(fitsMarkdownBudget('1. '.repeat(MARKDOWN_BUDGET.depth + 1) + 'x')).toBe(false)
      expect(fitsMarkdownBudget('> - '.repeat(40) + 'x')).toBe(false)
    })

    it('들여쓰기로 이어 가며 깊어지는 목록 — 줄마다 표지는 적어도 들여쓰기가 깊이를 말한다', () => {
      // 줄마다 표지 16개, 다음 줄은 그 안쪽 내용 칸에서 다시 16개 — 64KB로 깊이 1,000에 닿는다.
      const lines: string[] = []
      for (let j = 0, indent = 0; j < 8; j++, indent += 32) lines.push(' '.repeat(indent) + '- '.repeat(16) + 'x')
      expect(fitsMarkdownBudget(lines.join('\n'))).toBe(false)
    })

    it('탭 들여쓰기는 네 칸으로 센다', () => {
      expect(fitsMarkdownBudget('\t'.repeat(MARKDOWN_BUDGET.depth / 2) + 'x')).toBe(true)
      expect(fitsMarkdownBudget('\t'.repeat(MARKDOWN_BUDGET.depth / 2 + 1) + 'x')).toBe(false)
    })
  })

  describe('인라인 기호 — 파싱이 제곱으로 느려진다', () => {
    it.each([
      ['중첩된 강조', '*a '.repeat(1_000) + 'x' + ' a*'.repeat(1_000)],
      ['중첩된 취소선', '~a '.repeat(1_000) + 'x' + ' a~'.repeat(1_000)],
      ['여는 기호 없는 닫는 기호', 'a_ '.repeat(2_000)],
      ['여는 대괄호 없는 닫는 대괄호', 'a]'.repeat(2_000)],
      ['중첩된 이미지', '!['.repeat(1_000) + 'x' + '](u)'.repeat(1_000)],
      ['닫히지 않은 주석', '</' + '<!--'.repeat(2_000)],
      ['한 줄의 긴 기호 줄기', '*'.repeat(2_000) + 'a' + '*'.repeat(2_000)]
    ])('%s', (_name, text) => {
      expect(fitsMarkdownBudget(text)).toBe(false)
    })

    it('빈 줄로 나뉜 문단은 따로 센다 — 인라인 파싱은 문단을 넘지 않는다', () => {
      const paragraph = '*강조* 그리고 [링크](https://e.x) '.repeat(20)
      expect(fitsMarkdownBudget(Array.from({ length: 150 }, () => paragraph).join('\n\n'))).toBe(true)
      // 같은 글을 빈 줄 없이 한 문단으로 붙이면 한 덩어리로 센다.
      expect(fitsMarkdownBudget(Array.from({ length: 150 }, () => paragraph).join('\n'))).toBe(false)
    })

    it('문단마다 상한 밑이어도 문서 전체의 합이 넘으면 평문이다', () => {
      // 한 문단 1,000개(비용 1,000,000)는 통과하지만, 그런 문단 셋이면 넘는다.
      const paragraph = 'a_ '.repeat(1_000)
      expect(fitsMarkdownBudget(paragraph)).toBe(true)
      expect(fitsMarkdownBudget([paragraph, paragraph, paragraph].join('\n\n'))).toBe(false)
    })

    it('줄 끝의 CR은 빈 줄 판정을 흐리지 않는다', () => {
      const paragraph = 'a_ '.repeat(1_000)
      expect(fitsMarkdownBudget([paragraph, paragraph].join('\r\n\r\n'))).toBe(true)
    })
  })

  describe('표의 세로 막대 — 따로 센다', () => {
    it('구분 줄 없는 막대 줄이 이어지면 평문이다', () => {
      expect(fitsMarkdownBudget('|a|\n'.repeat(6_000))).toBe(false)
    })

    it('수백 줄짜리 보통 표는 통과한다', () => {
      const table = ['| 파일 | 줄 | 상태 |', '|---|---|---|', ...Array.from({ length: 600 }, (_, i) => `| a${i}.ts | ${i} | 바뀜 |`)]
      expect(fitsMarkdownBudget(table.join('\n'))).toBe(true)
    })
  })

  it('10만 자 문서도 한 번 훑는 데 오래 걸리지 않는다', () => {
    const text = ('- 항목 *강조* `code` [a](b)\n'.repeat(20) + '\n').repeat(180).slice(0, MARKDOWN_BUDGET.chars)
    const started = performance.now()
    fitsMarkdownBudget(text)
    expect(performance.now() - started).toBeLessThan(200)
  })
})
