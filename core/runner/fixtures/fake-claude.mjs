#!/usr/bin/env node
// 인자로 받은 시나리오대로 stream-json을 흉내낸다.
// --scenario success | fail | hang | slow
const scenario = process.argv[process.argv.indexOf('--scenario') + 1] ?? 'success'

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

// 프롬프트를 stdin으로 받는다. 끝까지 읽어야 부모의 write가 막히지 않는다.
process.stdin.resume()
process.stdin.on('data', () => {})

/**
 * stdout이 파이프일 때 process.exit()은 아직 flush되지 않은 버퍼를 버린다.
 * exitCode만 정하고 stdin 핸들을 놓아 자연 종료시킨다.
 */
function finish(code) {
  process.exitCode = code
  process.stdin.pause()
}

emit({ type: 'system', subtype: 'init', session_id: 'fake-session' })

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
