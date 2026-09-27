import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { opencodeAdapter } from './opencode'
import type { RunEventInit } from '@shared/events'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(HERE, 'fixtures/opencode-stream.jsonl')

function parseAll(): RunEventInit[] {
  return readFileSync(FIXTURE, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .flatMap((line) => opencodeAdapter.parseLine(line, 'run-1'))
}

describe('opencodeAdapter.parseLine — 실측 픽스처', () => {
  it('세션 id를 집는다', () => {
    const session = parseAll().find((e) => e.type === 'session')
    expect(session).toBeDefined()
    expect((session as { sessionId: string }).sessionId).toMatch(/^ses/)
  })

  it('읽기 도구를 read 효과로 옮긴다', () => {
    const read = parseAll().find((e) => e.type === 'tool_use' && e.name === 'read')
    expect(read).toMatchObject({ effect: 'read' })
  })

  it('쓰기 도구를 write 효과와 대상 경로로 옮긴다', () => {
    // 이 두 값이 앞으로 diff 뷰어의 입력이다 (전체 설계 §329).
    const write = parseAll().find((e) => e.type === 'tool_use' && e.name === 'write')
    expect(write).toMatchObject({ effect: 'write' })
    expect((write as { targetPaths: string[] }).targetPaths[0]).toMatch(/summary\.txt$/)
  })

  it('도구 한 줄에서 tool_use와 tool_result가 같은 id로 나온다', () => {
    const events = parseAll()
    const use = events.find((e) => e.type === 'tool_use')!
    const result = events.find((e) => e.type === 'tool_result')!
    expect((use as { toolUseId: string }).toolUseId).not.toBe('')
    expect((result as { toolUseId: string }).toolUseId)
      .toBe((use as { toolUseId: string }).toolUseId)
    expect((result as { ok: boolean }).ok).toBe(true)
  })

  it('최종 텍스트가 text와 result 둘 다로 나온다', () => {
    // OpenCode에는 종료 이벤트가 없어 result를 합성한다 (설계 §7).
    const events = parseAll()
    const text = events.filter((e) => e.type === 'text').at(-1)!
    const result = events.filter((e) => e.type === 'result').at(-1)!
    expect((result as { resultText: string }).resultText)
      .toBe((text as { text: string }).text)
    expect((result as { status: string }).status).toBe('succeeded')
  })
})

describe('opencodeAdapter.parseLine — 단위', () => {
  it('깨진 줄을 raw로 흘려보낸다', () => {
    // 한 줄이 깨졌다고 run 전체를 죽이지 않는다 (전체 설계 §11).
    expect(opencodeAdapter.parseLine('{깨진', 'run-1'))
      .toEqual([{ type: 'raw', runId: 'run-1', at: expect.any(Number), line: '{깨진' }])
  })

  it('객체가 아닌 JSON 줄은 깨진 줄과 같다 — 던지면 stdout 핸들러 안이라 메인 프로세스가 죽는다', () => {
    // 리뷰 반영 2026-09-27: `null`도 JSON으로는 읽힌다. 그 뒤 `obj['part']`에서 던졌다.
    for (const line of ['null', '7', '[1,2]']) {
      expect(opencodeAdapter.parseLine(line, 'run-1'), line)
        .toEqual([{ type: 'raw', runId: 'run-1', at: expect.any(Number), line }])
    }
  })

  it('모르는 type은 버린다', () => {
    const line = JSON.stringify({ type: 'step_finish', sessionID: 'ses_x', part: {} })
    expect(opencodeAdapter.parseLine(line, 'run-1')).toEqual([])
  })

  it('[NEEDS_ANSWER] 표식을 떼고 needsAnswer를 세운다', () => {
    const line = JSON.stringify({
      type: 'text', sessionID: 'ses_x',
      part: { type: 'text', text: '[NEEDS_ANSWER]\nA와 B 중 어느 쪽으로 할까요?' }
    })
    const events = opencodeAdapter.parseLine(line, 'run-1')
    const result = events.find((e) => e.type === 'result')!
    expect((result as { needsAnswer: boolean }).needsAnswer).toBe(true)
    expect((result as { resultText: string }).resultText).toBe('A와 B 중 어느 쪽으로 할까요?')
    // 표식은 로그에도 새어나가면 안 된다.
    const text = events.find((e) => e.type === 'text')!
    expect((text as { text: string }).text).not.toContain('[NEEDS_ANSWER]')
  })

  it('bash 도구는 execute 효과다', () => {
    const line = JSON.stringify({
      type: 'tool_use', sessionID: 'ses_x',
      part: { tool: 'bash', callID: 'c1', state: { status: 'completed', input: {}, output: '' } }
    })
    const use = opencodeAdapter.parseLine(line, 'run-1')[0]!
    expect((use as { effect: string }).effect).toBe('execute')
  })

  it('실패한 도구는 ok=false다', () => {
    const line = JSON.stringify({
      type: 'tool_use', sessionID: 'ses_x',
      part: { tool: 'read', callID: 'c1', state: { status: 'error', input: {}, output: '없음' } }
    })
    const result = opencodeAdapter.parseLine(line, 'run-1')
      .find((e) => e.type === 'tool_result')!
    expect((result as { ok: boolean }).ok).toBe(false)
    // state.error가 없는 옛 모양이면 output으로 되돌아간다 (FR-23·25)
    expect(result).toMatchObject({ summary: '없음', output: '없음' })
  })
})

/**
 * **옛 줄 호환** (`docs/sdlc/conversation-events/` plan 2단계). conversation-events를 구현하기 **전의**
 * 어댑터로 실측 픽스처 `opencode-stream.jsonl`을 파싱한 결과를 그대로 적어 두었다(`at`은 뺀다 — usage
 * 줄은 run-info가 이미 고정하므로 여기서는 개수만 본다). 기존 필드는 한 글자도 바뀌지 않아야 하고,
 * 달라져도 되는 것은 새 선택 필드가 **더해지는 것**(NEW_KEYS)뿐이다.
 */
describe('옛 줄 호환 — 구현 전 어댑터의 출력', () => {
  const SESSION = 'ses_f8b71db55ffe6MYWgramkkrKmy'
  const session = { type: 'session', runId: 'run-1', sessionId: SESSION }
  const READ_1 = 'call-e24ed652-8ae8-43a0-a72e-5c606375c6e1'
  const WRITE = 'call-0473b8c7-b005-4631-9773-bec73ce78489'
  const READ_2 = 'call-c82aabe4-aa37-4daf-a8c6-1b42af0906a8'
  const DONE = 'Done. summary.txt contains exactly "OK".'
  const BEFORE: Record<number, unknown[]> = {
    0: [session],
    1: [
      {
        type: 'tool_use', runId: 'run-1', toolUseId: READ_1, name: 'read', effect: 'read',
        targetPaths: ['/private/tmp/od-fx/notes.txt'], input: { filePath: '/private/tmp/od-fx/notes.txt' }
      },
      {
        type: 'tool_result', runId: 'run-1', toolUseId: READ_1, ok: true,
        summary: '<path>/private/tmp/od-fx/notes.txt</path>\n<type>file</type>\n<content>\n1: hello from one-desk probe\n\n(End of file - total 1 lines)\n</content>'
      }
    ],
    3: [session],
    4: [
      {
        type: 'tool_use', runId: 'run-1', toolUseId: WRITE, name: 'write', effect: 'write',
        targetPaths: ['/private/tmp/od-fx/summary.txt'],
        input: { filePath: '/private/tmp/od-fx/summary.txt', content: 'OK' }
      },
      { type: 'tool_result', runId: 'run-1', toolUseId: WRITE, ok: true, summary: 'Wrote file successfully.' }
    ],
    6: [session],
    7: [
      {
        type: 'tool_use', runId: 'run-1', toolUseId: READ_2, name: 'read', effect: 'read',
        targetPaths: ['/private/tmp/od-fx/summary.txt'], input: { filePath: '/private/tmp/od-fx/summary.txt' }
      },
      {
        type: 'tool_result', runId: 'run-1', toolUseId: READ_2, ok: true,
        summary: '<path>/private/tmp/od-fx/summary.txt</path>\n<type>file</type>\n<content>\n1: OK\n\n(End of file - total 1 lines)\n</content>'
      }
    ],
    9: [session],
    10: [
      { type: 'text', runId: 'run-1', text: DONE },
      { type: 'result', runId: 'run-1', status: 'succeeded', resultText: DONE, sessionId: SESSION, needsAnswer: false }
    ]
  }
  /** 이 기능이 더한 선택 필드. 옛 모양의 줄에서 더해질 수 있는 것은 이것뿐이다 */
  const NEW_KEYS = ['output', 'outputTruncated', 'detail', 'parentToolUseId', 'messageId']
  const LINES = readFileSync(FIXTURE, 'utf8').split('\n').filter((l) => l.trim() !== '')

  function withoutNew(e: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'at' && !NEW_KEYS.includes(k)))
  }

  it.each(Object.keys(BEFORE).map(Number))('%i행의 기존 필드는 그대로다', (i) => {
    const events = opencodeAdapter.parseLine(LINES[i]!, 'run-1') as unknown as Record<string, unknown>[]
    expect(events.map(withoutNew)).toEqual(BEFORE[i])
  })

  it('step_finish 넷은 지금처럼 usage 하나씩이다', () => {
    for (const i of [2, 5, 8, 11]) {
      expect(opencodeAdapter.parseLine(LINES[i]!, 'run-1').map((e) => e.type)).toEqual(['usage'])
    }
  })

  it('옛 줄에 더해지는 것 — 메시지 id, write의 출력과 detail. 읽기는 원문을 싣지 않는다(§7-A)', () => {
    const added = (i: number) => opencodeAdapter.parseLine(LINES[i]!, 'run-1')
      .map((e) => Object.keys(e).filter((k) => NEW_KEYS.includes(k)).sort())
    expect(added(1)).toEqual([['messageId'], ['messageId']])
    expect(added(4)).toEqual([['messageId'], ['detail', 'messageId', 'output']])
    expect(added(7)).toEqual([['messageId'], ['messageId']])
    // 결과(result)에는 싣지 않는다 — 합성한 종료 이벤트이지 메시지가 아니다
    expect(added(10)).toEqual([['messageId'], []])

    const write = opencodeAdapter.parseLine(LINES[4]!, 'run-1')[1]
    expect(write).toMatchObject({
      output: 'Wrote file successfully.',
      messageId: 'msg_0748e34150015q8PLp16W18NuF',
      detail: { kind: 'edit', files: [{ path: '/private/tmp/od-fx/summary.txt', operation: 'create', hunks: [] }] }
    })
  })
})

