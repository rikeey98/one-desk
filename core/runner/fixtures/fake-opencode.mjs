#!/usr/bin/env node
// 가짜 OpenCode. 실제 CLI의 NDJSON 형태만 흉내낸다 — 모델을 부르지 않는다.
// 서버 이름 같은 값을 리터럴로 박지 않는다: 과거에 fake-claude-mcp.mjs가
// `.mcpServers.onedesk`를 하드코딩해 상수 하나 바뀌자 e2e가 통째로 깨졌고,
// 단위 테스트는 전부 초록이었다.
import { join } from 'node:path'

const sessionId = 'ses_fake000000000000000000000'
const delay = Number(process.env.ONE_DESK_FAKE_DELAY_MS ?? 0)

// ── 2.x 흉내 (docs/sdlc/opencode-v2/ spec FR-26) ───────────────────────────────
// `ONE_DESK_FAKE_OPENCODE_VERSION`이 2로 시작할 때만 켜진다. 없으면 아래의 1.x 갈래 그대로다 — 기존 e2e가 거기 기댄다.
//
// **진짜와 뜻이 다른 호출은 조용히 받아 주지 않고 exit 2로 실패한다**(가짜 wsl.exe가 `--`를 거부하는 것과 같은 이유):
// `--standalone` 없는 호출은 진짜 2.x에서 백그라운드 서비스를 띄우고, `--agent build` 없는 run은 프로젝트의 default_agent에
// 휘둘린다. 받아 주면 그 인자를 빼는 변이가 e2e에서 초록이다. 1.x의 옵션은 진짜처럼 "모르는 옵션"으로 거부한다.
const fakeVersion = process.env.ONE_DESK_FAKE_OPENCODE_VERSION ?? ''
if (fakeVersion.startsWith('2.')) runV2(process.argv.slice(2))

function runV2(args) {
  const has = (flag) => args.includes(flag)
  const fail = (code, message) => {
    process.stderr.write(`${message}\n`)
    process.exit(code)
  }
  const needStandalone = (what) => {
    if (!has('--standalone')) fail(2, `가짜 opencode 2.x: ${what}에 --standalone이 없다 — 진짜는 백그라운드 서비스를 띄운다`)
  }

  if (has('--version')) {
    process.stdout.write(`opencode v${fakeVersion}\n`)
    process.exit(0)
  }

  if (args[0] === 'debug' && args[1] === 'agents') {
    // 2.0.18은 이 옵션을 모른다(실측 문구) — 실행 직전 확인을 할 수 없는 바이너리다
    if (process.env.ONE_DESK_FAKE_OPENCODE_UNVERIFIABLE === '1') {
      fail(1, 'ERROR\n  Unrecognized flag: --standalone in command opencode debug agents')
    }
    needStandalone('debug agents')
    // 진짜가 규칙을 붙이는 순서 그대로: agent 기본값 → 환경변수 최상위 → 환경변수 agents.build → 꼬리
    const sent = process.env.OPENCODE_CONFIG_CONTENT ? JSON.parse(process.env.OPENCODE_CONFIG_CONTENT) : {}
    const rule = (action, resource, effect) => ({ action, resource, effect })
    const permissions = [
      rule('*', '*', 'allow'), rule('read', '*.env', 'ask'), rule('question', '*', 'allow'),
      ...(sent.permissions ?? []),
      ...(sent.agents?.build?.permissions ?? []),
      rule('browser', '*', 'deny'), rule('skill', 'browser', 'deny')
    ]
    process.stdout.write(JSON.stringify([{ id: 'build', name: 'Build', mode: 'primary', permissions }]))
    process.exit(0)
  }

  if (args[0] === 'api') {
    needStandalone('api')
    const id = (args.find((a) => a.startsWith('sessionID=')) ?? '').slice('sessionID='.length)
    if (args[2] === 'session.get' && id === sessionId) {
      process.stdout.write(JSON.stringify({ data: { id } }))
      process.exit(0)
    }
    process.stdout.write(JSON.stringify({ _tag: 'SessionNotFoundError', sessionID: id, message: `Session not found: ${id}` }))
    fail(1, 'HTTP 404 Not Found')
  }

  if (args[0] === 'auth' && args[1] === 'list') {
    needStandalone('auth list')
    process.stdout.write('No authenticated integrations\n')
    process.exit(0)
  }

  if (args[0] === 'models') {
    needStandalone('models')
    process.stdout.write('opencode/big-pickle\nopencode/beam-free\n')
    process.exit(0)
  }

  if (args[0] !== 'run') fail(2, `가짜 opencode 2.x: 흉내 내지 않는 명령이다 — ${args.join(' ')}`)
  needStandalone('run')
  for (const flag of ['--variant', '--dangerously-skip-permissions', '--port']) {
    if (has(flag)) fail(1, `ERROR\n  Unrecognized flag: ${flag} in command opencode run`)
  }
  if (args[args.indexOf('--agent') + 1] !== 'build' || !has('--agent')) {
    fail(2, '가짜 opencode 2.x: run에 --agent build가 없다 — 진짜는 프로젝트의 default_agent를 따른다')
  }
  if (!process.env.OPENCODE_CONFIG_CONTENT) fail(2, '가짜 opencode 2.x: OPENCODE_CONFIG_CONTENT가 없다 — 권한 없이 도는 run이다')

  let input = ''
  process.stdin.on('data', (chunk) => { input += chunk })
  process.stdin.on('end', () => emitV2(input, has('--thinking')))
  // 1.x 갈래로 내려가지 않는다 — stdin이 닫힐 때까지 여기서 산다
  runV2.active = true
}

