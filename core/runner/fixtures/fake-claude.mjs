#!/usr/bin/env node
// 인자로 받은 시나리오대로 stream-json을 흉내낸다.
// --scenario success | fail | hang | slow
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const scenario = process.argv[process.argv.indexOf('--scenario') + 1] ?? 'success'

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

// 받은 인자를 그대로 남긴다. 어댑터가 조립한 커맨드가 실제로 CLI까지 닿는지는
// 여기서만 드러난다 — 단위 테스트는 buildCommand의 반환값만 보므로, manager나
// execution이 중간에서 값을 떨어뜨려도 전부 초록이다 (docs/sdlc/agent-setup/).
if (process.env.ONE_DESK_ARGS_CAPTURE) {
  writeFileSync(process.env.ONE_DESK_ARGS_CAPTURE, JSON.stringify(process.argv.slice(2)))
}

// 프롬프트를 stdin으로 받는다. 끝까지 읽어야 부모의 write가 막히지 않는다.
process.stdin.resume()
let receivedPrompt = ''
process.stdin.on('data', (chunk) => { receivedPrompt += chunk.toString() })
process.stdin.on('end', () => {
  if (process.env.ONE_DESK_PROMPT_CAPTURE) writeFileSync(process.env.ONE_DESK_PROMPT_CAPTURE, receivedPrompt)
})

/**
 * stdout이 파이프일 때 process.exit()은 아직 flush되지 않은 버퍼를 버린다.
 * exitCode만 정하고 stdin 핸들을 놓아 자연 종료시킨다.
 */
function finish(code) {
  process.exitCode = code
  process.stdin.pause()
}

// 슬래시 커맨드 목록은 시나리오를 가르지 않고 모든 init에 싣는다 — e2e 드라이버는
// --scenario를 못 넘기고 기본 픽스처를 그대로 spawn하므로, 가르면 e2e에서 피커가 빈다.
// terminal_slash_commands는 slash_commands의 부분집합이다(진짜 CLI와 같다).
emit({
  type: 'system', subtype: 'init', session_id: 'fake-session',
  // 실제로 쓰인 모델. 진짜 CLI가 여기에만 싣는다 (docs/sdlc/run-info/ FR-9).
  model: 'claude-fake-5[1m]',
  // 설정 화면의 CLI 상태 줄이 이것을 보여준다 (docs/sdlc/agent-setup/).
  claude_code_version: '9.9.9-fake',
  slash_commands: ['code-review', 'compact', 'doctor', 'color', 'reload-plugins', 'pinetest'],
  terminal_slash_commands: ['doctor', 'color', 'reload-plugins'],
  plugins: []
})

// 요금제 사용률 줄 (docs/sdlc/plan-usage/). **옵트인이다** — 기본 시나리오에 넣으면 사이드바에 줄이
// 하나 늘어 기존 e2e가 기대지 않은 화면이 된다. 값을 주면 그 사용률(5시간), '1'이면 6%이고 리셋은 늘
// 지금부터 한 시간 뒤다(지난 리셋은 화면이 `—`로 그린다). 모양은 claude 2.1.283 실측 그대로다.
const planUsage = process.env.ONE_DESK_FAKE_PLAN_USAGE
if (planUsage) {
  const now = Math.floor(Date.now() / 1000)
  emit({
    type: 'rate_limit_event', uuid: 'fake-uuid', session_id: 'fake-session',
    rate_limit_info: {
      status: 'allowed', resetsAt: now + 3600, rateLimitType: 'five_hour',
      overageStatus: 'rejected', overageDisabledReason: 'out_of_credits', isUsingOverage: false,
      unifiedWindows: {
        five_hour: { utilization: planUsage === '1' ? 0.06 : Number(planUsage), resetsAt: now + 3600 },
        seven_day: { utilization: 0.02, resetsAt: now + 6 * 86400 }
      }
    }
  })
}

