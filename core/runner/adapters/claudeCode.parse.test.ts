import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { claudeCodeAdapter } from './claudeCode'

const HERE = dirname(fileURLToPath(import.meta.url))
const LINES = readFileSync(resolve(HERE, 'fixtures/claude-stream.jsonl'), 'utf8')
  .split('\n').filter(Boolean)

function parseAll() {
  return LINES.flatMap((line) => claudeCodeAdapter.parseLine(line, 'r1'))
}

describe('claudeCodeAdapter.parseLine', () => {
  it('init에서 세션 id를 뽑는다', () => {
    const ev = parseAll().find((e) => e.type === 'session')
    expect(ev).toMatchObject({ sessionId: '1c84c36a-b05c-45c2-945c-d83bd29ec52f' })
  })

  it('assistant 한 줄에서 text와 tool_use를 모두 뽑는다', () => {
    const events = claudeCodeAdapter.parseLine(LINES[1]!, 'r1')
    expect(events.map((e) => e.type)).toEqual(['text', 'tool_use'])
  })

  it('thinking 블록은 서명 없이 reasoning이 되고, 블록 순서를 지킨다', () => {
    // 옛 결정은 "thinking은 버린다"였다(서명 3~5KB). 이제 본문만 싣는다(conversation-events E3)
    const events = claudeCodeAdapter.parseLine(LINES[3]!, 'r1')
    expect(events.map((e) => e.type)).toEqual(['reasoning', 'tool_use'])
    expect(events[0]).toMatchObject({ text: '음...', startedAt: null, endedAt: null })
    expect(JSON.stringify(events)).not.toContain('AAAAAAAA')
  })

  it('도구 결과는 type이 user인 줄에서 나온다', () => {
    const events = claudeCodeAdapter.parseLine(LINES[2]!, 'r1')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'tool_result', ok: true })
  })

  it('성공한 도구 결과는 is_error 필드가 없어도 ok로 판정한다', () => {
    const ok = parseAll().filter((e) => e.type === 'tool_result')
    expect(ok[0]).toMatchObject({ ok: true })
    expect(ok[1]).toMatchObject({ ok: false })
  })

  it('Read는 read, Edit는 write로 효과를 판정하고 경로를 뽑는다', () => {
    const uses = parseAll().filter((e) => e.type === 'tool_use')
    expect(uses[0]).toMatchObject({ effect: 'read', targetPaths: ['/tmp/repo/src/auth.ts'] })
    expect(uses[1]).toMatchObject({ effect: 'write', targetPaths: ['/tmp/repo/src/auth.ts'] })
  })

  it('result에서 상태와 결과 텍스트를 뽑는다', () => {
    const ev = parseAll().find((e) => e.type === 'result')
    expect(ev).toMatchObject({ status: 'succeeded', resultText: '수정을 마쳤습니다.' })
  })

  it('[NEEDS_ANSWER] 표식을 감지하고 결과 텍스트에서 제거한다', () => {
    const line = JSON.stringify({
      type: 'result', subtype: 'success', is_error: false,
      result: '[NEEDS_ANSWER]\nA와 B 중 어느 쪽으로 할까요?', session_id: 's'
    })
    const [ev] = claudeCodeAdapter.parseLine(line, 'r1')
    expect(ev).toMatchObject({
      needsAnswer: true,
      resultText: 'A와 B 중 어느 쪽으로 할까요?'
    })
  })

  it('text 블록의 [NEEDS_ANSWER] 표식도 제거한다', () => {
    // 실측: 같은 내용이 assistant 텍스트 블록으로 먼저 흐르고 result에 다시 담긴다.
    // result에서만 벗겨내면 표식이 도크 로그에 날것으로 새어나온다.
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '[NEEDS_ANSWER]\nA와 B 중 어느 쪽인가요?' }] }
    })
    const [ev] = claudeCodeAdapter.parseLine(line, 'r1')
    expect(ev).toMatchObject({ type: 'text', text: 'A와 B 중 어느 쪽인가요?' })
  })

  it('표식이 없는 text는 그대로 둔다', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '  들여쓴 그대로  ' }] }
    })
    const [ev] = claudeCodeAdapter.parseLine(line, 'r1')
    expect(ev).toMatchObject({ text: '  들여쓴 그대로  ' })
  })

  it('관심 없는 줄은 빈 배열을 반환한다', () => {
    expect(claudeCodeAdapter.parseLine(LINES[5]!, 'r1')).toEqual([])
  })

  it('깨진 JSON은 raw 이벤트로 남기고 예외를 던지지 않는다', () => {
    const events = claudeCodeAdapter.parseLine('{깨진 줄', 'r1')
    expect(events).toEqual([expect.objectContaining({ type: 'raw', line: '{깨진 줄' })])
  })

  it('객체가 아닌 JSON 줄은 깨진 줄과 같다 — 던지면 stdout 핸들러 안이라 메인 프로세스가 죽는다', () => {
    // 리뷰 반영 2026-09-27: `null`·수·배열도 JSON으로는 읽힌다. 그 뒤 `obj['type']`에서 던졌다.
    for (const line of ['null', '7', '"글"', '[1,2]']) {
      expect(claudeCodeAdapter.parseLine(line, 'r1'), line).toEqual([expect.objectContaining({ type: 'raw', line })])
    }
  })

  it('content 배열의 null·객체 아닌 원소는 건너뛴다', () => {
    const user = JSON.stringify({
      type: 'user',
      message: { content: [null, 7, { type: 'tool_result', tool_use_id: 't1', content: '끝' }] }
    })
    expect(claudeCodeAdapter.parseLine(user, 'r1'))
      .toEqual([expect.objectContaining({ type: 'tool_result', toolUseId: 't1', ok: true })])
    const assistant = JSON.stringify({
      type: 'assistant', message: { content: [null, { type: 'text', text: '안녕' }] }
    })
    expect(claudeCodeAdapter.parseLine(assistant, 'r1'))
      .toEqual([expect.objectContaining({ type: 'text', text: '안녕' })])
  })
})

