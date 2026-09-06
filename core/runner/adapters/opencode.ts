import { access, constants } from 'node:fs/promises'
import type { AgentAdapter, PreflightResult, ResolvedRunSpec, SpawnSpec } from '../types'
import { opencodePermissionConfig } from '../permission'
import { findExecutable, isBatchShim, type LookupOptions } from '../executable'
import { withLoopbackBypass } from './common'

const BATCH_SHIM_REASON =
  'opencode.cmd는 직접 실행할 수 없습니다. 네이티브 설치본(opencode.exe)을 쓰거나, workspace 설정에 opencode.exe의 절대 경로를 지정하세요.'

// `: AgentAdapter`가 아니라 `satisfies`인 이유는 claudeCode.ts와 같다 —
// preflight의 두 번째 인자(opts)가 테스트의 이음매인데, 인터페이스로 표기하면
// 타입에서 잘려 테스트가 부를 수 없다.
export const opencodeAdapter = {
  kind: 'opencode',

  async preflight(explicitPath: string | null, opts: LookupOptions = {}): Promise<PreflightResult> {
    let executable: string
    if (explicitPath) {
      try {
        await access(explicitPath, constants.X_OK)
      } catch {
        return { ok: false, reason: `설정된 경로에서 실행할 수 없습니다: ${explicitPath}` }
      }
      executable = explicitPath
    } else {
      const found = await findExecutable('opencode', opts)
      if (!found) {
        return {
          ok: false,
          reason:
            'PATH에서 opencode 실행 파일을 찾을 수 없습니다. workspace 설정에서 경로를 지정하세요.'
        }
      }
      executable = found
    }
    // 배치 shim 판별은 두 경로가 합류한 뒤 한 번만 한다 (claudeCode.ts와 같은 이유).
    if (isBatchShim(executable)) return { ok: false, reason: BATCH_SHIM_REASON }
    return { ok: true, executable }
  },

  buildCommand(spec: ResolvedRunSpec): SpawnSpec {
    const args = ['run', '--format', 'json']

    // --auto는 "명시적으로 deny가 아닌 권한을 자동 승인"이다. 전체 허용에서만
    // 쓴다 (전체 설계 §376). 다른 단계에 켜면 우리가 막은 것이 열린다.
    if (spec.permission === 'full') args.push('--auto')

    // 모델은 provider/model 형식이다 (전체 설계 §199).
    if (spec.model) args.push('-m', spec.model)
    if (spec.resumeSessionId) args.push('--session', spec.resumeSessionId)

    const env = withLoopbackBypass(process.env)

    // **권한은 환경변수로 간다.** OPENCODE_CONFIG가 가리키는 파일은 run의 cwd에
    // 있는 opencode.json에게 지지만, 이 환경변수는 그것도 이긴다 (설계 §2-4).
    env['OPENCODE_PERMISSION'] = JSON.stringify(opencodePermissionConfig(spec.permission))

    // MCP 설정만 파일로 간다 — mcp 섹션에 해당하는 환경변수가 없다.
    // 파일이 없는 경로를 가리키면 opencode가 조용히 무시하므로(설계 §8),
    // 파일을 만드는 쪽(호스트)이 실패를 삼키지 않아야 한다.
    if (spec.mcp) env['OPENCODE_CONFIG'] = spec.mcp.configFile

    // 프롬프트는 stdin으로 넘긴다 — RunManager가 쓰고 닫는다.
    return { cmd: spec.executable, args, env, cwd: spec.cwd }
  },

  parseLine(): [] {
    // Task 3에서 채운다.
    return []
  }
} satisfies AgentAdapter
