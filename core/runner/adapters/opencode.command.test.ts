import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { opencodeAdapter } from './opencode'
import { opencodeV2Config } from '../permission'
import type { ResolvedRunSpec } from '../types'
import { ORIGINAL_LD_LIBRARY_PATH } from '../userEnv'
import { asLinuxPackage, USER_LD_LIBRARY_PATH } from '../fixtures/linuxPackageEnv'

function spec(over: Partial<ResolvedRunSpec> = {}): ResolvedRunSpec {
  return {
    runId: 'run-1',
    cwd: '/tmp/work',
    model: null,
    effort: null,
    permission: 'edit',
    prompt: '무엇이든',
    resumeSessionId: null,
    executable: '/usr/local/bin/opencode',
    mcp: null,
    dialect: 'v1',
    ...over
  }
}

describe('opencodeAdapter.buildCommand — 띄우는 환경 (docs/sdlc/linux-launch-env/)', () => {
  it('리눅스 패키지에서는 opencode를 사용자의 LD_LIBRARY_PATH로 띄우고 표식은 넘기지 않는다', async () => {
    const env = await asLinuxPackage(() => opencodeAdapter.buildCommand(spec()).env)
    expect(env['LD_LIBRARY_PATH']).toBe(USER_LD_LIBRARY_PATH)
    expect(env[ORIGINAL_LD_LIBRARY_PATH]).toBeUndefined()
    expect(env['OPENCODE_PERMISSION']).toBeTruthy()
  })
})

describe('opencodeAdapter.buildCommand', () => {
  it('run과 --format json으로 시작한다', () => {
    const built = opencodeAdapter.buildCommand(spec())
    expect(built.args.slice(0, 3)).toEqual(['run', '--format', 'json'])
    expect(built.cmd).toBe('/usr/local/bin/opencode')
    expect(built.cwd).toBe('/tmp/work')
  })

  it('--thinking이 --format json 바로 뒤에 붙는다 — 없으면 reasoning 줄이 오지 않는다', () => {
    // 1.18.30의 run 루프는 이 플래그가 있을 때만 reasoning 줄을 낸다(`run.ts`:766).
    // 출력만 가른다 — 모델 호출 인자·권한과 무관하다 (conversation-events spec FR-21).
    for (const over of [
      {}, { permission: 'full' as const }, { permission: 'read_only' as const },
      { model: 'anthropic/claude-sonnet-4-5', effort: 'high', resumeSessionId: 'ses_abc' }
    ]) {
      const { args } = opencodeAdapter.buildCommand(spec(over))
      expect(args.slice(0, 4)).toEqual(['run', '--format', 'json', '--thinking'])
      expect(args.filter((a) => a === '--thinking')).toHaveLength(1)
    }
  })

  it('프롬프트를 인자에 싣지 않는다', () => {
    // stdin으로 넘긴다 — 맥락이 합쳐지면 수십 KB라 인자 길이 제한에 걸린다.
    const built = opencodeAdapter.buildCommand(spec({ prompt: '아주 긴 프롬프트' }))
    expect(built.args).not.toContain('아주 긴 프롬프트')
  })

  it('권한을 OPENCODE_PERMISSION 환경변수로 넘긴다', () => {
    // 파일(OPENCODE_CONFIG)은 repo의 opencode.json에게 진다 (설계 §2-3).
    const built = opencodeAdapter.buildCommand(spec({ permission: 'read_only' }))
    const parsed = JSON.parse(built.env['OPENCODE_PERMISSION']!) as Record<string, string>
    expect(parsed['read']).toBe('allow')
    expect(parsed['edit']).toBe('deny')
    expect(Object.values(parsed)).not.toContain('ask')
  })

  it('자동 승인 플래그는 전체 허용에서만 붙고, 1.18.0에서 생긴 --auto가 아니라 1.4.0부터 있는 옛 이름이다', () => {
    // `--auto`는 1.18.0에서 생긴 별칭이라 1.4.0~1.17.x는 모르는 옵션으로 보고 도움말만 찍고 exit 1로
    // 끝난다 — 편집 허용에서는 되던 대화가 전체 허용으로 바꾸는 순간 실패했다(2026-10-02 실측 보고).
    const full = opencodeAdapter.buildCommand(spec({ permission: 'full' })).args
    expect(full).toContain('--dangerously-skip-permissions')
    expect(full).not.toContain('--auto')
    for (const permission of ['edit', 'read_only'] as const) {
      expect(opencodeAdapter.buildCommand(spec({ permission })).args).not.toContain('--dangerously-skip-permissions')
    }
  })

  it('모델이 있으면 -m으로 붙이고 없으면 붙이지 않는다', () => {
    const withModel = opencodeAdapter.buildCommand(spec({ model: 'anthropic/claude-sonnet-4-5' }))
    expect(withModel.args).toContain('-m')
    expect(withModel.args[withModel.args.indexOf('-m') + 1]).toBe('anthropic/claude-sonnet-4-5')
    expect(opencodeAdapter.buildCommand(spec({ model: null })).args).not.toContain('-m')
  })

  it('effort는 --variant로 나간다', () => {
    // claude의 --effort와 **다른 플래그다.** provider마다 값이 달라 다섯 단계 표로
    // 묶을 수 없다 — 그래서 저장 컬럼도 갈라져 있다 (설계 §199와 같은 이유).
    const withVariant = opencodeAdapter.buildCommand(spec({ effort: 'minimal' }))
    expect(withVariant.args).toContain('--variant')
    expect(withVariant.args[withVariant.args.indexOf('--variant') + 1]).toBe('minimal')
    expect(withVariant.args).not.toContain('--effort')
  })

  it('effort가 null이면 --variant를 아예 붙이지 않는다', () => {
    expect(opencodeAdapter.buildCommand(spec({ effort: null })).args).not.toContain('--variant')
  })

  it('이어서 실행은 --session으로 넘긴다', () => {
    const built = opencodeAdapter.buildCommand(spec({ resumeSessionId: 'ses_abc' }))
    expect(built.args).toContain('--session')
    expect(built.args[built.args.indexOf('--session') + 1]).toBe('ses_abc')
  })

  it('MCP가 있으면 OPENCODE_CONFIG로 설정 파일을 가리킨다', () => {
    const built = opencodeAdapter.buildCommand(spec({
      mcp: {
        serverName: 'one-desk',
        configFile: '/data/mcp/run-1.json',
        token: 't',
        url: 'http://127.0.0.1:1/mcp'
      }
    }))
    expect(built.env['OPENCODE_CONFIG']).toBe('/data/mcp/run-1.json')
  })

  it('MCP가 없으면 OPENCODE_CONFIG를 세우지 않는다', () => {
    // 사용자 설정을 우리 것으로 덮을 이유가 없다. 권한은 환경변수가 따로 지킨다.
    expect(opencodeAdapter.buildCommand(spec({ mcp: null })).env['OPENCODE_CONFIG']).toBeUndefined()
  })

  it('루프백을 프록시 예외로 넣는다', () => {
    const built = opencodeAdapter.buildCommand(spec())
    expect(built.env['NO_PROXY']).toContain('127.0.0.1')
    expect(built.env['no_proxy']).toContain('127.0.0.1')
  })
})

