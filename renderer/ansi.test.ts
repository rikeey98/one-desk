import { describe, it, expect } from 'vitest'
import { stripAnsi } from './ansi'

const ESC = '\u001b'
const BEL = '\u0007'

describe('stripAnsi (`docs/sdlc/conversation-events/` spec FR-43)', () => {
  it('색 제어열을 걷는다', () => {
    expect(stripAnsi(`${ESC}[31mFAIL${ESC}[0m src/a.test.ts`)).toBe('FAIL src/a.test.ts')
    expect(stripAnsi(`${ESC}[1;38;5;196m굵은 빨강${ESC}[39;22m`)).toBe('굵은 빨강')
    expect(stripAnsi(`${ESC}[38;2;255;0;0mRGB${ESC}[m`)).toBe('RGB')
  })

  it('커서·지우기 제어열을 걷는다', () => {
    expect(stripAnsi(`${ESC}[2K${ESC}[1G진행 50%`)).toBe('진행 50%')
    expect(stripAnsi(`${ESC}[?25l숨김${ESC}[?25h`)).toBe('숨김')
    expect(stripAnsi(`위${ESC}[1A${ESC}[3D아래`)).toBe('위아래')
  })

  it('OSC 제어열을 걷는다 — BEL로 끝나든 ST로 끝나든', () => {
    expect(stripAnsi(`${ESC}]0;창 제목${BEL}본문`)).toBe('본문')
    // OSC 8 하이퍼링크 — 주소는 걷고 글자만 남는다
    expect(stripAnsi(`${ESC}]8;;https://e.x${ESC}\\링크${ESC}]8;;${ESC}\\`)).toBe('링크')
  })

  it('문자 집합 지정과 두 글자 escape를 걷는다', () => {
    expect(stripAnsi(`${ESC}(B글자${ESC}=${ESC}7`)).toBe('글자')
  })

  it('8비트 CSI도 걷는다', () => {
    expect(stripAnsi('\u009b31m빨강\u009b0m')).toBe('빨강')
  })

  it('짝 없는 ESC도 남기지 않는다 — 끝에서 잘린 제어열이다', () => {
    expect(stripAnsi(`끝${ESC}`)).toBe('끝')
  })

  it('끝나지 않은 OSC·DCS가 반복돼도 선형 시간이다 — 도구 출력은 신뢰할 수 없는 입력이다', () => {
    // 리뷰 반영 2026-09-27: 본문을 `[\s\S]*?`로 끝까지 훑은 뒤 실패하던 때는 시작점 수 × 남은 길이만큼
    // 돌았다(상한 65,536자에서 OSC 약 0.6초, DCS 약 0.3초). 펼쳐 둔 셸 줄은 도는 턴에서 매초 다시 그려진다.
    for (const start of [`${ESC}]`, `${ESC}P`, `${ESC}_`]) {
      const input = start.repeat(32_768)
      const began = performance.now()
      const out = stripAnsi(input)
      expect(performance.now() - began, JSON.stringify(start)).toBeLessThan(100)
      expect(out).not.toContain(ESC)
    }
  })

  it('끝나지 않은 OSC는 머리만 걷고 뒤의 글자를 남긴다', () => {
    expect(stripAnsi(`${ESC}]0;제목 없음`)).toBe('0;제목 없음')
    // 본문 안의 다른 ESC에서 문자열은 끝난다 — 뒤의 색 제어열까지 삼키지 않는다
    expect(stripAnsi(`${ESC}]0;제목${ESC}[31m빨강${ESC}[0m`)).toBe('0;제목빨강')
  })

  it('제어열이 없으면 그대로다 — 줄바꿈·탭·한글·대괄호를 건드리지 않는다', () => {
    const plain = 'PASS [3/3]\r\n\t한글 ✓ 끝'
    expect(stripAnsi(plain)).toBe(plain)
    expect(stripAnsi('')).toBe('')
  })
})
