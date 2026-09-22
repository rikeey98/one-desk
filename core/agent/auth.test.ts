import { describe, it, expect, vi } from 'vitest'
import { checkAuth, stripAnsi } from './auth'
import type { CliOutput, RunCli } from './types'

function ok(stdout: string, code = 0): CliOutput {
  return { code, stdout, stderr: '', failure: null }
}

/** 한 번만 답하는 스텁. 무슨 인자로 불렸는지도 함께 본다. */
function stub(output: CliOutput) {
  const calls: { executable: string; args: string[] }[] = []
  const run: RunCli = async (input) => {
    calls.push({ executable: input.executable, args: input.args })
    return output
  }
  return { run, calls }
}

// intent에 적어 둔 실측 출력 그대로다 — ANSI 이스케이프와 박스 그림이 붙어 있다.
// 이 문자열이 여기 있는 것이 회귀 방어의 전부다(기계용 형식이 없다).
const OPENCODE_EMPTY =
  '\u001b[0m\r\n' +
  '\u001b[90m┌\u001b[39m  Credentials \u001b[90m~\\.local\\share\\opencode\\auth.json\r\n' +
  '\u001b[90m│\u001b[39m\r\n' +
  '\u001b[90m└\u001b[39m  0 credentials'

const OPENCODE_TWO =
  '\u001b[0m\r\n' +
  '\u001b[90m┌\u001b[39m  Credentials \u001b[90m~/.local/share/opencode/auth.json\r\n' +
  '\u001b[90m│\u001b[39m  anthropic\r\n' +
  '\u001b[90m│\u001b[39m  openrouter\r\n' +
  '\u001b[90m└\u001b[39m  2 credentials'

describe('stripAnsi', () => {
  it('색과 커서 이스케이프를 걷어낸다', () => {
    expect(stripAnsi('\u001b[90m0 credentials\u001b[39m')).toBe('0 credentials')
  })

  it('이스케이프가 없는 문자열은 그대로 둔다', () => {
    expect(stripAnsi('0 credentials')).toBe('0 credentials')
  })
})

describe('checkAuth — claude', () => {
  it('loggedIn이 참이면 ok이고 방법·요금제를 싣는다', async () => {
    const { run, calls } = stub(ok(JSON.stringify({
      loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max'
    })))

    const auth = await checkAuth('claude-code', '/bin/claude', run)

    expect(auth).toEqual({ state: 'ok', method: 'claude.ai', plan: 'max' })
    // JSON이 기본 출력이지만 명시한다 — 기본값이 바뀌면 조용히 파싱이 깨진다.
    expect(calls[0]!.args).toEqual(['auth', 'status', '--json'])
  })

  it('loggedIn이 거짓이면 none이고 칠 명령을 알려준다', async () => {
    const { run } = stub(ok(JSON.stringify({ loggedIn: false })))

    const auth = await checkAuth('claude-code', '/bin/claude', run)

    expect(auth.state).toBe('none')
    // 화면이 "무엇을 해야 하나"에 답해야 한다. 앱이 로그인을 대신할 수는 없다
    // (`claude auth login`은 대화형이라 헤드리스에서 돌지 않는다).
    if (auth.state === 'none') expect(auth.hint).toContain('claude auth login')
  })

  it('계정 식별 정보는 돌려주지 않는다', async () => {
    // auth status는 email·orgId·orgName도 준다. DB·로그·화면 어디에도 넣지
    // 않기로 했으므로(spec NFR-5) 여기서부터 나르지 않는다.
    const { run } = stub(ok(JSON.stringify({
      loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max',
      email: 'someone@example.com', orgId: 'org-1', orgName: '어떤 조직'
    })))

    const auth = await checkAuth('claude-code', '/bin/claude', run)

    expect(JSON.stringify(auth)).not.toContain('example.com')
    expect(JSON.stringify(auth)).not.toContain('org-1')
  })

  it('서브커맨드가 없으면 unknown이다 — none이 아니다', async () => {
    // 옛 CLI에는 auth status가 없다. 그것을 "로그인 안 됨"으로 단정하면
    // 멀쩡히 돌아가는 설치본에 빨간 줄이 뜬다.
    const { run } = stub({
      code: 1, stdout: '', stderr: "error: unknown command 'auth'", failure: null
    })

    const auth = await checkAuth('claude-code', '/bin/claude', run)

    expect(auth.state).toBe('unknown')
  })

  it('JSON이 아니면 unknown이다', async () => {
    const { run } = stub(ok('Logged in as someone'))
    expect((await checkAuth('claude-code', '/bin/claude', run)).state).toBe('unknown')
  })

  it('loggedIn 필드가 없으면 unknown이다', async () => {
    const { run } = stub(ok(JSON.stringify({ authMethod: 'claude.ai' })))
    expect((await checkAuth('claude-code', '/bin/claude', run)).state).toBe('unknown')
  })

  it('띄우지 못하면 그 사유를 담은 unknown이다', async () => {
    const { run } = stub({ code: null, stdout: '', stderr: '', failure: 'ENOENT' })
    const auth = await checkAuth('claude-code', '/bin/claude', run)
    expect(auth.state).toBe('unknown')
    if (auth.state === 'unknown') expect(auth.reason).toContain('ENOENT')
  })

  it('던지지 않는다 — 조회가 터져도 unknown으로 돌아온다', async () => {
    const run: RunCli = () => Promise.reject(new Error('갑자기 터짐'))
    const auth = await checkAuth('claude-code', '/bin/claude', run)
    expect(auth.state).toBe('unknown')
  })
})