describe('opencodeAdapter.preflight', () => {
  it('명시 경로가 실행 불가면 거부한다', async () => {
    const result = await opencodeAdapter.preflight('/없는/경로/opencode')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('/없는/경로/opencode')
  })

  it('.cmd 설치본을 거부하고 대안을 안내한다', async () => {
    // .cmd는 shell 없이 spawn하면 EINVAL이고, shell을 켜면 취소가 자식에 닿지 않는다.
    const dir = mkdtempSync(join(tmpdir(), 'od-pre-'))
    const shim = join(dir, 'opencode.cmd')
    writeFileSync(shim, '')
    chmodSync(shim, 0o755)
    try {
      const result = await opencodeAdapter.preflight(shim)
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('opencode.exe')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('npm 전역 설치의 opencode.cmd는 그것이 부르는 opencode.exe로 풀어 쓴다 — 명시 경로든 PATH 탐색이든', async () => {
    // `npm i -g opencode-ai`는 `<prefix>\opencode.cmd`를 만들고, postinstall이 진짜 바이너리를
    // `<prefix>\node_modules\opencode-ai\bin\opencode.exe`에 둔다(1.18.30 패키지 확인). 껍데기를 거부만
    // 하면 그 설치로는 자동으로도, 손으로 넣어도 실행할 길이 없었다(2026-10-02 보고).
    const dir = mkdtempSync(join(tmpdir(), 'od-pre-'))
    const shim = join(dir, 'opencode.cmd')
    const exe = join(dir, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe')
    writeFileSync(shim, '@ECHO off\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*\r\n')
    mkdirSync(join(dir, 'node_modules', 'opencode-ai', 'bin'), { recursive: true })
    writeFileSync(exe, '')
    chmodSync(shim, 0o755)
    chmodSync(exe, 0o755)
    const versionGate = async () => ({ rejected: null, dialect: 'v1' as const })
    try {
      await expect(opencodeAdapter.preflight(shim, { versionGate })).resolves.toEqual({ ok: true, executable: exe, dialect: 'v1' })
      const found = await opencodeAdapter.preflight(null, {
        platform: 'win32', env: { PATH: dir, PATHEXT: '.EXE;.CMD' }, versionGate
      })
      if (process.platform === 'win32') expect(found).toEqual({ ok: true, executable: exe, dialect: 'v1' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('실행 가능한 명시 경로를 그대로 쓴다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'od-pre-'))
    const bin = join(dir, 'opencode')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    try {
      const result = await opencodeAdapter.preflight(bin)
      expect(result).toEqual({ ok: true, executable: bin, dialect: 'v1' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('opencodeAdapter.buildCommand — 2.x 방언 (opencode-v2 spec FR-6·7·10·11·12)', () => {
  const v2 = (over: Partial<ResolvedRunSpec> = {}) => opencodeAdapter.buildCommand(spec({ dialect: 'v2', ...over }))
  const BASE = ['run', '--standalone', '--format', 'json', '--thinking', '--agent', 'build']

  it.each(['read_only', 'edit', 'full'] as const)('%s: 인자는 권한과 무관하게 같다 — 권한은 규칙으로만 간다', (permission) => {
    expect(v2({ permission }).args).toEqual(BASE)
  })

  it('사설 서버로 돌고 agent를 build로 못박는다', () => {
    // --standalone이 없으면 백그라운드 서비스에 붙어 run의 프로세스 트리 밖에서 돈다(취소가 닿지 않고 서비스가 남는다).
    // --agent build가 없으면 프로젝트의 default_agent가 느슨한 agent로 돌린다(spec 0-1의 구멍).
    const { args } = v2()
    expect(args).toContain('--standalone')
    expect(args.slice(args.indexOf('--agent'), args.indexOf('--agent') + 2)).toEqual(['--agent', 'build'])
  })

  it('1.x의 옵션과 --auto를 붙이지 않는다 — 2.x는 모르는 옵션에 시작부터 죽는다', () => {
    for (const permission of ['read_only', 'edit', 'full'] as const) {
      const { args } = v2({ permission, model: 'opencode/big-pickle', effort: 'high' })
      for (const banned of ['--variant', '--dangerously-skip-permissions', '--auto']) {
        expect(args, `${permission}: ${banned}`).not.toContain(banned)
      }
    }
  })

  it('모델은 -m, variant는 모델 이름에 #으로 붙인다', () => {
    expect(v2({ model: 'opencode/big-pickle' }).args).toEqual([...BASE, '-m', 'opencode/big-pickle'])
    expect(v2({ model: 'opencode/big-pickle', effort: 'high' }).args).toEqual([...BASE, '-m', 'opencode/big-pickle#high'])
  })

  it('모델 없는 variant는 던진다 — 조용히 버리지 않는다(실행 직전 확인이 먼저 막는 자리다)', () => {
    expect(() => v2({ model: null, effort: 'high' })).toThrow(/모델/)
  })

  it('이어 가면 --session을 붙인다', () => {
    expect(v2({ resumeSessionId: 'ses_abc' }).args).toEqual([...BASE, '--session', 'ses_abc'])
  })

  it('권한은 OPENCODE_CONFIG_CONTENT로 가고 OPENCODE_PERMISSION은 싣지 않는다', () => {
    // 2.x 바이너리에는 OPENCODE_PERMISSION이라는 글자가 없다 — 실으면 무시될 뿐 아니라 "걸었다"는 착각을 만든다.
    for (const permission of ['read_only', 'edit', 'full'] as const) {
      const { env } = v2({ permission })
      expect(JSON.parse(env['OPENCODE_CONFIG_CONTENT']!)).toEqual(opencodeV2Config(permission))
      expect(env['OPENCODE_PERMISSION']).toBeUndefined()
    }
  })

  it('MCP 설정은 파일 경로로만 간다 — 토큰과 URL이 환경변수에 없다', () => {
    // 환경변수는 agent의 셸 도구가 띄우는 자식에게 물려진다.
    const { env } = v2({
      mcp: { serverName: 'one-desk', configFile: '/tmp/mcp/run-1.json', token: 'SECRET-TOKEN', url: 'http://127.0.0.1:5555/mcp' }
    })
    expect(env['OPENCODE_CONFIG']).toBe('/tmp/mcp/run-1.json')
    expect(JSON.stringify(env)).not.toContain('SECRET-TOKEN')
    expect(env['OPENCODE_CONFIG_CONTENT']).not.toContain('5555')
    expect(v2().env['OPENCODE_CONFIG']).toBeUndefined()
  })

  it('루프백 예외는 1.x와 같이 붙는다', () => {
    expect(v2().env['NO_PROXY']).toContain('127.0.0.1')
  })
})

describe('opencodeAdapter.buildCommand — 방언이 없으면', () => {
  it('던진다 — 조용히 1.x로 떨어지면 2.x가 권한 없이 돈다', () => {
    expect(() => opencodeAdapter.buildCommand(spec({ dialect: null }))).toThrow(/방언/)
  })

  it('1.x의 인자는 그대로다', () => {
    const { args, env } = opencodeAdapter.buildCommand(spec({ dialect: 'v1', permission: 'full', model: 'a/b', effort: 'high' }))
    expect(args).toEqual(['run', '--format', 'json', '--thinking', '--dangerously-skip-permissions', '-m', 'a/b', '--variant', 'high'])
    expect(env['OPENCODE_PERMISSION']).toBeDefined()
    expect(env['OPENCODE_CONFIG_CONTENT']).toBeUndefined()
  })
})
