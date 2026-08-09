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
  emit({ type: 'assistant', message: { content: [{ type: 'text', text: '작업 중' }] } })
  emit({ type: 'result', subtype: 'success', is_error: false, result: '끝남', session_id: 'fake-session' })
  finish(0)
}