/**
 * **옛 줄 호환** (`docs/sdlc/conversation-events/` plan 1단계). conversation-events를 구현하기 **전의**
 * 어댑터로 `claude-stream.jsonl`을 파싱한 결과를 그대로 적어 두었다(`at`은 뺀다). 새 필드가 없는
 * 옛 모양의 줄은 구현 뒤에도 기존 필드가 한 글자도 바뀌지 않아야 한다.
 *
 * 달라져도 되는 것은 둘뿐이다 — 새 선택 필드가 **더해지는 것**(`output` 등, 아래 NEW_KEYS),
 * 그리고 thinking 줄(4행)의 thinking 블록이 reasoning이 되는 것(E3). 4행은 따로 본다.
 */
describe('옛 줄 호환 — 구현 전 어댑터의 출력', () => {
  const BEFORE: Record<number, unknown[]> = {
    0: [{ type: 'session', runId: 'r1', sessionId: '1c84c36a-b05c-45c2-945c-d83bd29ec52f' }],
    1: [
      { type: 'text', runId: 'r1', text: '파일을 읽어보겠습니다.' },
      {
        type: 'tool_use', runId: 'r1', toolUseId: 'toolu_018djaMLPCX6VaRd4frEcBJa', name: 'Read',
        effect: 'read', targetPaths: ['/tmp/repo/src/auth.ts'], input: { file_path: '/tmp/repo/src/auth.ts' }
      }
    ],
    2: [{
      type: 'tool_result', runId: 'r1', toolUseId: 'toolu_018djaMLPCX6VaRd4frEcBJa', ok: true,
      summary: 'export function auth() {}'
    }],
    3: [{
      type: 'tool_use', runId: 'r1', toolUseId: 'toolu_02', name: 'Edit', effect: 'write',
      targetPaths: ['/tmp/repo/src/auth.ts'],
      input: { file_path: '/tmp/repo/src/auth.ts', old_string: 'a', new_string: 'b' }
    }],
    4: [{ type: 'tool_result', runId: 'r1', toolUseId: 'toolu_02', ok: false, summary: 'permission denied' }],
    5: [],
    6: [{
      type: 'result', runId: 'r1', status: 'succeeded', resultText: '수정을 마쳤습니다.',
      sessionId: '1c84c36a-b05c-45c2-945c-d83bd29ec52f', needsAnswer: false
    }]
  }
  /** 이 기능이 더한 선택 필드. 옛 모양의 줄에서 더해질 수 있는 것은 이것뿐이다 */
  const NEW_KEYS = ['output', 'outputTruncated', 'detail', 'parentToolUseId', 'messageId']

  /** `at`(시각)과 새 필드를 뺀다 — 남는 것이 구현 전과 비교할 기존 필드다 */
  function withoutNew(e: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'at' && !NEW_KEYS.includes(k)))
  }

  it.each(Object.keys(BEFORE).map(Number))('%i행의 기존 필드는 그대로다', (i) => {
    const events = claudeCodeAdapter.parseLine(LINES[i]!, 'r1')
      .filter((e) => e.type !== 'reasoning') as unknown as Record<string, unknown>[]
    expect(events.map(withoutNew)).toEqual(BEFORE[i])
  })

  it('옛 줄에 붙는 새 필드는 도구 결과의 output뿐이다', () => {
    // 옛 줄에는 tool_use_result·uuid·parent_tool_use_id가 없다 — detail·출처가 생길 자리가 없다
    const added = parseAll().flatMap((e) => Object.keys(e).filter((k) => NEW_KEYS.includes(k)))
    expect(added.sort()).toEqual(['output', 'output'])
    const results = parseAll().filter((e) => e.type === 'tool_result')
    expect(results.map((e) => 'output' in e ? e.output : null))
      .toEqual(['export function auth() {}', 'permission denied'])
  })
})