/**
 * 2.x의 줄 모양(2.0.18·2.3.2 실측 — `fixtures/opencode-v2/`와 같다): 호출 id가 `part.id`, 경로가 `input.path`, 세부가
 * `state.metadata.metadata`. 셸은 0이 아닌 종료 코드도 `completed`로 온다.
 */
function emitV2(input, thinking) {
  const stepMs = Number(process.env.ONE_DESK_FAKE_STEP_MS ?? 100)
  const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`)
  let partNo = 0
  const line = (type, part) => ({
    type, timestamp: Date.now(), sessionID: sessionId,
    part: { sessionID: sessionId, messageID: 'msg_fake_v2', ...part }
  })
  const tool = (name, id, stateInput, output, meta) => line('tool_use', {
    partID: `prt_fake_${++partNo}`, type: 'tool', id, tool: name,
    state: {
      status: 'completed', input: stateInput, output, title: name,
      metadata: { metadata: meta, content: [{ type: 'text', text: output }], rawInput: JSON.stringify(stateInput) },
      time: { start: Date.now() - 20, end: Date.now() }
    }
  })
  const patch = [
    'Index: src/auth.ts', '===================================================================',
    '--- src/auth.ts', '+++ src/auth.ts', '@@ -41,3 +41,3 @@',
    ' export function isExpired(token) {', '-  return now > token.expiresAt', '+  return now >= token.expiresAt', ' }', ''
  ].join('\n')

  const steps = [
    () => line('step_start', { id: `prt_fake_${++partNo}`, type: 'step-start' }),
    () => thinking
      ? line('reasoning', {
        id: `prt_fake_${++partNo}`, type: 'reasoning', text: '2.x의 생각 줄이다.',
        metadata: { openai: { encrypted: 'CIPHERTEXT' } }, time: { start: Date.now() - 1000, end: Date.now() }
      })
      : null,
    () => tool('shell', 'call-v2-shell', { command: 'npm test' }, ' FAIL  src/auth.test.ts\n', { status: 'completed', truncated: false, exit: 3 }),
    () => tool('read', 'call-v2-read', { path: 'src/auth.ts' }, 'Read file src/auth.ts, lines 1-3', { truncated: false }),
    () => tool('edit', 'call-v2-edit', { path: 'src/auth.ts', oldString: 'now > token', newString: 'now >= token' }, 'Edited src/auth.ts (1 replacement)', {
      files: [{ file: 'src/auth.ts', patch, status: 'modified', additions: 1, deletions: 1 }], truncated: false
    }),
    () => line('text', {
      id: `prt_fake_${++partNo}`, type: 'text',
      text: `가짜 OpenCode 2.x가 처리했습니다: ${input.trim().slice(0, 40)}`, time: { start: Date.now() - 100, end: Date.now() }
    }),
    () => line('step_finish', {
      id: `prt_fake_${++partNo}`, type: 'step-finish', reason: 'stop', cost: 0,
      tokens: { input: 110, output: 4, reasoning: 10, cache: { read: 10496, write: 0 } }
    })
  ]
  const next = (i) => {
    if (i >= steps.length) {
      process.exitCode = 0
      return
    }
    const obj = steps[i]()
    if (obj) out(obj)
    setTimeout(() => next(i + 1), obj ? stepMs : 0)
  }
  next(0)
}

// `opencode debug config` 흉내. verifyRunnable이 실행 직전에 이걸 부른다 —
// 여기서 NDJSON을 뱉으면 JSON.parse가 깨져 모든 run이 거부된다.
if (process.argv.includes('debug') && process.argv.includes('config')) {
  const permission = process.env.OPENCODE_PERMISSION
    ? JSON.parse(process.env.OPENCODE_PERMISSION)
    : {}
  process.stdout.write(JSON.stringify({ permission }))
  process.exit(0)
}

// `opencode --version` 흉내. 버전 게이트(preflight)가 이걸 부른다 — 1.x는 버전 한 줄만 찍는다(실측).
// 없으면 게이트가 아래 시나리오를 통째로 돌려 기다린다(events 스크립트는 수 초가 걸린다).
if (process.argv.includes('--version')) {
  process.stdout.write('1.18.30\n')
  process.exit(0)
}

const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`)
const at = () => Date.now()