/**
 * 합성 픽스처 `opencode-events.jsonl` (plan 2단계). **모양의 출처** — 모델을 부르는 실행을 하지 않았으므로
 * 스트림을 새로 뜨지 않았다(spec §7 우려 3):
 * - 소스(`run.ts` v1.18.27 사본 — 1.18.30과 바이트 동일): `reasoning` 줄은 `--thinking`이 있을 때만
 *   나오고(:766) 모양은 `{type, timestamp, sessionID, part}`다. 하위 세션의 part는 건너뛴다(:722)
 * - 소스 `session/processor.ts`: completed(:160-183)·error(:186-205)의 `state`, 중단된 도구(:599)
 * - 소스 `tool/task.ts`:184: task의 `metadata`
 * - 바이너리(1.18.30): edit의 `diff`·`filediff`(unified diff), grep `matches`, glob `count`, bash `exit`,
 *   권한 거부 두 문구
 * - 바이너리(1.18.30): apply_patch의 `files[]` — 파일별 diff는 `patch` 키다(리뷰 반영 2026-09-27; spec §2-3의
 *   UI 데모 추정 `diff`는 틀렸다)
 * - reasoning의 `metadata`(provider 서명·암호문)는 AI SDK의 providerMetadata 모양을 흉내 냈다
 * 실제 run의 `raw.jsonl`이 생기면 그 줄로 바꾼다(plan 완료 증명의 후속 항목).
 */