/**
 * 합성 픽스처 `claude-events.jsonl` (plan 1단계). **모양의 출처** — 모델을 부르는 실행을 하지 않았으므로
 * 스트림을 새로 뜨지 않았다(spec §7 우려 3):
 * - 스키마: claude 2.1.280 바이너리의 SDK 메시지 zod 스키마 문자열 — `user` 줄의 `tool_use_result`·
 *   `parent_tool_use_id`·`uuid`, system 하위 타입(`compact_boundary`·`api_retry`·`permission_denied`·
 *   `model_fallback`), `result.permission_denials`
 * - 기록: 이 장비의 세션 기록 39개의 `toolUseResult` 키 모양(Edit·Write·Bash·실패 문자열·Grep content·
 *   비동기 Agent). assistant 줄이 **블록 하나씩** 오는 것도 기록에서 본 것이다(5,492줄 전부)
 * - 픽스처: `claude-stream.jsonl`의 thinking 블록 모양(`{type, thinking, signature}`)
 * 실제 run의 `raw.jsonl`이 생기면 그 줄로 바꾼다(plan 완료 증명의 후속 항목).
 */
const EVENT_LINES = readFileSync(resolve(HERE, 'fixtures/claude-events.jsonl'), 'utf8')
  .split('\n').filter(Boolean)

/** 줄을 uuid로 찾는다 — 픽스처에 줄을 더해도 테스트가 밀리지 않는다 */
function lineOf(uuid: string): string {
  const found = EVENT_LINES.find((l) => (JSON.parse(l) as { uuid?: string }).uuid === uuid)
  if (!found) throw new Error(`픽스처에 ${uuid} 줄이 없다`)
  return found
}

function parse(uuid: string) {
  return claudeCodeAdapter.parseLine(lineOf(uuid), 'r1')
}

function resultOf(uuid: string) {
  const ev = parse(uuid).find((e) => e.type === 'tool_result')
  if (!ev || ev.type !== 'tool_result') throw new Error(`${uuid}에서 tool_result가 나오지 않았다`)
  return ev
}

describe('thinking → reasoning (FR-15, spec §7-A)', () => {
  it('본문을 싣고 서명은 어디에도 싣지 않는다', () => {
    const signature = (JSON.parse(lineOf('u-think')) as {
      message: { content: { signature: string }[] }
    }).message.content[0]!.signature
    expect(signature.length).toBeGreaterThanOrEqual(4096)

    const events = parse('u-think')
    expect(events).toEqual([expect.objectContaining({
      type: 'reasoning', text: '테스트가 왜 깨지는지 먼저 본다.', startedAt: null, endedAt: null
    })])
    const json = JSON.stringify(events)
    expect(json).not.toContain(signature)
    expect(json).not.toContain('signature')
  })

  it('상한 이하면 truncated 키가 없다', () => {
    expect('truncated' in parse('u-think')[0]!).toBe(false)
  })

  it('긴 생각은 앞부분만 남기고 버린 글자 수를 적는다', () => {
    const long = `처음${'생'.repeat(70_000)}`
    const [ev] = claudeCodeAdapter.parseLine(JSON.stringify({
      type: 'assistant', message: { content: [{ type: 'thinking', thinking: long, signature: 'x' }] }
    }), 'r1')
    expect(ev).toMatchObject({ type: 'reasoning', truncated: long.length - 65_536 })
    expect(ev && ev.type === 'reasoning' ? ev.text.startsWith('처음') : false).toBe(true)
  })

  it('본문이 빈 thinking은 이벤트를 내지 않는다 — 활동 묶음을 끊고 창을 차지하지 않게(spec §9-1 결정)', () => {
    // claude의 생각은 대부분 서명만 온다(기록 1,851개 중 1,800개). 빈 생각을 "생각 · N초" 줄로 내면
    // 도구 호출마다 줄이 끼어 펼친 턴의 묶음이 조각나고, 2,000개 창과 IPC push를 소비한다.
    expect(parse('u-think-empty')).toEqual([])
  })

  it('공백뿐인 본문도 이벤트를 내지 않는다', () => {
    expect(claudeCodeAdapter.parseLine(JSON.stringify({
      type: 'assistant', message: { content: [{ type: 'thinking', thinking: ' \n ', signature: 'x' }] }
    }), 'r1')).toEqual([])
  })

  it('redacted_thinking은 버린다', () => {
    expect(parse('u-redacted')).toEqual([])
    expect(JSON.stringify(EVENT_LINES.flatMap((l) => claudeCodeAdapter.parseLine(l, 'r1'))))
      .not.toContain('ENCRYPTED')
  })
})