// probe 테스트의 "모델 호출이 나갔다" 신호. init 200ms 뒤에도 살아 있으면 마커를 쓴다 —
// probe가 init 직후 죽이면 이 파일은 생기지 않아야 한다. 환경변수가 없으면 아무것도 안 한다.
const marker = process.env.ONE_DESK_PROBE_MARKER
if (marker) setTimeout(() => writeFileSync(marker, ''), 200)

if (scenario === 'hang') {
  setInterval(() => {}, 1000) // 종료하지 않는다
} else if (scenario === 'slow') {
  setTimeout(() => {
    emit({ type: 'result', subtype: 'success', is_error: false, result: '늦게 끝남', session_id: 'fake-session' })
    finish(0)
  }, 300)
} else if (scenario === 'fail') {
  emit({ type: 'result', subtype: 'error', is_error: true, result: '실패함', session_id: 'fake-session' })
  finish(1)
} else if (process.env.ONE_DESK_FAKE_SCRIPT === 'timeline') {
  runTimeline()
} else if (process.env.ONE_DESK_FAKE_SCRIPT === 'events') {
  runEvents()
} else {
  // e2e가 running 상태를 관찰할 수 있도록 결과를 늦출 수 있다. 기본은 0(즉시).
  // 값이 이상하면 Number()가 NaN을 내고 setTimeout(fn, NaN)은 즉시 실행된다 —
  // 오타 하나가 "지연 없음"으로 조용히 둔갑해 running 탭 단언이 간헐적으로 깨진다.
  const parsedDelay = Number(process.env.ONE_DESK_FAKE_DELAY_MS ?? 0)
  const delayMs = Number.isFinite(parsedDelay) ? parsedDelay : 0
  emit({ type: 'assistant', message: { content: [{ type: 'text', text: '작업 중' }] } })
  setTimeout(() => {
    emit({
      type: 'result', subtype: 'success', is_error: false, result: '끝남',
      session_id: 'fake-session',
      // 토큰·비용·컨텍스트. 모양은 claude 2.1.278 실측 그대로다.
      usage: {
        input_tokens: 2, output_tokens: 4,
        cache_read_input_tokens: 15428, cache_creation_input_tokens: 37917,
        output_tokens_details: { thinking_tokens: 0 },
        iterations: [
          { input_tokens: 2, cache_read_input_tokens: 15428, cache_creation_input_tokens: 37917 }
        ]
      },
      total_cost_usd: 0.386994,
      modelUsage: { 'claude-fake-5[1m]': { contextWindow: 1000000, costUSD: 0.386994 } }
    })
    finish(0)
  }, delayMs)
}

/**
 * 대화록의 타임라인을 흉내 내는 시나리오 (docs/sdlc/conversation-timeline/ plan 다듬은 것 7).
 *
 * e2e 드라이버는 --scenario를 못 넘기므로(위 주석) 환경변수 `ONE_DESK_FAKE_SCRIPT=timeline`으로
 * 켠다. 기본 시나리오("작업 중" → "끝남")는 **건드리지 않는다** — 기존 e2e 전부가 그것에 기댄다.
 *
 * 줄 사이마다 `ONE_DESK_FAKE_STEP_MS`(기본 300ms)를 쉰다 — 도구 호출과 그 결과 사이가 곧
 * "지금 도는 도구"가 상태 줄에 보이는 창이다. 모양은 claude stream-json 그대로다: 도구 호출은
 * assistant의 `tool_use` 블록, 결과는 user의 `tool_result` 블록이고 성공이면 `is_error`가 없다.
 *
 * 마지막 답에는 **적대적인 마크다운**을 섞는다(spec §7 e2e) — 원시 HTML·원격 이미지·
 * `javascript:` 링크가 아무것도 실행·로드·탐색하지 않는지 빌드된 앱에서 본다. 이미지 주소의
 * 포트 9(discard)는 곧바로 연결이 거부된다 — 막는 데 실패해도 바깥으로 나가지 않는다.
 */