const EVENT_LINES = readFileSync(resolve(HERE, 'fixtures/opencode-events.jsonl'), 'utf8')
  .split('\n').filter((l) => l.trim() !== '')

/** 줄을 part id로 찾는다 — 픽스처에 줄을 더해도 테스트가 밀리지 않는다 */
function lineOf(partId: string): string {
  const found = EVENT_LINES.find((l) => (JSON.parse(l) as { part?: { id?: string } }).part?.id === partId)
  if (!found) throw new Error(`픽스처에 ${partId} 줄이 없다`)
  return found
}

function parse(partId: string): RunEventInit[] {
  return opencodeAdapter.parseLine(lineOf(partId), 'run-1')
}

function resultOf(partId: string) {
  const ev = parse(partId).find((e) => e.type === 'tool_result')
  if (!ev || ev.type !== 'tool_result') throw new Error(`${partId}에서 tool_result가 나오지 않았다`)
  return ev
}

describe('reasoning (FR-22)', () => {
  it('본문과 CLI가 잰 시작·끝 시각을 싣는다', () => {
    expect(parse('prt_reason')).toEqual([{
      type: 'reasoning', runId: 'run-1', at: expect.any(Number),
      text: '만료 경계가 의심스럽다. 테스트부터 돌려 본다.',
      startedAt: 1788661880100, endedAt: 1788661882100,
      messageId: 'msg_ev1'
    }])
  })

  it('part.metadata(provider 서명·암호문)는 어디에도 싣지 않는다', () => {
    const json = JSON.stringify([...parse('prt_reason'), ...parse('prt_reason_blank')])
    expect(json).not.toContain('SIGNATURE-')
    expect(json).not.toContain('ENCRYPTED-REASONING')
    expect(json).not.toContain('metadata')
  })

  it('공백뿐인 본문은 이벤트를 만들지 않는다 (FR-22)', () => {
    // 리뷰 반영 2026-09-27: §7-A의 "빈 생각도 한 줄로 보인다"는 우려 2 — claude — 의 결정이다. FR-22는
    // opencode에 대해 따로 "공백뿐이면 이벤트 없음"을 정했다. OpenAI 계열은 본문 없이 암호문만 오는
    // reasoning이 흔해, 내면 턴마다 펼칠 것 없는 생각 줄이 여럿 선다.
    expect(parse('prt_reason_blank')).toEqual([])
  })

  it('시각이 수가 아니면 null이다', () => {
    const [ev] = opencodeAdapter.parseLine(JSON.stringify({
      type: 'reasoning', sessionID: 'ses_x',
      part: { type: 'reasoning', text: '생각', time: { start: '1', end: null } }
    }), 'run-1')
    expect(ev).toMatchObject({ type: 'reasoning', text: '생각', startedAt: null, endedAt: null })
    expect(ev && 'messageId' in ev).toBe(false)
  })

  it('긴 생각은 앞부분만 남기고 버린 글자 수를 적는다', () => {
    const long = `처음${'생'.repeat(70_000)}`
    const [ev] = opencodeAdapter.parseLine(JSON.stringify({
      type: 'reasoning', sessionID: 'ses_x', part: { type: 'reasoning', text: long, time: { start: 1, end: 2 } }
    }), 'run-1')
    expect(ev).toMatchObject({ type: 'reasoning', truncated: long.length - 65_536 })
    expect(ev && ev.type === 'reasoning' ? ev.text.startsWith('처음') : false).toBe(true)
  })

  it('part가 없는 reasoning 줄은 버린다', () => {
    expect(opencodeAdapter.parseLine(JSON.stringify({ type: 'reasoning', sessionID: 'ses_x' }), 'run-1')).toEqual([])
  })
})