describe('tool_result.output (FR-13, spec §7-A)', () => {
  it('문자열 content가 output이다 — 모델이 본 그 글', () => {
    expect(resultOf('u-bash-result')).toMatchObject({ output: 'Tests  12 passed (12)\nPASS' })
  })

  it('배열 content는 text를 잇고 이미지는 [이미지] — base64가 이벤트에 없다', () => {
    const ev = resultOf('u-mcp-result')
    expect(ev.output).toBe('이슈 2개\n[이미지]')
    expect(JSON.stringify(ev.output)).not.toContain('iVBORw0KGgo')
  })

  it('끝부분만 남기고 버린 앞부분을 적는다', () => {
    const big = `${'x'.repeat(70_000)}PASS`
    const ev = claudeCodeAdapter.parseLine(JSON.stringify({
      type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: big }] }
    }), 'r1')[0]
    expect(ev).toMatchObject({ type: 'tool_result', outputTruncated: big.length - 65_536 })
    expect(ev && ev.type === 'tool_result' ? ev.output?.endsWith('PASS') : false).toBe(true)
    // 요약은 지금 규칙 그대로다(FR-9)
    expect(ev && ev.type === 'tool_result' ? ev.summary : '').toHaveLength(201)
  })

  it('비었으면 output 키가 없다', () => {
    const [ev] = claudeCodeAdapter.parseLine(JSON.stringify({
      type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: '' }] }
    }), 'r1')
    expect(ev && 'output' in ev).toBe(false)
  })

  it('읽기 도구의 원문은 싣지 않는다 — 요약만 남는다(§7-A)', () => {
    const ev = resultOf('u-child-result')
    expect('output' in ev).toBe(false)
    expect(ev.summary).toContain('export function login')
  })

  it('실패한 도구의 output은 오류 글이다', () => {
    expect(resultOf('u-bash-fail-result')).toMatchObject({
      ok: false, output: 'Exit code 2\nerror  no-unused-vars'
    })
  })
})

describe('tool_result.detail (FR-14)', () => {
  it('Edit — 줄 번호가 있는 hunk와 원본', () => {
    expect(resultOf('u-edit-result').detail).toMatchObject({
      kind: 'edit',
      files: [{
        path: '/repo/src/auth.ts', operation: 'edit', added: 1, removed: 1,
        hunks: [{ oldStart: 41, newStart: 41 }], beforeMissing: null
      }]
    })
  })

  it('Write create·update', () => {
    expect(resultOf('u-write-new-result').detail).toMatchObject({ files: [{ operation: 'create', hunks: [] }] })
    expect(resultOf('u-write-over-result').detail).toMatchObject({
      files: [{ operation: 'overwrite', before: '# 옛 제목\n' }]
    })
  })

  it('셸 — 성공은 코드를 모르고 실패는 Exit code에서 읽는다', () => {
    expect(resultOf('u-bash-result').detail).toEqual({ kind: 'shell', exitCode: null, interrupted: false, timedOut: false })
    expect(resultOf('u-ps-result').detail).toMatchObject({ kind: 'shell' })
    expect(resultOf('u-bash-fail-result').detail).toMatchObject({ kind: 'shell', exitCode: 2 })
  })

  it('검색 — 모드마다 단위가 다르다', () => {
    expect(resultOf('u-grep-files-result').detail).toMatchObject({ count: 3, unit: 'files' })
    expect(resultOf('u-grep-content-result').detail).toMatchObject({ count: 3, unit: 'lines' })
    expect(resultOf('u-grep-count-result').detail).toMatchObject({ count: 3, unit: 'matches' })
    expect(resultOf('u-glob-result').detail).toMatchObject({ count: 2, unit: 'files' })
  })

  it('하위 에이전트 — 동기와 비동기', () => {
    expect(resultOf('u-agent-result')).toMatchObject({
      output: 'login은 세션을 쓴다.',
      detail: { kind: 'subagent', toolCount: 1, durationMs: 34000, model: 'claude-sonnet-5' }
    })
    expect(resultOf('u-agent-bg-result').detail).toMatchObject({ kind: 'subagent', toolCount: null, model: 'claude-haiku-5' })
  })

  it('MCP·읽기·권한 거부 문자열은 detail이 없다', () => {
    for (const uuid of ['u-mcp-result', 'u-child-result', 'u-denied-result']) {
      expect('detail' in resultOf(uuid)).toBe(false)
    }
  })

  it('결과 블록이 여럿인 줄에서는 tool_use_result를 어느 결과에도 붙이지 않는다', () => {
    // tool_use_result는 줄에 하나다 — 어느 블록의 것인지 모르면 엉뚱한 결과에 붙이느니 싣지 않는다
    const events = claudeCodeAdapter.parseLine(JSON.stringify({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'a', content: 'PASS' },
          { type: 'tool_result', tool_use_id: 'b', content: 'src/a.ts' }
        ]
      },
      tool_use_result: { stdout: 'PASS', stderr: '', interrupted: false }
    }), 'r1')
    expect(events.map((e) => e.type)).toEqual(['tool_result', 'tool_result'])
    for (const e of events) expect('detail' in e).toBe(false)
    // 원문 출력도 싣지 않는다 — 읽기인지 가르는 것이 tool_use_result의 모양뿐이라, 어느 블록의 것인지
    // 모르는 줄에서는 파일 내용(읽기 결과)이 로그·IPC로 새지 않게 보수적으로 뺀다(§7-A, 리뷰 반영
    // 2026-09-27). 요약(200자)은 지금 그대로다.
    for (const e of events) expect('output' in e).toBe(false)
    expect(events.map((e) => e.type === 'tool_result' ? e.summary : null)).toEqual(['PASS', 'src/a.ts'])
  })

  it('하위 에이전트가 넘긴 결과 줄도 tool_use_result로 읽기를 가른다', () => {
    // 2.1.280은 하위 에이전트의 user 줄에도 tool_use_result를 싣는다(parent_tool_use_id와 함께)
    const [ev] = claudeCodeAdapter.parseLine(JSON.stringify({
      type: 'user', parent_tool_use_id: 'toolu_agent',
      message: { content: [{ type: 'tool_result', tool_use_id: 'c', content: '비밀=값' }] },
      tool_use_result: { type: 'text', file: { filePath: '/repo/.env', content: '비밀=값', numLines: 1, startLine: 1, totalLines: 1 } }
    }), 'r1')
    expect(ev).toMatchObject({ type: 'tool_result', parentToolUseId: 'toolu_agent' })
    expect(ev && 'output' in ev).toBe(false)
  })

  it('CLI 방언의 원문 필드를 이벤트에 옮기지 않는다', () => {
    // oldString·structuredPatch 같은 이름은 어댑터 밖으로 나가지 않는다(NFR-2)
    const json = JSON.stringify(EVENT_LINES.flatMap((l) => claudeCodeAdapter.parseLine(l, 'r1'))
      .filter((e) => e.type === 'tool_result'))
    for (const key of ['tool_use_result', 'structuredPatch', 'originalFile', 'oldString', 'filenames', 'stdout']) {
      expect(json).not.toContain(key)
    }
  })
})