// Claude Code와 마찬가지로 stdin을 읽고 닫히기를 기다린다.
let prompt = ''
process.stdin.on('data', (chunk) => { prompt += chunk })
process.stdin.on('end', () => {
  // 2.x 모드의 run은 위(runV2)가 맡았다 — 1.x의 줄을 같이 내지 않는다
  if (runV2.active) return
  if (process.env.ONE_DESK_FAKE_SCRIPT === 'events') {
    runEvents()
    return
  }

  emit({ type: 'step_start', timestamp: at(), sessionID: sessionId, part: { type: 'step-start' } })
  emit({
    type: 'tool_use', timestamp: at(), sessionID: sessionId,
    part: {
      type: 'tool', tool: 'read', callID: 'call-fake-1',
      state: {
        status: 'completed',
        input: { filePath: `${process.cwd()}/notes.txt` },
        output: '가짜 읽기 결과'
      }
    }
  })

  setTimeout(() => {
    emit({
      type: 'text', timestamp: at(), sessionID: sessionId,
      part: { type: 'text', text: `가짜 OpenCode가 처리했습니다: ${prompt.trim().slice(0, 40)}` }
    })
    emit({
      type: 'step_finish', timestamp: at(), sessionID: sessionId,
      // 토큰·비용. 모양은 기록된 실측 픽스처 그대로다 (모델도 창 크기도 없다).
      part: {
        type: 'step-finish', reason: 'stop', cost: 0,
        tokens: { total: 3877, input: 3815, output: 31, reasoning: 0, cache: { write: 0, read: 0 } }
      }
    })
    process.exit(0)
  }, delay)
})

/**
 * 어댑터가 새로 싣는 것을 흉내 내는 시나리오 (docs/sdlc/conversation-events/ plan 2단계·spec §8 e2e).
 *
 * e2e 드라이버는 인자를 못 넘기므로 환경변수 `ONE_DESK_FAKE_SCRIPT=events`로 켠다(fake-claude.mjs의
 * `timeline`과 같은 방식). 기본 시나리오는 **건드리지 않는다**.
 *
 * **reasoning 줄은 `--thinking`이 있을 때만 낸다** — 실제 run 루프(`run.ts`:766)와 같게. 그래야
 * 어댑터의 buildCommand에서 플래그를 빼는 변이를 e2e가 잡는다. 생각한 시간은 정확히 2초다.
 *
 * 줄 사이마다 `ONE_DESK_FAKE_STEP_MS`(기본 300ms)를 쉰다. 모양은 opencode 1.18.30 `run --format json`의
 * 끝난 part 그대로다 — 도구는 completed·error일 때 한 줄로 입력과 결과가 함께 온다.
 */
