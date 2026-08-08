import { access, constants } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import type { AgentAdapter, PreflightResult, ResolvedRunSpec, SpawnSpec } from '../types'
import { claudeCodePermissionArgs } from '../permission'

async function findExecutable(name: string): Promise<string | null> {
  const paths = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean)
  for (const dir of paths) {
    const candidate = join(dir, name)
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // 다음 후보
    }
  }
  return null
}

export const claudeCodeAdapter: AgentAdapter = {
  kind: 'claude-code',

  async preflight(explicitPath: string | null): Promise<PreflightResult> {
    if (explicitPath) {
      try {
        await access(explicitPath, constants.X_OK)
        return { ok: true, executable: explicitPath }
      } catch {
        return { ok: false, reason: `설정된 경로에서 실행할 수 없습니다: ${explicitPath}` }
      }
    }
    const found = await findExecutable('claude')
    if (!found) {
      return {
        ok: false,
        reason: 'PATH에서 claude 실행 파일을 찾을 수 없습니다. workspace 설정에서 경로를 지정하세요.'
      }
    }
    return { ok: true, executable: found }
  },

  buildCommand(spec: ResolvedRunSpec): SpawnSpec {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      // --verbose 없이 stream-json을 쓰면 CLI가 실행을 거부한다 (실측 확인됨)
      '--verbose',
      ...claudeCodePermissionArgs(spec.permission)
    ]

    if (spec.model) args.push('--model', spec.model)
    if (spec.resumeSessionId) args.push('--resume', spec.resumeSessionId)

    // 프롬프트는 stdin으로 넘긴다. 맥락이 합쳐지면 수십 KB가 되는데
    // 커맨드 인자에는 OS별 길이 제한이 있다.
    return {
      cmd: spec.executable,
      args,
      env: { ...process.env } as Record<string, string>,
      cwd: spec.cwd
    }
  },

  parseLine(): [] {
    return [] // Task 6에서 구현한다
  }
}
