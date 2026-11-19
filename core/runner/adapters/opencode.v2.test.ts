import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { opencodeAdapter } from './opencode'
import { OPENCODE_V2_DENIED_BY_ASK } from './opencode.detail'
import type { RunEventInit } from '@shared/events'

/**
 * opencode 2.x의 줄 모양 (`docs/sdlc/opencode-v2/` spec 0-3·FR-15~22).
 *
 * 픽스처는 진짜 CLI의 `run --standalone --format json` 출력 그대로다(`docs/sdlc/opencode-v2/probes/make-fixtures.cjs`가
 * 실측 원본에서 장비의 임시 경로만 바꿨다). **파서는 방언을 가르지 않는다** — 같은 `parseLine`이 1.x 픽스처
 * (`opencode.parse.test.ts`)와 이 픽스처를 다 읽는다.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string) => resolve(HERE, '../fixtures/opencode-v2', name)

function parse(name: string): RunEventInit[] {
  return readFileSync(fixture(name), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => opencodeAdapter.parseLine(line, 'run-1'))
}

type Use = Extract<RunEventInit, { type: 'tool_use' }>
type Result = Extract<RunEventInit, { type: 'tool_result' }>

/** 이름으로 도구 호출과 그 결과를 짝지어 꺼낸다(같은 이름이 여럿이면 순서대로) */
function tools(events: RunEventInit[], name: string): { use: Use; result: Result }[] {
  const uses = events.filter((e): e is Use => e.type === 'tool_use' && e.name === name)
  return uses.map((use) => ({
    use,
    result: events.find((e): e is Result => e.type === 'tool_result' && e.toolUseId === use.toolUseId)!
  }))
}