/** 읽기 도구의 성공 줄. 실측 픽스처와 같은 모양이다 */
const LINE_READ_OK = JSON.stringify({
  type: 'tool_use', sessionID: 'ses_x',
  part: {
    tool: 'read', callID: 'c-read',
    state: { status: 'completed', input: { filePath: '/a' }, output: '<content>\n1: hello\n</content>', metadata: { preview: 'hello' } }
  }
})

describe('tool_result.output·summary (FR-23·25, spec §7-A)', () => {
  it('completed면 state.output이다', () => {
    expect(resultOf('prt_bash_fail').output).toBe(
      ' FAIL  src/auth.test.ts\n  expected true, got false\nTests  1 failed | 11 passed (12)\n'
    )
  })

  it('error면 state.error가 출력이고 요약이다 — 전에는 요약이 따옴표 두 글자였다', () => {
    const ev = resultOf('prt_read_missing')
    expect(ev).toMatchObject({
      ok: false, output: 'File not found: /repo/src/missing.ts', summary: 'File not found: /repo/src/missing.ts'
    })
    expect(resultOf('prt_bash_abort')).toMatchObject({ output: 'Tool execution aborted', summary: 'Tool execution aborted' })
  })

  it('읽기의 원문은 싣지 않는다 — 요약만 남는다(§7-A)', () => {
    const [, ev] = opencodeAdapter.parseLine(LINE_READ_OK, 'run-1')
    expect(ev && 'output' in ev).toBe(false)
    expect(ev).toMatchObject({ summary: '<content>\n1: hello\n</content>' })
  })

  it('끝부분만 남기고 버린 앞부분을 적는다 — 요약은 지금 규칙 그대로다', () => {
    const big = `${'x'.repeat(70_000)}PASS`
    const [, ev] = opencodeAdapter.parseLine(JSON.stringify({
      type: 'tool_use', sessionID: 'ses_x',
      part: { tool: 'bash', callID: 'c', state: { status: 'completed', input: {}, output: big, metadata: { exit: 0 } } }
    }), 'run-1')
    expect(ev).toMatchObject({ type: 'tool_result', outputTruncated: big.length - 65_536 })
    expect(ev && ev.type === 'tool_result' ? ev.output?.endsWith('PASS') : false).toBe(true)
    expect(ev && ev.type === 'tool_result' ? ev.summary : '').toHaveLength(201)
  })

  it('출력이 비었거나 문자열이 아니면 output 키가 없다', () => {
    for (const output of ['', 7, undefined]) {
      const [, ev] = opencodeAdapter.parseLine(JSON.stringify({
        type: 'tool_use', sessionID: 'ses_x',
        part: { tool: 'webfetch', callID: 'c', state: { status: 'completed', input: {}, output } }
      }), 'run-1')
      expect(ev && 'output' in ev).toBe(false)
    }
  })
})

