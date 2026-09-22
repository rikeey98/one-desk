import { describe, it, expect } from 'vitest'
import { parseInit } from './probe'

/**
 * `probe.test.ts`는 shebang 스크립트를 실행 파일로 띄우므로 Windows에서 통째로
 * 스킵된다. 파싱만은 플랫폼과 무관하게 고정해 둔다 — 이 파일이 없으면 개발
 * 장비(Windows)에서 init 파싱의 회귀를 **한 건도** 잡지 못한다.
 */
function initLine(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: 'system', subtype: 'init', ...over })
}

describe('parseInit', () => {
  it('init이 아니면 null이다', () => {
    expect(parseInit(JSON.stringify({ type: 'assistant' }))).toBeNull()
    expect(parseInit(JSON.stringify({ type: 'system', subtype: 'hook_started' }))).toBeNull()
  })

  it('깨진 JSON은 null이다 — 줄 하나 때문에 목록 전체를 포기하지 않는다', () => {
    expect(parseInit('{ 깨짐')).toBeNull()
    expect(parseInit('')).toBeNull()
  })

  it('해석된 모델 이름과 버전을 함께 싣는다', () => {
    // 슬래시 커맨드와 **같은 한 번의 기동**에서 온다. 이 줄을 이미 손에 들고
    // 있으면서 버리고 있었다 (docs/sdlc/agent-setup/ NFR-3).
    const result = parseInit(initLine({
      model: 'claude-sonnet-5',
      claude_code_version: '2.1.278',
      slash_commands: ['review']
    }))

    expect(result?.model).toBe('claude-sonnet-5')
    expect(result?.version).toBe('2.1.278')
    expect(result?.slashCommands).toEqual(['review'])
  })

  it('없는 모델 이름도 그대로 싣는다', () => {
    // init은 모델을 **검증하지 않는다** — `gpt-9`도 그대로 되돌려 준다
    // (2026-09-22 실측). 여기서 거르면 화면이 "확인했다"고 착각하게 된다.
    expect(parseInit(initLine({ model: 'gpt-9' }))?.model).toBe('gpt-9')
  })

  it('필드가 없으면 null이다 — 빈 문자열로 채우지 않는다', () => {
    const result = parseInit(initLine({}))
    expect(result?.model).toBeNull()
    expect(result?.version).toBeNull()
  })

  it('빈 문자열도 null로 본다', () => {
    const result = parseInit(initLine({ model: '', claude_code_version: '' }))
    expect(result?.model).toBeNull()
    expect(result?.version).toBeNull()
  })

  it('모델이 문자열이 아니면 null이다', () => {
    expect(parseInit(initLine({ model: 7 }))?.model).toBeNull()
    expect(parseInit(initLine({ model: { name: 'x' } }))?.model).toBeNull()
  })

  it('슬래시 커맨드 파싱은 그대로다', () => {
    // 모델을 더하면서 기존 동작이 흔들리지 않았는지 본다.
    const result = parseInit(initLine({
      slash_commands: ['좋음', 7, null],
      terminal_slash_commands: '문자열',
      plugins: [{ name: '초능력', path: '/p' }, { name: '경로없음' }]
    }))

    expect(result?.slashCommands).toEqual(['좋음'])
    expect(result?.terminalSlashCommands).toEqual([])
    expect(result?.plugins).toEqual([{ name: '초능력', path: '/p' }])
  })
})