describe.each(['shapes-2.3.2.jsonl', 'shapes-2.0.18.jsonl'])('opencode 2.x 줄 — %s', (file) => {
  const events = parse(file)

  it('세션 id를 집는다', () => {
    const session = events.find((e) => e.type === 'session')
    expect((session as { sessionId: string }).sessionId).toMatch(/^ses_/)
  })

  it('호출 id는 part.id다 — 도구마다 다르고 비어 있지 않다 (FR-15)', () => {
    // 2.x에는 callID가 없다. 비워 두면 한 턴의 모든 도구가 같은 호출로 묶여 결과가 엉뚱한 도구에 붙는다.
    const ids = events.filter((e): e is Use => e.type === 'tool_use').map((e) => e.toolUseId)
    expect(ids).toHaveLength(8)
    expect(new Set(ids).size).toBe(8)
    for (const id of ids) expect(id).toMatch(/^chatcmpl-tool-/)
  })

  it('도구 한 줄에서 tool_use와 tool_result가 같은 id로 나온다', () => {
    for (const use of events.filter((e): e is Use => e.type === 'tool_use')) {
      expect(events.filter((e) => e.type === 'tool_result' && e.toolUseId === use.toolUseId), use.name).toHaveLength(1)
    }
  })

  it('shell은 실행 효과이고 종료 코드를 싣는다 — 0이 아닌 코드도 completed로 온다 (FR-16·17)', () => {
    const [ok, failing] = tools(events, 'shell')
    expect(ok!.use).toMatchObject({ effect: 'execute', input: { command: 'echo SHELL-OK' } })
    expect(ok!.result).toMatchObject({ ok: true, detail: { kind: 'shell', exitCode: 0, interrupted: false } })
    expect(ok!.result.output).toContain('SHELL-OK')
    expect(failing!.result.detail).toMatchObject({ kind: 'shell', exitCode: 3 })
  })

  it('검색의 개수는 한 겹 안쪽 metadata에 있다 (FR-16)', () => {
    expect(tools(events, 'grep')[0]!.result.detail).toEqual({ kind: 'search', count: 1, unit: 'matches', truncated: false })
    expect(tools(events, 'glob')[0]!.result.detail).toEqual({ kind: 'search', count: 1, unit: 'files', truncated: false })
  })

  it('읽기의 경로는 input.path이고 원문은 싣지 않는다 (FR-15·21)', () => {
    const { use, result } = tools(events, 'read')[0]!
    expect(use).toMatchObject({ effect: 'read', targetPaths: ['a.txt'] })
    expect(result.ok).toBe(true)
    expect(result.output).toBeUndefined()
    // 2.x는 같은 글이 metadata.content에도 있다 — 세부로 새지 않는다
    expect(JSON.stringify(result.detail ?? null)).not.toContain('hello world')
  })

  it('편집은 files[]의 patch를 hunk로 편다 (FR-18)', () => {
    const { use, result } = tools(events, 'edit')[0]!
    expect(use).toMatchObject({ effect: 'write', targetPaths: ['a.txt'] })
    expect(result.detail).toMatchObject({
      kind: 'edit',
      files: [{
        path: 'a.txt', operation: 'edit', added: 1, removed: 1,
        before: null, beforeMissing: 'unavailable',
        hunks: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [' line one', '-hello world', '+bye world', ' line three'] }]
      }]
    })
  })

  it('쓰기는 경로만 안다 — 새 파일 표식이 없어 덮어쓰기로 싣고, 출력 글자로 판정하지 않는다 (FR-19)', () => {
    const { use, result } = tools(events, 'write')[0]!
    expect(use).toMatchObject({ effect: 'write', targetPaths: ['b.txt'] })
    expect(result.output).toContain('Created file successfully')
    expect(result.detail).toMatchObject({
      kind: 'edit', files: [{ path: 'b.txt', operation: 'overwrite', hunks: [], beforeMissing: 'unavailable' }]
    })
  })

  it('execute는 실행 효과이고 코드가 입력으로 보인다 (FR-20)', () => {
    const { use, result } = tools(events, 'execute')[0]!
    expect(use.effect).toBe('execute')
    expect((use.input as { code: string }).code).toContain('tools.onedesk.ping()')
    expect(result).toMatchObject({ ok: true })
    expect(result.output).toBe('PONG-7731')
  })

  it('생각 줄은 본문과 시각만 옮기고 metadata는 버린다', () => {
    const reasoning = events.find((e) => e.type === 'reasoning')
    expect(reasoning).toMatchObject({ type: 'reasoning', startedAt: expect.any(Number), endedAt: expect.any(Number) })
    expect((reasoning as { text: string }).text.length).toBeGreaterThan(0)
    expect(JSON.stringify(reasoning)).not.toContain('"metadata"')
  })

  it('마지막 답과 사용량을 1.x와 같은 모양으로 낸다', () => {
    const result = events.filter((e) => e.type === 'result').at(-1)
    expect(result).toMatchObject({ status: 'succeeded', resultText: 'DONE' })
    const usage = events.filter((e) => e.type === 'usage').at(-1) as { usage: { inputTokens: number; contextTokens: number } }
    expect(usage.usage.inputTokens).toBeGreaterThan(0)
    expect(usage.usage.contextTokens).toBeGreaterThan(usage.usage.inputTokens)
  })
})

describe('opencode 2.x — 묻는 권한의 자동 거부 (ask-all-2.3.2.jsonl, FR-20·22)', () => {
  const events = parse('ask-all-2.3.2.jsonl')

  it('거부된 도구는 실패이고, 1.x와 같은 공지가 그 도구에 붙는다', () => {
    const { use, result } = tools(events, 'read')[0]!
    expect(result.ok).toBe(false)
    expect(result.summary).toContain('cannot ask the user for permission')
    const notice = events.find((e) => e.type === 'notice' && e.toolUseId === use.toolUseId)
    expect(notice).toMatchObject({
      kind: 'permission_denied', text: '권한 때문에 막힘: read (묻는 권한은 헤드리스에서 자동으로 거부됩니다)'
    })
  })

  it('거부된 도구마다 공지가 하나씩이다', () => {
    const denied = events.filter((e): e is Result => e.type === 'tool_result' && !e.ok)
    const notices = events.filter((e) => e.type === 'notice')
    expect(notices).toHaveLength(denied.length)
    expect(denied.length).toBeGreaterThanOrEqual(6)
  })

  it('execute는 status가 completed여도 안쪽 호출이 막혔으면 실패다', () => {
    // 2.x는 안쪽 도구가 거부돼도 execute를 completed로 보고한다 — metadata의 error만 참이다
    const { use, result } = tools(events, 'execute')[0]!
    expect(result.ok).toBe(false)
    expect(events.some((e) => e.type === 'notice' && e.toolUseId === use.toolUseId)).toBe(true)
  })

  it('묻지 않고 실행된 셸은 성공으로 남는다 — 종료 코드 3', () => {
    // spec 0-2: `exit 3`은 ask 아래에서도 묻지 않고 돌았다. 줄은 본 대로 옮긴다
    const ran = tools(events, 'shell').find((t) => t.result.ok)
    expect(ran!.result.detail).toMatchObject({ kind: 'shell', exitCode: 3 })
  })

  it('거부 문구 상수는 진짜 CLI의 원문 앞머리다', () => {
    const raw = readFileSync(fixture('ask-all-2.3.2.jsonl'), 'utf8')
    expect(raw).toContain(OPENCODE_V2_DENIED_BY_ASK)
  })
})