describe('tool_result.detail (FR-24)', () => {
  it('셸 — 성공한 줄도 종료 코드를 안다, 중단된 줄은 중단이다', () => {
    expect(resultOf('prt_bash_fail')).toMatchObject({
      ok: true, detail: { kind: 'shell', exitCode: 1, interrupted: false, timedOut: false }
    })
    expect(resultOf('prt_bash_abort')).toMatchObject({
      ok: false, detail: { kind: 'shell', exitCode: null, interrupted: true }
    })
  })

  it('검색 — grep은 일치한 줄, glob은 파일', () => {
    expect(resultOf('prt_grep').detail).toEqual({ kind: 'search', count: 12, unit: 'matches', truncated: false })
    expect(resultOf('prt_glob').detail).toEqual({ kind: 'search', count: 3, unit: 'files', truncated: false })
  })

  it('edit — 줄 번호가 있는 hunk 둘, No newline 줄은 빠진다, 이전 내용은 없다', () => {
    const detail = resultOf('prt_edit').detail
    expect(detail).toMatchObject({
      kind: 'edit',
      files: [{
        path: '/repo/src/auth.ts', operation: 'edit', added: 3, removed: 2, hunksTruncated: 0,
        hunks: [{ oldStart: 41, newStart: 41 }, { oldStart: 88, oldLines: 2, newStart: 88, newLines: 3 }],
        before: null, beforeMissing: 'unavailable'
      }]
    })
    expect(JSON.stringify(detail)).not.toContain('No newline')
  })

  it('write — 새 파일과 덮어쓰기', () => {
    expect(resultOf('prt_write_new').detail).toMatchObject({
      files: [{ path: '/repo/docs/expiry.md', operation: 'create', hunks: [], beforeMissing: null }]
    })
    expect(resultOf('prt_write_over').detail).toMatchObject({
      files: [{ path: '/repo/README.md', operation: 'overwrite', before: null, beforeMissing: 'unavailable' }]
    })
  })

  it('apply_patch — 파일 셋', () => {
    expect(resultOf('prt_patch').detail).toMatchObject({
      kind: 'edit',
      files: [
        { path: '/repo/src/clock.ts', operation: 'create' },
        { path: '/repo/src/auth.ts', operation: 'edit' },
        { path: '/repo/src/time.ts', operation: 'delete' }
      ]
    })
    // 파일별 patch(머리 줄이 붙은 unified diff)가 줄 번호 hunk로 펴진다 — 1.18.30의 `patch` 키
    expect(resultOf('prt_patch').detail).toMatchObject({
      files: [
        { hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1 }] },
        { hunks: [{ oldStart: 1, lines: ['-import { now } from "./time"', '+import { now } from "./clock"'] }] },
        { hunks: [{ oldStart: 1, oldLines: 1, newStart: 0, newLines: 0 }] }
      ]
    })
  })

  it('task — 하위 세션과 모델, 걸린 시간. 보고는 출력이다', () => {
    expect(resultOf('prt_task')).toMatchObject({
      output: expect.stringContaining('login은 세션 쿠키를 쓴다.'),
      detail: { kind: 'subagent', sessionId: 'ses_child000000000000000000', model: 'claude-sonnet-5', toolCount: null, durationMs: 34000 }
    })
  })

  it('실패한 다른 도구와 읽기는 detail이 없다', () => {
    for (const id of ['prt_read_missing', 'prt_denied_ask', 'prt_denied_rule']) {
      expect('detail' in resultOf(id)).toBe(false)
    }
    const [, ev] = opencodeAdapter.parseLine(LINE_READ_OK, 'run-1')
    expect(ev && 'detail' in ev).toBe(false)
  })

  it('CLI 방언의 원문 필드를 이벤트에 옮기지 않는다(NFR-2)', () => {
    const json = JSON.stringify(EVENT_LINES.flatMap((l) => opencodeAdapter.parseLine(l, 'run-1'))
      .filter((e) => e.type === 'tool_result'))
    for (const key of ['filediff', 'parentSessionId', 'relativePath', 'callID', 'messageID']) {
      expect(json).not.toContain(key)
    }
  })
})

