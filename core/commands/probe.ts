import { spawn, type ChildProcess } from 'node:child_process'
import { createLineSplitter } from '../runner/stream'
import { agentCommand } from '../runner/executable'
import type { CommandPlugin, ProbeResult } from './types'

/** 정상 환경에서 init은 2~6초에 온다(NFR-1). 훅이 느린 날을 감안해 그 두 배 남짓을 준다. */
const DEFAULT_TIMEOUT_MS = 10_000

/**
 * 목록만 얻는 인자. `--tools ""`로 도구를 없애고 `--mcp-config`는 넘기지 않는다(NFR-3).
 * `--strict-mcp-config`는 사용자의 개인 MCP 서버가 probe마다 뜨는 것을 막는다(실측: 없으면
 * 서버 9개가 떠 init까지 5.82초, 있으면 0개·1.16초) — 실제 run도 이 플래그를 쓰므로 목록이
 * run 환경과 일치한다. `--verbose` 없이는 stream-json이 거부된다(CLAUDE.md).
 */
const PROBE_ARGS = ['-p', '--output-format', 'stream-json', '--verbose', '--tools', '', '--strict-mcp-config']

/**
 * 작업 디렉토리에서 CLI를 띄워 `system/init`의 슬래시 커맨드 목록만 받고 **즉시 죽인다**.
 *
 * init은 모델 호출보다 먼저 오므로 그 자리에서 끊으면 요금이 들지 않는다(FR-10). 실행 파일은
 * 호출자가 푼다 — `execution`이 쓰는 preflight(`resolveAgentPath` → `findExecutable` →
 * 배치 shim 거부)와 같은 길을 타야 하고, 여기서 다시 하면 두 벌이 된다.
 *
 * **던지지 않는다**(NFR-2). 스폰 실패·init 없는 종료·타임아웃 전부 빈 목록과 사유로 돌아온다.
 * RunManager를 타지 않으므로 슬롯·큐·`run` 테이블·`onRunUpdate` 어디에도 흔적이 없다(FR-11).
 */
export function probeCommands(input: {
  executable: string
  cwd: string
  timeoutMs?: number
}): Promise<ProbeResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      const launch = agentCommand(input.executable, PROBE_ARGS)
      child = spawn(launch.cmd, launch.args, {
        cwd: input.cwd,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (err) {
      // .cmd처럼 spawn 자체가 동기로 던지는 경우(EINVAL). 아직 치울 것이 없다.
      resolve(failure(`실행 파일을 띄우지 못했습니다: ${errorMessage(err)}`))
      return
    }

    let settled = false
    let stderr = ''

    /** 첫 결과만 살린다 — init·타임아웃·스폰 실패·init 없는 종료가 겹칠 수 있다. */
    const settle = (result: ProbeResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      settle(failure(`시간이 초과됐습니다 (${timeoutMs}ms 안에 init이 오지 않았습니다)`))
    }, timeoutMs)

    // 없는 경로는 여기로 온다(ENOENT). 'close'는 뒤따르지 않을 수 있다.
    child.on('error', (err) => settle(failure(`실행 파일을 띄우지 못했습니다: ${err.message}`)))

    // 프롬프트를 주고 반드시 닫는다 — 안 닫으면 Claude Code가 3초를 기다린다.
    // 'error' 리스너는 방어다. macOS 실측으로는 이 write가 즉시 끝나 오류가 나지 않지만,
    // 파이프 write가 비동기인 Windows에서 init 직후 죽인 자식이 그 write를 끊으면 stdin에
    // EPIPE가 올 수 있고, 리스너가 없으면 처리되지 않은 예외로 메인 프로세스가 내려간다.
    child.stdin?.on('error', () => {})
    child.stdin?.write('hi')
    child.stdin?.end()

    const splitter = createLineSplitter((line) => {
      const init = parseInit(line)
      if (!init) return
      // init을 받는 즉시 죽인다 — 다음에 오는 것이 모델 호출이다(FR-10).
      child.kill('SIGKILL')
      settle({ ...init, error: null })
    })
    child.stdout?.on('data', (chunk: Buffer) => splitter(chunk))
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })

    child.on('close', (code) => {
      // 개행 없이 끝난 마지막 줄이 init일 수 있다. 먼저 흘려보내고 나서 판정한다.
      splitter.flush()
      const detail = stderr.trim().slice(0, 500)
      settle(failure(`CLI가 init 없이 종료됐습니다 (종료 코드 ${code})${detail ? `: ${detail}` : ''}`))
    })
  })
}

function failure(error: string): ProbeResult {
  return {
    slashCommands: [], terminalSlashCommands: [], plugins: [],
    model: null, version: null, error
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * `system/init` 줄이면 목록을 뽑고, 아니면 null. 깨진 JSON도 null이다 — 줄 하나 때문에
 * 목록 전체를 포기하지 않는다(어댑터의 `parseLine`이 깨진 줄을 다루는 것과 같은 규칙).
 *
 * **내보내는 것은 테스트를 위해서다.** 이 파일의 다른 테스트는 shebang 스크립트를
 * 실행 파일로 띄우므로 Windows에서 통째로 스킵된다 — 순수 함수로 빼 두면 파싱만은
 * 모든 플랫폼에서 고정된다(`core/app/reveal.ts`가 같은 이유로 순수 함수다).
 */
export function parseInit(line: string): Omit<ProbeResult, 'error'> | null {
  let obj: unknown
  try {
    obj = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof obj !== 'object' || obj === null) return null
  const record = obj as Record<string, unknown>
  if (record['type'] !== 'system' || record['subtype'] !== 'init') return null
  return {
    slashCommands: strings(record['slash_commands']),
    terminalSlashCommands: strings(record['terminal_slash_commands']),
    plugins: plugins(record['plugins']),
    // 같은 줄에 이미 실려 오던 것들이다. 설정 화면이 이 둘 때문에 CLI를 또
    // 띄우지 않도록 여기서 함께 나른다 (docs/sdlc/agent-setup/ NFR-3).
    model: text(record['model']),
    version: text(record['claude_code_version'])
  }
}

/** 비어 있지 않은 문자열만. 그 외는 전부 null — 모르는 것은 모른다고 둔다. */
function text(raw: unknown): string | null {
  return typeof raw === 'string' && raw ? raw : null
}

/** 배열이 아니면 빈 배열, 배열이면 문자열만 남긴다. */
function strings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
}

/** `name`·`path`가 둘 다 문자열인 항목만 남긴다. describe가 그 경로 아래를 훑는다. */
function plugins(raw: unknown): CommandPlugin[] {
  if (!Array.isArray(raw)) return []
  const out: CommandPlugin[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const { name, path } = item as Record<string, unknown>
    if (typeof name === 'string' && typeof path === 'string') out.push({ name, path })
  }
  return out
}