describe('opencode 2.x — 오류 줄과 모양이 어긋난 줄', () => {
  const line = (obj: unknown) => opencodeAdapter.parseLine(JSON.stringify(obj), 'run-1')

  it('오류 줄의 메시지는 error.message다 (2.x는 name·data가 아니라 type·message)', () => {
    const events = line({ type: 'error', sessionID: 'ses_x', error: { type: 'provider.no-route', message: 'Variant unavailable for opencode/big-pickle: high' } })
    expect(events).toEqual([expect.objectContaining({ type: 'error', message: 'Variant unavailable for opencode/big-pickle: high' })])
  })

  it('호출 id가 어디에도 없으면 partID로 떨어진다 — 빈 id는 도구를 한 호출로 묶는다', () => {
    const events = line({ type: 'tool_use', sessionID: 'ses_x', part: { partID: 'prt_1', tool: 'read', state: { status: 'completed', input: { path: 'a' }, output: 'x' } } })
    expect(events.map((e) => (e as { toolUseId: string }).toolUseId)).toEqual(['prt_1', 'prt_1'])
  })

  it('1.x의 callID가 있으면 그것이 먼저다', () => {
    const events = line({ type: 'tool_use', sessionID: 'ses_x', part: { id: 'prt_part', callID: 'call-1', tool: 'read', state: { status: 'completed', input: { filePath: '/a' }, output: 'x' } } })
    expect(events[0]).toMatchObject({ toolUseId: 'call-1', targetPaths: ['/a'] })
  })

  it('편집의 files 항목 하나라도 모양이 다르면 세부 전체를 버린다 — 반쯤 맞는 세부는 거짓말이다', () => {
    const state = (files: unknown) => ({ status: 'completed', input: { path: 'a.txt' }, output: 'ok', metadata: { metadata: { files } } })
    const detailOf = (files: unknown) =>
      (line({ type: 'tool_use', part: { id: 'c1', tool: 'edit', state: state(files) } })[1] as Result).detail
    expect(detailOf([{ file: 'a.txt', patch: 42, additions: 1, deletions: 1 }])).toBeUndefined()
    expect(detailOf([{ file: 'a.txt', patch: '@@ -1 +1 @@\n-a\n+b\n', additions: -1, deletions: 1 }])).toBeUndefined()
    expect(detailOf('x')).toBeUndefined()
  })

  it('편집의 status로 새 파일과 삭제를 가른다', () => {
    const patch = '@@ -0,0 +1 @@\n+x\n'
    const detail = (status: string) => (line({
      type: 'tool_use',
      part: { id: 'c1', tool: 'edit', state: { status: 'completed', input: { path: 'n.txt' }, output: 'ok', metadata: { metadata: { files: [{ file: 'n.txt', patch, status, additions: 1, deletions: 0 }] } } } }
    })[1] as Result).detail as { files: { operation: string; beforeMissing: string | null }[] }
    expect(detail('added').files[0]).toMatchObject({ operation: 'create', beforeMissing: null })
    expect(detail('deleted').files[0]).toMatchObject({ operation: 'delete' })
    expect(detail('modified').files[0]).toMatchObject({ operation: 'edit' })
    expect(detail('something-new').files[0]).toMatchObject({ operation: 'edit' })
  })
})
