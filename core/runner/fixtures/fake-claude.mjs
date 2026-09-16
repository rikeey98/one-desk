#!/usr/bin/env node
// 인자로 받은 시나리오대로 stream-json을 흉내낸다.
// --scenario success | fail | hang | slow
import { writeFileSync } from 'node:fs'

const scenario = process.argv[process.argv.indexOf('--scenario') + 1] ?? 'success'

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
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
  slash_commands: ['code-review', 'compact', 'doctor', 'color', 'reload-plugins', 'pinetest'],
  terminal_slash_commands: ['doctor', 'color', 'reload-plugins'],
  plugins: []
})

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
} else {
  // e2e가 running 상태를 관찰할 수 있도록 결과를 늦출 수 있다. 기본은 0(즉시).
  // 값이 이상하면 Number()가 NaN을 내고 setTimeout(fn, NaN)은 즉시 실행된다 —
  // 오타 하나가 "지연 없음"으로 조용히 둔갑해 running 탭 단언이 간헐적으로 깨진다.
  const parsedDelay = Number(process.env.ONE_DESK_FAKE_DELAY_MS ?? 0)
  const delayMs = Number.isFinite(parsedDelay) ? parsedDelay : 0
  emit({ type: 'assistant', message: { content: [{ type: 'text', text: '작업 중' }] } })
  setTimeout(() => {
    emit({ type: 'result', subtype: 'success', is_error: false, result: '끝남', session_id: 'fake-session' })
    finish(0)
  }, delayMs)
}