describe('checkAuth — opencode', () => {
  it('ANSI가 붙은 실측 출력에서 0 credentials를 읽어 none으로 판정한다', async () => {
    const { run, calls } = stub(ok(OPENCODE_EMPTY))

    const auth = await checkAuth('opencode', '/bin/opencode', run)

    expect(auth.state).toBe('none')
    if (auth.state === 'none') expect(auth.hint).toContain('opencode auth login')
    expect(calls[0]!.args).toEqual(['auth', 'list'])
  })

  it('자격 증명이 있으면 ok다', async () => {
    const { run } = stub(ok(OPENCODE_TWO))
    expect((await checkAuth('opencode', '/bin/opencode', run)).state).toBe('ok')
  })

  it('개수를 읽어내지 못하면 unknown이다 — 0개가 아니다', async () => {
    // 출력 형식이 버전업으로 바뀌면 여기로 떨어진다. 그때 "자격 증명 0개"라고
    // 적으면 멀쩡한 설치본에 거짓말을 하게 된다.
    const { run } = stub(ok('Credentials: anthropic, openrouter'))
    const auth = await checkAuth('opencode', '/bin/opencode', run)
    expect(auth.state).toBe('unknown')
  })

  it('자격 증명 파일을 직접 읽지 않는다', async () => {
    // auth.json은 자격 증명 파일이고 형식이 문서화돼 있지 않다. CLI가 공개한
    // 명령의 출력만 읽는다(spec NFR-5).
    const { run, calls } = stub(ok(OPENCODE_EMPTY))
    await checkAuth('opencode', '/bin/opencode', run)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.args.join(' ')).not.toContain('auth.json')
  })

  it('종료 코드가 0이 아니면 unknown이다', async () => {
    const { run } = stub({ code: 2, stdout: '', stderr: 'boom', failure: null })
    expect((await checkAuth('opencode', '/bin/opencode', run)).state).toBe('unknown')
  })
})

describe('checkAuth — 공통', () => {
  it('프로세스를 한 번만 띄운다', async () => {
    const spy = vi.fn(async () => ok(JSON.stringify({ loggedIn: true })))
    await checkAuth('claude-code', '/bin/claude', spy)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