describe('권한 거부 → notice (FR-26)', () => {
  it('묻는 권한의 자동 거부는 tool_use → tool_result → notice 순서다', () => {
    const events = parse('prt_denied_ask')
    expect(events.map((e) => e.type)).toEqual(['tool_use', 'tool_result', 'notice'])
    expect(events[2]).toEqual({
      type: 'notice', runId: 'run-1', at: expect.any(Number),
      kind: 'permission_denied',
      text: '권한 때문에 막힘: bash (묻는 권한은 헤드리스에서 자동으로 거부됩니다)',
      toolUseId: 'call-denied-ask',
      messageId: 'msg_ev5'
    })
    expect(events[1]).toMatchObject({ ok: false, summary: 'The user rejected permission to use this specific tool call.' })
  })

  it('deny 규칙의 거부', () => {
    expect(parse('prt_denied_rule')[2]).toMatchObject({
      type: 'notice', kind: 'permission_denied', text: '권한 때문에 막힘: edit', toolUseId: 'call-denied-rule'
    })
  })

  it('다른 오류 문구는 공지를 내지 않는다', () => {
    expect(parse('prt_read_missing').map((e) => e.type)).toEqual(['tool_use', 'tool_result'])
    expect(parse('prt_bash_abort').map((e) => e.type)).toEqual(['tool_use', 'tool_result'])
  })

  it('completed인 줄은 출력에 같은 문장이 있어도 거부가 아니다', () => {
    const events = opencodeAdapter.parseLine(JSON.stringify({
      type: 'tool_use', sessionID: 'ses_x',
      part: {
        tool: 'bash', callID: 'c',
        state: { status: 'completed', input: {}, output: 'The user rejected permission to use this specific tool call.', metadata: { exit: 0 } }
      }
    }), 'run-1')
    expect(events.map((e) => e.type)).toEqual(['tool_use', 'tool_result'])
  })
})