function runTimeline() {
  const parsedStep = Number(process.env.ONE_DESK_FAKE_STEP_MS ?? 300)
  const stepMs = Number.isFinite(parsedStep) ? parsedStep : 300
  // 작업 디렉토리 기준으로 만든다 — 화면의 상대 경로가 두 OS에서 같게 `src/auth.ts`(Windows는
  // `src\auth.ts`)로 떨어진다.
  const file = join(process.cwd(), 'src', 'auth.ts')

  const assistant = (block) => ({ type: 'assistant', message: { content: [block] } })
  const toolUse = (id, name, input) => assistant({ type: 'tool_use', id, name, input })
  const toolResult = (id, content, isError = false) => ({
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }]
    }
  })

  // 200자를 넘는다 — 어댑터의 요약이 잘려 "출력 앞부분만 기록됩니다"가 붙어야 한다.
  const testOutput = Array.from({ length: 12 }, (_, i) => ` ✓ src/auth${i}.test.ts (3 tests)`).join('\n')

  const answer = [
    '원인은 토큰 만료 검사가 `<`가 아니라 `<=`여야 하는 것이었습니다.',
    '',
    '```ts',
    'if (now >= expiresAt) return refresh()',
    '```',
    '',
    '- 만료 경계를 고쳤습니다',
    '- 린트 오류는 남아 있습니다',
    '',
    '| 파일 | 변경 |',
    '| --- | --- |',
    '| src/auth.ts | +1 −1 |',
    '',
    '자세한 것은 [문서](https://example.com)를 보세요. [x](javascript:alert(1))',
    '',
    '![p](http://127.0.0.1:9/p.png)',
    '',
    '<img src="http://127.0.0.1:9/q.png">',
    '',
    '<script>window.__pwned=1</script>'
  ].join('\n')

  const steps = [
    assistant({ type: 'text', text: '먼저 인증 모듈을 봅니다.' }),
    toolUse('toolu_read', 'Read', { file_path: file }),
    toolResult('toolu_read', 'export function isExpired(now, expiresAt) { return now > expiresAt }'),
    toolUse('toolu_grep', 'Grep', { pattern: 'expiresAt', output_mode: 'files_with_matches' }),
    toolResult('toolu_grep', 'Found 3 files\nsrc/auth.ts\nsrc/session.ts\nsrc/token.ts'),
    toolUse('toolu_test', 'Bash', { command: 'pnpm test', description: '테스트 실행' }),
    toolResult('toolu_test', testOutput),
    toolUse('toolu_lint', 'Bash', { command: 'pnpm lint' }),
    toolResult('toolu_lint', 'src/auth.ts:1:1  error  세미콜론이 없습니다', true),
    toolUse('toolu_edit', 'Edit', { file_path: file, old_string: 'a < b', new_string: 'a <= b' }),
    toolResult('toolu_edit', 'The file has been updated.'),
    // 이름은 화면에 보일 글자일 뿐이다 — 이 픽스처는 MCP 서버에 붙지 않는다.
    toolUse('toolu_mcp', 'mcp__onedesk__list_issues', {}),
    toolResult('toolu_mcp', '[]'),
    assistant({ type: 'text', text: answer }),
    // claude는 마지막 assistant 텍스트를 result에 다시 담는다 — 화면이 두 번 그리면 안 된다.
    { type: 'result', subtype: 'success', is_error: false, result: answer, session_id: 'fake-session' }
  ]

  let index = 0
  const next = () => {
    emit(steps[index++])
    if (index < steps.length) setTimeout(next, stepMs)
    else finish(0)
  }
  next()
}