describe('출처 — parentToolUseId·messageId (FR-16·17, FR-7)', () => {
  it('하위 에이전트의 줄은 부모 호출 id와 메시지 id를 싣는다', () => {
    expect(parse('u-child-use')[0]).toMatchObject({
      type: 'tool_use', parentToolUseId: 'toolu_agent', messageId: 'u-child-use'
    })
    expect(resultOf('u-child-result')).toMatchObject({
      parentToolUseId: 'toolu_agent', messageId: 'u-child-result'
    })
  })

  it('메인 스레드의 이벤트에는 parentToolUseId 키 자체가 없다', () => {
    // null로 채우면 로그가 늘기만 하고 옛 로그와 모양이 갈린다
    const main = EVENT_LINES
      .filter((l) => !(JSON.parse(l) as { parent_tool_use_id?: unknown }).parent_tool_use_id)
      .flatMap((l) => claudeCodeAdapter.parseLine(l, 'r1'))
    expect(main.length).toBeGreaterThan(20)
    for (const e of main) expect('parentToolUseId' in e).toBe(false)
  })

  it('text·tool_use·reasoning·tool_result·notice에 messageId를 싣는다', () => {
    expect(parse('u-think')[0]).toMatchObject({ messageId: 'u-think' })
    expect(parse('u-final-text')[0]).toMatchObject({ type: 'text', messageId: 'u-final-text' })
    expect(parse('u-edit-use')[0]).toMatchObject({ type: 'tool_use', messageId: 'u-edit-use' })
    expect(resultOf('u-edit-result')).toMatchObject({ messageId: 'u-edit-result' })
    expect(parse('u-compact')[0]).toMatchObject({ type: 'notice', messageId: 'u-compact' })
  })

  it('session·usage·result에는 messageId를 싣지 않는다', () => {
    const events = [...parse('u-init'), ...parse('u-result')]
      .filter((e) => e.type === 'session' || e.type === 'usage' || e.type === 'result')
    expect(events.map((e) => e.type).sort()).toEqual(['result', 'session', 'usage', 'usage'])
    for (const e of events) expect('messageId' in e).toBe(false)
  })

  it('uuid·parent_tool_use_id가 비었거나 문자열이 아니면 싣지 않는다', () => {
    const [ev] = claudeCodeAdapter.parseLine(JSON.stringify({
      type: 'assistant', uuid: '', parent_tool_use_id: 7,
      message: { content: [{ type: 'text', text: 'x' }] }
    }), 'r1')
    expect(ev && ('messageId' in ev || 'parentToolUseId' in ev)).toBe(false)
  })
})