describe('출처 — messageId (spec §7-A), parentToolUseId 없음 (FR-28)', () => {
  it('text·tool_use·tool_result·reasoning·notice에 part.messageID를 싣는다', () => {
    expect(parse('prt_reason')[0]).toMatchObject({ messageId: 'msg_ev1' })
    expect(parse('prt_edit').map((e) => (e as { messageId?: string }).messageId)).toEqual(['msg_ev3', 'msg_ev3'])
    expect(parse('prt_denied_ask').map((e) => (e as { messageId?: string }).messageId))
      .toEqual(['msg_ev5', 'msg_ev5', 'msg_ev5'])
    expect(parse('prt_text')[0]).toMatchObject({ type: 'text', messageId: 'msg_ev6' })
  })

  it('session·usage·result에는 싣지 않는다', () => {
    const events = [...parse('prt_step'), ...parse('prt_text'), ...parse('prt_finish')]
      .filter((e) => e.type === 'session' || e.type === 'usage' || e.type === 'result')
    expect(events.map((e) => e.type).sort()).toEqual(['result', 'session', 'usage'])
    for (const e of events) expect('messageId' in e).toBe(false)
  })

  it('messageID가 비었거나 문자열이 아니면 키가 없다', () => {
    for (const messageID of ['', 7, undefined]) {
      const [ev] = opencodeAdapter.parseLine(JSON.stringify({
        type: 'text', sessionID: 'ses_x', part: { type: 'text', text: 'x', messageID }
      }), 'run-1')
      expect(ev && 'messageId' in ev).toBe(false)
    }
  })

  it('parentToolUseId는 어느 이벤트에도 없다 — opencode run은 하위 세션의 part를 내보내지 않는다', () => {
    for (const e of EVENT_LINES.flatMap((l) => opencodeAdapter.parseLine(l, 'run-1'))) {
      expect('parentToolUseId' in e).toBe(false)
    }
  })
})

describe('합성 픽스처 전체', () => {
  it('줄마다 내는 이벤트의 종류와 순서', () => {
    // seq는 manager가 붙이므로 이 순서가 곧 화면 순서다(plan 다듬은 것 4)
    expect(EVENT_LINES.map((l) => opencodeAdapter.parseLine(l, 'run-1').map((e) => e.type).join(','))).toEqual([
      'session',
      'reasoning', '',
      'tool_use,tool_result', 'tool_use,tool_result',
      'tool_use,tool_result', 'tool_use,tool_result',
      'tool_use,tool_result', 'tool_use,tool_result', 'tool_use,tool_result', 'tool_use,tool_result',
      'tool_use,tool_result',
      'tool_use,tool_result,notice', 'tool_use,tool_result,notice',
      'tool_use,tool_result',
      'text,result',
      'usage'
    ])
  })
})

describe('TOOL_EFFECTS (FR-27)', () => {
  it('apply_patch는 쓰기다 — 파일을 쓰는데도 other로 떨어졌다', () => {
    expect(parse('prt_patch')[0]).toMatchObject({ type: 'tool_use', name: 'apply_patch', effect: 'write' })
  })
})

/**
 * `{"type":"error"}` 줄 (`docs/sdlc/conversation-fixes/` spec FR-13).
 *
 * json 모드의 opencode는 오류를 stderr에 쓰지 않고 이 줄 하나로 낸다 — 버리면 원인 없는
 * failed가 된다. 모양은 `run.ts`의 `emit("error", { error })`다: `{type, timestamp,
 * sessionID, error}`이고 `error`는 session.error의 NamedError(`{name, data}`)다.
 * CLI 자신도 `data.message`를 먼저, 없으면 `name`을 보여준다.
 */