/**
 * 어댑터가 새로 싣는 것을 흉내 내는 시나리오 (docs/sdlc/conversation-events/ spec §8 e2e, plan 6단계).
 *
 * `ONE_DESK_FAKE_SCRIPT=events`로 켠다(`timeline`과 같은 방식). 기본 시나리오와 `timeline`은
 * **건드리지 않는다**. 줄 사이마다 `ONE_DESK_FAKE_STEP_MS`(기본 300ms)를 쉰다.
 *
 * 모양은 claude 2.1.280 SDK 스키마를 옮긴 합성이다(spec §7 우려 3 — 모델을 부르지 않아 스트림을 새로
 * 뜨지 못했다). 순서는 spec §8: 생각(서명 4KB) · 셸(7만 자 출력, 끝에 PASS) · Grep(파일 3개) ·
 * Edit(41줄의 hunk) · Write 덮어쓰기(원본 포함) · API 재시도 · Agent와 그 자식 Read(`parent_tool_use_id`) ·
 * 권한 거부된 셸(system 줄 + result의 `permission_denials` — 두 번 알린다) · 대화 압축 · JSON이 아닌 줄.
 * 줄마다 `uuid`가 있다(E7). 셸 출력은 파일에 박지 않고 여기서 만든다.
 *
 * **출력은 결정적이다** — 시각도 난수도 싣지 않는다(경로만 작업 디렉토리를 따른다). e2e가 같은
 * 디렉토리에서 이 스크립트를 한 번 더 돌려, 앱이 남긴 `raw.jsonl`이 그 출력과 줄마다 같은지 본다.
 */