describe('system 줄 → notice (FR-18)', () => {
  it('압축·재시도·권한 거부·모델 대체가 공지 하나씩이 된다', () => {
    expect(parse('u-compact')).toEqual([expect.objectContaining({
      type: 'notice', kind: 'compact', text: '대화가 압축됨 · 자동 · 153,214 → 12,400 토큰'
    })])
    expect(parse('u-retry')).toEqual([expect.objectContaining({
      type: 'notice', kind: 'retry', text: 'API 재시도 중 · 2/10번째 · 5초 뒤 · 529'
    })])
    expect(parse('u-denied-system')).toEqual([expect.objectContaining({
      type: 'notice', kind: 'permission_denied', text: '권한 때문에 막힘: Bash', toolUseId: 'toolu_denied'
    })])
    expect(parse('u-fallback')).toEqual([expect.objectContaining({
      type: 'notice', kind: 'model_fallback', text: '모델 대체: claude-opus-5 → claude-sonnet-5 (과부하)'
    })])
  })

  it('status 같은 버리는 subtype은 아무 이벤트도 내지 않는다', () => {
    expect(parse('u-status')).toEqual([])
  })

  it('필수 필드가 없는 공지 줄은 raw로도 만들지 않는다 — 줄은 JSON으로 읽혔다', () => {
    expect(claudeCodeAdapter.parseLine(JSON.stringify({ type: 'system', subtype: 'api_retry' }), 'r1')).toEqual([])
  })

  it('init은 지금 그대로다 — 공지를 내지 않는다', () => {
    expect(parse('u-init').map((e) => e.type)).toEqual(['session', 'usage'])
  })
})

describe('result.permission_denials → notice (FR-19)', () => {
  it('한 result 줄은 result → usage → notice… 순서로 낸다', () => {
    const events = parse('u-result')
    expect(events.map((e) => e.type)).toEqual(['result', 'usage', 'notice', 'notice'])
    expect(events.slice(2)).toEqual([
      expect.objectContaining({ kind: 'permission_denied', text: '권한 때문에 막힘: Bash', toolUseId: 'toolu_denied', messageId: 'u-result' }),
      expect.objectContaining({ kind: 'permission_denied', text: '권한 때문에 막힘: Write', toolUseId: 'toolu_denied_write' })
    ])
  })

  it('system 줄에서 이미 온 거부도 거르지 않는다 — parseLine은 한 줄만 본다(NFR-3)', () => {
    const all = EVENT_LINES.flatMap((l) => claudeCodeAdapter.parseLine(l, 'r1'))
    const denied = all.filter((e) => e.type === 'notice' && e.toolUseId === 'toolu_denied')
    expect(denied).toHaveLength(2)
  })
})

describe('합성 픽스처 전체', () => {
  it('줄마다 내는 이벤트의 종류와 순서', () => {
    // seq는 manager가 붙이므로 이 순서가 곧 화면 순서다(plan 다듬은 것 4)
    const types = EVENT_LINES.map((l) => claudeCodeAdapter.parseLine(l, 'r1').map((e) => e.type).join(','))
    // 생각 줄 둘 중 본문이 빈 하나(u-think-empty)는 이벤트를 내지 않는다(spec §9-1 결정)
    expect(types.filter((t) => t.includes('reasoning'))).toEqual(['reasoning'])
    expect(types.filter((t) => t.includes('notice'))).toEqual([
      'notice', 'notice', 'notice', 'notice', 'result,usage,notice,notice'
    ])
    // 깨진 줄이 없다 — 합성 픽스처가 JSON으로 읽힌다
    expect(types.some((t) => t.includes('raw'))).toBe(false)
  })
})

describe('TOOL_EFFECTS (FR-20)', () => {
  it('PowerShell은 실행이다 — Windows의 claude는 셸로 PowerShell을 쓴다', () => {
    expect(parse('u-ps-use')[0]).toMatchObject({ type: 'tool_use', name: 'PowerShell', effect: 'execute' })
  })
})

describe('init의 MCP 연결 상태', () => {
  function initLine(servers: unknown): string {
    return JSON.stringify({
      type: 'system', subtype: 'init', session_id: 's1', mcp_servers: servers
    })
  }

  it('연결에 실패한 서버가 있으면 error 이벤트를 낸다', () => {
    // CLI는 첫 줄에 연결 상태를 알려준다. 흘려보내면 MCP가 통째로 죽은
    // run이 조용히 "성공"으로 끝나고, 사용자는 이유를 알 방법이 없다.
    const out = claudeCodeAdapter.parseLine(
      initLine([{ name: 'one-desk', status: 'failed' }]), 'r1'
    )
    const err = out.find((e) => e.type === 'error')
    expect(err).toBeDefined()
    expect(err && 'message' in err ? err.message : '').toContain('one-desk')
  })

  it('연결에 성공하면 error를 내지 않는다', () => {
    const out = claudeCodeAdapter.parseLine(
      initLine([{ name: 'one-desk', status: 'connected' }]), 'r1'
    )
    expect(out.find((e) => e.type === 'error')).toBeUndefined()
  })

  it('실패해도 세션 id는 그대로 뽑는다', () => {
    const out = claudeCodeAdapter.parseLine(
      initLine([{ name: 'one-desk', status: 'failed' }]), 'r1'
    )
    expect(out.find((e) => e.type === 'session')).toMatchObject({ sessionId: 's1' })
  })

  it('mcp_servers가 없는 init에도 error를 내지 않는다', () => {
    const out = claudeCodeAdapter.parseLine(
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }), 'r1'
    )
    expect(out.find((e) => e.type === 'error')).toBeUndefined()
  })
})