function runEvents() {
  const parsedStep = Number(process.env.ONE_DESK_FAKE_STEP_MS ?? 300)
  const stepMs = Number.isFinite(parsedStep) ? parsedStep : 300
  const thinking = process.argv.includes('--thinking')
  const file = join(process.cwd(), 'src', 'auth.ts')

  let partNo = 0
  const line = (type, messageID, part) => ({
    type, timestamp: at(), sessionID: sessionId,
    part: { id: `prt_fake_${++partNo}`, messageID, sessionID: sessionId, ...part }
  })
  const tool = (messageID, name, callID, state) => line('tool_use', messageID, { type: 'tool', tool: name, callID, state })
  const took = (ms) => {
    const end = at()
    return { start: end - ms, end }
  }

  const patch = [
    `Index: ${file}`,
    '===================================================================',
    `--- ${file}`,
    `+++ ${file}`,
    '@@ -41,3 +41,3 @@',
    ' export function isExpired(token) {',
    '-  return now > token.expiresAt',
    '+  return now >= token.expiresAt',
    ' }',
    ''
  ].join('\n')

  const steps = [
    () => line('step_start', 'msg_fake_1', { type: 'step-start' }),
    () => thinking
      ? line('reasoning', 'msg_fake_1', {
        type: 'reasoning',
        text: '만료 경계가 의심스럽다. **테스트부터** 돌려 본다.',
        time: took(2000),
        // provider 서명 — 어댑터가 버려야 한다
        metadata: { anthropic: { signature: `SIGNATURE-${'Q'.repeat(512)}` } }
      })
      : null,
    () => tool('msg_fake_1', 'bash', 'call-fake-bash', {
      status: 'completed',
      input: { command: 'pnpm test', description: '테스트 실행' },
      output: ' FAIL  src/auth.test.ts\n  expected true, got false\nTests  1 failed | 11 passed (12)\n',
      metadata: { output: ' FAIL  src/auth.test.ts', exit: 1, description: '테스트 실행', truncated: false },
      title: 'pnpm test',
      time: took(2500)
    }),
    () => tool('msg_fake_2', 'grep', 'call-fake-grep', {
      status: 'completed',
      input: { pattern: 'expiresAt', path: process.cwd() },
      output: `Found 12 matches\n${file}:\n  Line 41: return now > token.expiresAt`,
      metadata: { matches: 12, truncated: false },
      title: 'expiresAt',
      time: took(40)
    }),
    () => tool('msg_fake_3', 'edit', 'call-fake-edit', {
      status: 'completed',
      input: { filePath: file, oldString: 'return now > token.expiresAt', newString: 'return now >= token.expiresAt' },
      output: 'Edit applied successfully.',
      metadata: { diagnostics: {}, diff: patch, filediff: { file, patch, additions: 1, deletions: 1 } },
      title: 'src/auth.ts',
      time: took(30)
    }),
    () => tool('msg_fake_4', 'task', 'call-fake-task', {
      status: 'completed',
      input: { description: '로그인 흐름 조사', prompt: 'login이 세션을 어떻게 쓰는지 보고해라', subagent_type: 'general' },
      output: 'login은 세션 쿠키를 쓴다.',
      metadata: {
        parentSessionId: sessionId,
        sessionId: 'ses_fakechild00000000000000',
        model: { modelID: 'claude-fake-5', providerID: 'anthropic' }
      },
      title: '로그인 흐름 조사',
      time: took(34000)
    }),
    () => tool('msg_fake_5', 'bash', 'call-fake-denied', {
      status: 'error',
      input: { command: 'rm -rf build', description: '빌드 지우기' },
      error: 'The user rejected permission to use this specific tool call.',
      time: took(1)
    }),
    () => line('text', 'msg_fake_6', {
      type: 'text',
      text: `가짜 OpenCode가 처리했습니다: ${prompt.trim().slice(0, 40)}`,
      time: took(300)
    }),
    () => line('step_finish', 'msg_fake_6', {
      type: 'step-finish', reason: 'stop', cost: 0,
      tokens: { total: 3877, input: 3815, output: 31, reasoning: 31, cache: { write: 0, read: 0 } }
    })
  ]

  const next = (i) => {
    if (i >= steps.length) {
      // process.exit()은 파이프에 남은 버퍼를 버릴 수 있다 — 종료 코드만 정하고 자연 종료시킨다
      process.exitCode = 0
      return
    }
    const obj = steps[i]()
    if (obj) emit(obj)
    setTimeout(() => next(i + 1), obj ? stepMs : 0)
  }
  next(0)
}