function runEvents() {
  const parsedStep = Number(process.env.ONE_DESK_FAKE_STEP_MS ?? 300)
  const stepMs = Number.isFinite(parsedStep) ? parsedStep : 300
  const cwd = process.cwd()
  const auth = join(cwd, 'src', 'auth.ts')
  const readme = join(cwd, 'README.md')
  const login = join(cwd, 'src', 'login.ts')

  let serial = 0
  const origin = (parent) => ({ parent_tool_use_id: parent, uuid: `fake-uuid-${++serial}`, session_id: 'fake-session' })
  const assistant = (block, parent = null) => ({
    type: 'assistant', message: { role: 'assistant', content: [block] }, ...origin(parent)
  })
  const toolUse = (id, name, input, parent = null) => assistant({ type: 'tool_use', id, name, input }, parent)
  const toolResult = (id, content, toolUseResult, { isError = false, parent = null } = {}) => ({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }]
    },
    ...origin(parent),
    // 도구의 전체 Output 객체 — 실패하면 문자열이다(spec §2-1)
    tool_use_result: toolUseResult
  })
  const system = (subtype, fields) => ({ type: 'system', subtype, ...fields, uuid: `fake-uuid-${++serial}`, session_id: 'fake-session' })

  // 7만 자를 넘는 셸 출력 — 어댑터가 끝 65,536자만 남긴다. 남긴 끝에 PASS가 있어야 한다.
  let testOutput = ''
  for (let i = 0; testOutput.length < 70_000; i++) testOutput += ` ✓ src/case${i}.test.ts (3 tests)\n`
  testOutput += 'PASS'

  const oldAuth = Array.from({ length: 50 }, (_, i) => `// ${i + 1}`)
  oldAuth.splice(40, 3, 'export function isExpired(token) {', '  return now > token.expiresAt', '}')
  const oldReadme = '# 인증 모듈\n\n만료 경계는 `>`다.\n'
  const newReadme = '# 인증 모듈\n\n만료 경계는 `>=`다.\n'
  const report = [{ type: 'text', text: 'login은 세션 쿠키를 쓴다.' }]

  const steps = [
    assistant({
      type: 'thinking',
      thinking: '테스트가 왜 깨지는지 먼저 본다.\n만료 경계가 **의심스럽다**.',
      // 서명은 정규화 로그에 싣지 않는다 — raw.jsonl에만 남는다(E3)
      signature: `EqQBsignature${'A'.repeat(4096)}`
    }),
    assistant({ type: 'text', text: '테스트부터 돌립니다.' }),
    toolUse('toolu_ev_bash', 'Bash', { command: 'pnpm test', description: '테스트 실행' }),
    toolResult('toolu_ev_bash', testOutput, {
      stdout: testOutput, stderr: '', interrupted: false, isImage: false, noOutputExpected: false
    }),
    toolUse('toolu_ev_grep', 'Grep', { pattern: 'expiresAt', output_mode: 'files_with_matches' }),
    toolResult('toolu_ev_grep', 'Found 3 files\nsrc/auth.ts\nsrc/session.ts\nsrc/token.ts', {
      mode: 'files_with_matches', numFiles: 3, filenames: ['src/auth.ts', 'src/session.ts', 'src/token.ts']
    }),
    toolUse('toolu_ev_edit', 'Edit', {
      file_path: auth, old_string: 'return now > token.expiresAt', new_string: 'return now >= token.expiresAt'
    }),
    toolResult('toolu_ev_edit', `The file ${auth} has been updated successfully.`, {
      filePath: auth, oldString: 'return now > token.expiresAt', newString: 'return now >= token.expiresAt',
      originalFile: `${oldAuth.join('\n')}\n`,
      structuredPatch: [{
        oldStart: 41, oldLines: 3, newStart: 41, newLines: 3,
        lines: [' export function isExpired(token) {', '-  return now > token.expiresAt', '+  return now >= token.expiresAt', ' }']
      }],
      userModified: false, replaceAll: false
    }),
    toolUse('toolu_ev_write', 'Write', { file_path: readme, content: newReadme }),
    toolResult('toolu_ev_write', `The file ${readme} has been updated.`, {
      type: 'update', filePath: readme, content: newReadme,
      structuredPatch: [{
        oldStart: 1, oldLines: 3, newStart: 1, newLines: 3,
        lines: [' # 인증 모듈', ' ', '-만료 경계는 `>`다.', '+만료 경계는 `>=`다.']
      }],
      originalFile: oldReadme
    }),
    system('api_retry', {
      attempt: 2, max_retries: 10, retry_delay_ms: 4200, error_status: 529, error: 'overloaded_error'
    }),
    toolUse('toolu_ev_agent', 'Agent', {
      description: '로그인 흐름 조사', prompt: 'login이 세션을 어떻게 쓰는지 보고해라', subagent_type: 'Explore'
    }),
    toolUse('toolu_ev_child', 'Read', { file_path: login }, 'toolu_ev_agent'),
    toolResult('toolu_ev_child', '     1\texport function login() {}', {
      type: 'text', file: { filePath: login, content: 'export function login() {}', numLines: 1, startLine: 1, totalLines: 1 }
    }, { parent: 'toolu_ev_agent' }),
    toolResult('toolu_ev_agent', report, {
      content: report, resolvedModel: 'claude-fake-sonnet', totalToolUseCount: 1, totalDurationMs: 3400,
      totalTokens: 1200, usage: { input_tokens: 1000, output_tokens: 200 }
    }),
    toolUse('toolu_ev_denied', 'Bash', { command: 'rm -rf build' }),
    system('permission_denied', {
      tool_name: 'Bash', tool_use_id: 'toolu_ev_denied', decision_reason_type: 'rule',
      message: 'Permission to use Bash has been denied.'
    }),
    toolResult('toolu_ev_denied', 'Permission to use Bash has been denied.',
      'Error: Permission to use Bash has been denied.', { isError: true }),
    system('compact_boundary', {
      compact_metadata: { trigger: 'auto', pre_tokens: 153214, post_tokens: 12400, duration_ms: 5100 }
    }),
    assistant({ type: 'text', text: '만료 경계를 고쳤습니다.' }),
    {
      type: 'result', subtype: 'success', is_error: false, result: '만료 경계를 고쳤습니다.',
      session_id: 'fake-session', uuid: `fake-uuid-${++serial}`,
      // 권위 있는 기록 — system 줄이 이미 알린 호출을 한 번 더 알린다(화면은 한 번만 그린다)
      permission_denials: [{ tool_name: 'Bash', tool_use_id: 'toolu_ev_denied', tool_input: { command: 'rm -rf build' } }]
    },
    // 해석하지 못하는 줄 — 어댑터는 raw 이벤트로, raw.jsonl에는 그대로 남는다
    'fake-claude: 이 줄은 JSON이 아니다'
  ]

  let index = 0
  const next = () => {
    const step = steps[index++]
    if (typeof step === 'string') process.stdout.write(`${step}\n`)
    else emit(step)
    if (index < steps.length) setTimeout(next, stepMs)
    else finish(0)
  }
  next()
}
