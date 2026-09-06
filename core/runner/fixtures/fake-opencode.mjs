#!/usr/bin/env node
// 가짜 OpenCode. 실제 CLI의 NDJSON 형태만 흉내낸다 — 모델을 부르지 않는다.
// 서버 이름 같은 값을 리터럴로 박지 않는다: 과거에 fake-claude-mcp.mjs가
// `.mcpServers.onedesk`를 하드코딩해 상수 하나 바뀌자 e2e가 통째로 깨졌고,
// 단위 테스트는 전부 초록이었다.

const sessionId = 'ses_fake000000000000000000000'
const delay = Number(process.env.ONE_DESK_FAKE_DELAY_MS ?? 0)

// `opencode debug config` 흉내. verifyRunnable이 실행 직전에 이걸 부른다 —
// 여기서 NDJSON을 뱉으면 JSON.parse가 깨져 모든 run이 거부된다.
if (process.argv.includes('debug') && process.argv.includes('config')) {
  const permission = process.env.OPENCODE_PERMISSION
    ? JSON.parse(process.env.OPENCODE_PERMISSION)
    : {}
  process.stdout.write(JSON.stringify({ permission }))
  process.exit(0)
}

// Claude Code와 마찬가지로 stdin을 읽고 닫히기를 기다린다.
let prompt = ''
process.stdin.on('data', (chunk) => { prompt += chunk })
process.stdin.on('end', () => {
  const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`)
  const at = () => Date.now()

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
      part: { type: 'step-finish', reason: 'stop' }
    })
    process.exit(0)
  }, delay)
})