describe('opencodeAdapter.parseLine — error', () => {
  const errorLine = (error: unknown) => JSON.stringify({
    type: 'error', timestamp: 1788661877138, sessionID: 'ses_x', error
  })

  it('error 줄을 error 이벤트로 낸다 — 메시지는 error.data.message다', () => {
    const out = opencodeAdapter.parseLine(errorLine({
      name: 'APIError',
      data: {
        message: "Error from provider (Console): OpenCode's free tier can only be used from within OpenCode",
        statusCode: 403, isRetryable: false
      }
    }), 'run-1')
    expect(out).toEqual([{
      type: 'error', runId: 'run-1', at: expect.any(Number),
      message: "Error from provider (Console): OpenCode's free tier can only be used from within OpenCode"
    }])
  })

  it('data.message가 없으면 error.message, 그다음 error.name이다', () => {
    const [byMessage] = opencodeAdapter.parseLine(errorLine({ name: 'X', message: '메시지' }), 'run-1')
    expect(byMessage).toMatchObject({ type: 'error', message: '메시지' })
    const [byName] = opencodeAdapter.parseLine(
      errorLine({ name: 'ProviderAuthError', data: { providerID: 'anthropic' } }), 'run-1'
    )
    expect(byName).toMatchObject({ type: 'error', message: 'ProviderAuthError' })
  })

  it('이름조차 없으면 error를 JSON으로 싣는다 — 빈 메시지로 두지 않는다', () => {
    const [event] = opencodeAdapter.parseLine(errorLine({ code: 7 }), 'run-1')
    expect(event).toMatchObject({ type: 'error', message: '{"code":7}' })
  })

  it('error 필드가 없어도 줄을 버리지 않는다', () => {
    const line = JSON.stringify({ type: 'error', sessionID: 'ses_x' })
    const [event] = opencodeAdapter.parseLine(line, 'run-1')
    expect(event).toMatchObject({ type: 'error', message: line })
  })
})

/** 모델·토큰·컨텍스트 (`docs/sdlc/run-info/`). 값은 기록된 실측 픽스처의 모양이다. */
describe('opencodeAdapter.parseLine — usage', () => {
  const stepFinish = (tokens: unknown, cost = 0) => JSON.stringify({
    type: 'step_finish', sessionID: 'ses_x',
    part: { type: 'step-finish', reason: 'tool-calls', tokens, cost }
  })

  it('step_finish 한 줄이 usage 하나가 된다', () => {
    const out = opencodeAdapter.parseLine(stepFinish({
      total: 4017, input: 1765, output: 45, reasoning: 31, cache: { write: 12, read: 2176 }
    }, 0.004), 'run-1')
    expect(out.filter((e) => e.type === 'usage')).toHaveLength(1)
    expect(out[0]).toMatchObject({
      type: 'usage',
      usage: {
        inputTokens: 1765, outputTokens: 45, reasoningTokens: 31,
        cacheReadTokens: 2176, cacheWriteTokens: 12, costUsd: 0.004
      }
    })
  })

  it('contextTokens는 그 스텝의 입력 + 캐시 읽기 + 캐시 쓰기다', () => {
    const out = opencodeAdapter.parseLine(stepFinish({
      total: 4017, input: 1765, output: 45, reasoning: 0, cache: { write: 12, read: 2176 }
    }), 'run-1')
    // 1765 + 2176 + 12 = 3953. total(4017)은 출력까지 포함하므로 컨텍스트가 아니다.
    expect(out[0]).toMatchObject({ usage: { contextTokens: 3953 } })
  })

  it('모델과 컨텍스트 창은 알 수 없어 null이다', () => {
    // OpenCode 스트림에는 모델도 창 크기도 없다 — 지어내지 않는다(spec §3-1).
    const out = opencodeAdapter.parseLine(stepFinish({
      total: 10, input: 5, output: 5, reasoning: 0, cache: { write: 0, read: 0 }
    }), 'run-1')
    expect(out[0]).toMatchObject({ usage: { model: null, contextWindow: null } })
  })

  it('tokens가 없는 step_finish는 usage를 내지 않는다', () => {
    const out = opencodeAdapter.parseLine(JSON.stringify({
      type: 'step_finish', sessionID: 'ses_x', part: { type: 'step-finish', reason: 'stop' }
    }), 'run-1')
    expect(out).toEqual([])
  })

  it('기록된 픽스처의 step_finish 넷이 모두 usage가 된다', () => {
    // 픽스처에는 step_finish가 넷 있다 — 마지막(reason: "stop")까지 포함한다.
    expect(parseAll().filter((e) => e.type === 'usage')).toHaveLength(4)
  })
})
