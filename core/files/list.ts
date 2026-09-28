import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { findExecutable } from '../runner/executable'

/** 목록 상한. 넘으면 앞의 이만큼에서만 찾는다 (docs/sdlc/input-triggers/ §5-1) */
export const MAX_LISTED_FILES = 200_000
const DEFAULT_TIMEOUT_MS = 5_000

export type RepoFileList =
  | { ok: true; files: string[]; truncated: boolean }
  | { ok: false; reason: string }

export interface ListDeps {
  findGit?: () => Promise<string | null>
  spawn?: (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess
  timeoutMs?: number
}

/**
 * repo의 파일 목록 — `git ls-files -co --exclude-standard -z` (FR-5).
 *
 * 추적 중이거나, 추적하지 않았지만 무시되지 않은 파일이다. **피커와 멘션 해석이 같은 이 함수를
 * 쓴다** — 둘이 다르면 피커에 없는 `.env`가 손으로 치면 실린다(spec §7의 3). `-z`는 한글 파일명이
 * `"\354…"`로 인용되지 않게 한다. **비동기로 띄운다** — 메인 프로세스의 MCP 서버를 멈추지 않게
 * (CLAUDE.md의 동기 실행 함정, NFR-3). **던지지 않는다** — 이유를 `ok: false`로 돌려준다.
 */
export async function listRepoFiles(root: string, deps: ListDeps = {}): Promise<RepoFileList> {
  const git = await (deps.findGit ?? (() => findExecutable('git')))()
  if (!git) return { ok: false, reason: 'git 실행 파일을 찾을 수 없습니다' }
  const spawn = deps.spawn ?? nodeSpawn
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise<RepoFileList>((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(git, ['ls-files', '-co', '--exclude-standard', '-z'], {
        cwd: root,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (err) {
      resolve({ ok: false, reason: `git을 띄우지 못했습니다: ${message(err)}` })
      return
    }

    const chunks: Buffer[] = []
    let stderr = ''
    let settled = false
    const settle = (result: RepoFileList): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      settle({ ok: false, reason: `git이 ${timeoutMs}ms 안에 파일 목록을 주지 않았습니다` })
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (err) => settle({ ok: false, reason: `git을 띄우지 못했습니다: ${err.message}` }))
    child.on('close', (code) => {
      if (code !== 0) {
        const first = stderr.trim().split('\n')[0] ?? ''
        settle({
          ok: false,
          reason: /not a git repository/i.test(stderr)
            ? 'git 저장소가 아니라 파일 목록을 만들 수 없습니다'
            : `git이 파일 목록을 주지 못했습니다${first ? `: ${first}` : ''}`
        })
        return
      }
      const all = Buffer.concat(chunks).toString('utf8').split('\0').filter(Boolean)
      settle({
        ok: true,
        files: all.length > MAX_LISTED_FILES ? all.slice(0, MAX_LISTED_FILES) : all,
        truncated: all.length > MAX_LISTED_FILES
      })
    })
  })
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