/**
 * 모델·토큰·컨텍스트 (`docs/sdlc/run-info/`). 값은 2026-09-21에 claude 2.1.278로
 * 실측한 모양 그대로다.
 */
describe('claudeCodeAdapter.parseLine — usage', () => {
  const resultLine = (usage: unknown, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      type: 'result', subtype: 'success', session_id: 's1', result: '끝',
      ...(usage === undefined ? {} : { usage }),
      ...extra
    })

  it('init에서 실제로 쓰인 모델을 뽑는다', () => {
    const out = claudeCodeAdapter.parseLine(
      JSON.stringify({
        type: 'system', subtype: 'init', session_id: 's1', model: 'claude-opus-5[1m]'
      }), 'r1'
    )
    const ev = out.find((e) => e.type === 'usage')
    // 사용자가 모델 칸을 비워도 무엇이 돌았는지 알 수 있는 유일한 자리다.
    expect(ev).toMatchObject({ usage: { model: 'claude-opus-5[1m]' } })
  })

  it('model이 없는 init은 usage를 내지 않는다', () => {
    const out = claudeCodeAdapter.parseLine(
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }), 'r1'
    )
    expect(out.find((e) => e.type === 'usage')).toBeUndefined()
  })

  it('result에서 토큰과 비용을 뽑는다', () => {
    const out = claudeCodeAdapter.parseLine(resultLine({
      input_tokens: 2,
      output_tokens: 4,
      cache_read_input_tokens: 15428,
      cache_creation_input_tokens: 37917,
      output_tokens_details: { thinking_tokens: 11 }
    }, { total_cost_usd: 0.386994 }), 'r1')
    expect(out.find((e) => e.type === 'usage')).toMatchObject({
      usage: {
        inputTokens: 2, outputTokens: 4,
        cacheReadTokens: 15428, cacheWriteTokens: 37917,
        reasoningTokens: 11, costUsd: 0.386994
      }
    })
  })

  it('contextTokens는 iterations의 마지막 요청으로 잰다', () => {
    // 합이 아니라 마지막 하나다 — 합으로 재면 도구를 쓴 턴에서 창을 넘는다(spec §3-2).
    const out = claudeCodeAdapter.parseLine(resultLine({
      input_tokens: 12, output_tokens: 8,
      cache_read_input_tokens: 500, cache_creation_input_tokens: 100,
      iterations: [
        { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 100 },
        { input_tokens: 2, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 }
      ]
    }), 'r1')
    // 마지막 = 2 + 500 + 0 = 502. 앞의 것(110)이나 합(612)이 아니다.
    expect(out.find((e) => e.type === 'usage')).toMatchObject({
      usage: { contextTokens: 502 }
    })
  })

  it('iterations가 없으면 컨텍스트를 모른다 — 최상위 합으로 대신하지 않는다 (docs/sdlc/context-occupancy/)', () => {
    // 최상위는 턴 안의 모든 요청을 더한 값이다. 도구를 쓴 턴이면 점유의 몇 배라 링이 100%로
    // 튀었다가 가벼운 턴에 다시 떨어진다. 틀린 비율보다 "모름"이 낫다.
    const out = claudeCodeAdapter.parseLine(resultLine({
      input_tokens: 2, output_tokens: 4,
      cache_read_input_tokens: 15428, cache_creation_input_tokens: 37917
    }), 'r1')
    const ev = out.find((e) => e.type === 'usage')
    // 토큰 합계는 그대로 싣는다 — 모르는 것은 점유뿐이다.
    expect(ev).toMatchObject({ usage: { contextTokens: null, cacheReadTokens: 15428 } })
  })

  it('iterations가 빈 배열이어도 컨텍스트를 모른다', () => {
    const out = claudeCodeAdapter.parseLine(resultLine({
      input_tokens: 2, cache_read_input_tokens: 100, iterations: []
    }), 'r1')
    expect(out.find((e) => e.type === 'usage')).toMatchObject({ usage: { contextTokens: null } })
  })

  it('modelUsage에서 컨텍스트 창 크기를 뽑는다', () => {
    const out = claudeCodeAdapter.parseLine(resultLine(
      { input_tokens: 1, output_tokens: 1 },
      { modelUsage: { 'claude-opus-5[1m]': { contextWindow: 1000000, costUSD: 0.5 } } }
    ), 'r1')
    expect(out.find((e) => e.type === 'usage')).toMatchObject({
      usage: { contextWindow: 1000000 }
    })
  })

  it.each([
    ['보조 모델이 앞', ['haiku', 'opus']],
    ['보조 모델이 뒤', ['opus', 'haiku']]
  ])('모델이 여럿이면 프롬프트를 가장 많이 처리한 모델의 창을 쓴다 — 순서와 무관하다 (%s)', (_, order) => {
    // 보조 모델(작은 창)이 앞에 와도 대화를 실제로 돈 모델의 창으로 나눠야 한다.
    const entries: Record<string, [string, Record<string, number>]> = {
      haiku: ['claude-haiku-4-5', {
        inputTokens: 300, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, contextWindow: 200000
      }],
      opus: ['claude-opus-5[1m]', {
        inputTokens: 2, cacheReadInputTokens: 15428, cacheCreationInputTokens: 37917, contextWindow: 1000000
      }]
    }
    const out = claudeCodeAdapter.parseLine(resultLine(
      { input_tokens: 1, output_tokens: 1 },
      { modelUsage: Object.fromEntries(order.map((k) => entries[k]!)) }
    ), 'r1')
    expect(out.find((e) => e.type === 'usage')).toMatchObject({
      usage: { contextWindow: 1000000 }
    })
  })

  it('usage가 없는 옛 result 줄은 usage 이벤트를 내지 않는다', () => {
    const out = claudeCodeAdapter.parseLine(resultLine(undefined), 'r1')
    expect(out.find((e) => e.type === 'usage')).toBeUndefined()
    // result 자체는 그대로 나와야 한다.
    expect(out.find((e) => e.type === 'result')).toBeDefined()
  })

  it('rate_limit_event는 아무 이벤트도 내지 않는다 — 요금제 사용률은 parsePlanUsage로만 읽는다', () => {
    // 개인 구독 정보다 — 파싱하지 않는 것이 결정이고, 그 금지를 여기서 고정한다(spec §7).
    const out = claudeCodeAdapter.parseLine(JSON.stringify({
      type: 'rate_limit_event', session_id: 's1',
      rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.03 } } }
    }), 'r1')
    expect(out).toEqual([])
  })
})

