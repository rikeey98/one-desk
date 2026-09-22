import type { AgentAuth, AgentKind } from '@shared/models'
import type { CliOutput, RunCli } from './types'

/** 인증 조회는 값싸다 — 모델을 부르지 않고 파일만 읽는다(실측 0.24초). */
const TIMEOUT_MS = 8_000

/**
 * ANSI 이스케이프(색·커서)를 걷어낸다.
 *
 * opencode의 `auth list`는 색과 박스 그림이 붙은 사람용 출력이고 `--json` 같은
 * 기계용 형식이 없다(2026-09-22 실측). 새 의존성을 더하지 않기로 했으므로
 * (spec NFR-6) 정규식 하나로 푼다.
 */
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
}

function unknown(reason: string): AgentAuth {
  return { state: 'unknown', reason }
}

/** 프로세스를 못 띄웠거나 비정상 종료했으면 그 사유. 정상이면 null */
function launchProblem(out: CliOutput): string | null {
  if (out.failure) return out.failure
  if (out.code !== 0) {
    const detail = stripAnsi(out.stderr).trim().slice(0, 200)
    return `종료 코드 ${out.code}${detail ? `: ${detail}` : ''}`
  }
  return null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/**
 * `claude auth status --json`을 읽는다.
 *
 * **`--json`을 명시한다.** 지금은 그것이 기본 출력이지만, 기본값이 바뀌면 파싱이
 * 조용히 깨진다.
 *
 * **계정 식별 정보는 버린다.** 이 명령은 `email`·`orgId`·`orgName`도 돌려주는데
 * DB·로그·화면 어디에도 넣지 않기로 했으므로(spec NFR-5) 여기서부터 나르지 않는다.
 */
async function claudeAuth(executable: string, run: RunCli): Promise<AgentAuth> {
  const out = await run({ executable, args: ['auth', 'status', '--json'], timeoutMs: TIMEOUT_MS })

  // 옛 CLI에는 이 서브커맨드가 없다. 그것을 "로그인 안 됨"으로 단정하면 멀쩡히
  // 돌아가는 설치본에 빨간 줄이 뜬다 — 모르는 것은 모른다고 적는다(FR-3).
  const problem = launchProblem(out)
  if (problem) return unknown(`인증 상태를 조회하지 못했습니다 (${problem})`)

  let parsed: unknown
  try {
    parsed = JSON.parse(out.stdout)
  } catch {
    return unknown('인증 상태의 출력을 읽지 못했습니다 (JSON이 아닙니다)')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return unknown('인증 상태의 출력을 읽지 못했습니다')
  }

  const record = parsed as Record<string, unknown>
  const loggedIn = record['loggedIn']
  if (typeof loggedIn !== 'boolean') {
    return unknown('인증 상태의 출력에 loggedIn이 없습니다')
  }

  if (!loggedIn) {
    return { state: 'none', hint: '`claude auth login`으로 로그인하세요.' }
  }
  return {
    state: 'ok',
    method: str(record['authMethod']),
    plan: str(record['subscriptionType'])
  }
}

/**
 * `opencode auth list`의 출력에서 자격 증명 개수를 읽는다.
 *
 * **`auth.json`을 열지 않는다** — 자격 증명 파일이고 형식이 문서화돼 있지 않다
 * (spec NFR-5). CLI가 공개한 명령의 출력만 본다.
 *
 * **읽어내지 못하면 `unknown`이지 `0개`가 아니다.** 이 파싱은 사람용 출력에
 * 묶여 있어 버전이 오르면 깨질 수 있는데, 그때 "자격 증명 0개"라고 적으면
 * 멀쩡한 설치본에 거짓말을 하게 된다.
 */
async function opencodeAuth(executable: string, run: RunCli): Promise<AgentAuth> {
  const out = await run({ executable, args: ['auth', 'list'], timeoutMs: TIMEOUT_MS })

  const problem = launchProblem(out)
  if (problem) return unknown(`자격 증명을 조회하지 못했습니다 (${problem})`)

  const match = /(\d+)\s+credentials?/i.exec(stripAnsi(out.stdout))
  if (!match) return unknown('자격 증명 목록의 출력을 읽지 못했습니다')

  const count = Number(match[1])
  if (count === 0) {
    return {
      state: 'none',
      hint: '`opencode auth login`으로 provider에 로그인하세요.'
    }
  }
  // opencode는 방법·요금제라는 개념이 없다 — 모르는 것은 null로 둔다.
  return { state: 'ok', method: null, plan: null }
}

/**
 * 준비 상태의 **둘째 칸** (docs/sdlc/agent-setup/ FR-1).
 *
 * **던지지 않는다.** 무엇이 터져도 `unknown`으로 돌아온다 — 이 조회의 실패가
 * 설정 화면을 비우거나 실행을 막으면 안 된다(FR-6).
 */
export async function checkAuth(
  kind: AgentKind,
  executable: string,
  run: RunCli
): Promise<AgentAuth> {
  try {
    return kind === 'opencode'
      ? await opencodeAuth(executable, run)
      : await claudeAuth(executable, run)
  } catch (err) {
    return unknown(`인증 상태를 조회하지 못했습니다 (${err instanceof Error ? err.message : String(err)})`)
  }
}