/** 요금제 사용률 (`docs/sdlc/plan-usage/` FR-2·FR-3). 실측(2.1.283) 모양 그대로다. */
describe('claudeCodeAdapter.parsePlanUsage', () => {
  const line = (info: Record<string, unknown>) => JSON.stringify({
    type: 'rate_limit_event', uuid: 'u1', session_id: 's1', rate_limit_info: info
  })
  const measured = {
    status: 'allowed', resetsAt: 1790608200, rateLimitType: 'five_hour',
    overageStatus: 'rejected', overageDisabledReason: 'out_of_credits', isUsingOverage: false,
    unifiedWindows: {
      five_hour: { utilization: 0.06, resetsAt: 1790608200 },
      seven_day: { utilization: 0.02, resetsAt: 1791180000 }
    }
  }

  it('창마다 사용률과 리셋 시각(ms)을 읽는다 — 초과 사용·크레딧 상태는 싣지 않는다', () => {
    expect(claudeCodeAdapter.parsePlanUsage!(line(measured))).toEqual({
      fiveHour: { utilization: 0.06, resetsAt: 1790608200_000 },
      sevenDay: { utilization: 0.02, resetsAt: 1791180000_000 },
      limited: false
    })
  })

  it('status가 rejected면 막힌 것이다', () => {
    expect(claudeCodeAdapter.parsePlanUsage!(line({ ...measured, status: 'rejected' })))
      .toMatchObject({ limited: true })
  })

  it('모양이 어긋난 창은 null이다 — 반쯤 맞는 값을 싣지 않는다', () => {
    const out = claudeCodeAdapter.parsePlanUsage!(line({
      ...measured,
      unifiedWindows: { five_hour: { utilization: '6%', resetsAt: 1 }, seven_day: { utilization: 0.02 } }
    }))
    expect(out).toEqual({ fiveHour: null, sevenDay: null, limited: false })
  })

  it('창이 하나도 없으면 null이다', () => {
    expect(claudeCodeAdapter.parsePlanUsage!(line({ status: 'allowed' }))).toBeNull()
  })

  it.each([
    ['다른 종류의 줄', JSON.stringify({ type: 'result', usage: {} })],
    ['깨진 줄', '{"type":"rate_limit_event",'],
    ['JSON이 아닌 줄', 'hello']
  ])('%s은 null이다', (_, text) => {
    expect(claudeCodeAdapter.parsePlanUsage!(text)).toBeNull()
  })

  it('글자로만 걸러지지 않는다 — 그 이름을 말한 assistant 줄은 아니다', () => {
    const text = JSON.stringify({
      type: 'assistant', message: { content: [{ type: 'text', text: '"type":"rate_limit_event" 줄이 온다' }] }
    })
    expect(claudeCodeAdapter.parsePlanUsage!(text)).toBeNull()
  })
})
