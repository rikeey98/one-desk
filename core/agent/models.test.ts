import { describe, it, expect, vi } from 'vitest'
import { createModelCatalog } from './models'
import type { CliOutput, RunCli } from './types'

function ok(stdout: string): CliOutput {
  return { code: 0, stdout, stderr: '', failure: null }
}

// 실측 출력의 앞머리 그대로다 — 한 줄에 provider/model 하나.
const LIST = [
  'opencode/big-pickle',
  'openrouter/anthropic/claude-sonnet-4.5',
  'openrouter/openai/gpt-astra-latest',
  ''
].join('\n')

describe('createModelCatalog', () => {
  it('opencode models의 출력을 줄 단위로 읽는다', async () => {
    const run = vi.fn<RunCli>(async () => ok(LIST))
    const catalog = createModelCatalog(run)

    const models = await catalog.list('opencode', '/bin/opencode')

    expect(models).toEqual([
      'opencode/big-pickle',
      'openrouter/anthropic/claude-sonnet-4.5',
      'openrouter/openai/gpt-astra-latest'
    ])
    expect(run.mock.calls[0]![0].args).toEqual(['models'])
  })

  it('같은 실행 파일로 두 번 불러도 CLI를 한 번만 띄운다', async () => {
    // 설정 화면과 실행 패널이 같은 목록을 본다. 캐시가 없으면 화면을 오갈 때마다
    // 프로세스가 뜬다 — 슬래시 커맨드 캐시와 같은 판단이다.
    const run = vi.fn(async () => ok(LIST))
    const catalog = createModelCatalog(run)

    await catalog.list('opencode', '/bin/opencode')
    await catalog.list('opencode', '/bin/opencode')

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('실행 파일이 다르면 따로 조회한다', async () => {
    // 경로를 바꿨다는 것은 다른 설치본이라는 뜻이다. 캐시를 공유하면 옛 설치본의
    // 목록이 남는다.
    const run = vi.fn(async () => ok(LIST))
    const catalog = createModelCatalog(run)

    await catalog.list('opencode', '/bin/opencode')
    await catalog.list('opencode', '/opt/opencode')

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('동시에 불러도 CLI를 한 번만 띄운다', async () => {
    let resolveRun: (out: CliOutput) => void = () => {}
    const run = vi.fn(() => new Promise<CliOutput>((r) => { resolveRun = r }))
    const catalog = createModelCatalog(run)

    const both = Promise.all([
      catalog.list('opencode', '/bin/opencode'),
      catalog.list('opencode', '/bin/opencode')
    ])
    resolveRun(ok(LIST))
    const [a, b] = await both

    expect(run).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
  })

  it('claude는 조회하지 않고 빈 목록을 준다', async () => {
    // 서브커맨드에 models가 없다(2026-09-22 실측). 화면이 자기 별칭 표를 쓴다.
    const run = vi.fn(async () => ok(LIST))
    const catalog = createModelCatalog(run)

    expect(await catalog.list('claude-code', '/bin/claude')).toEqual([])
    expect(run).not.toHaveBeenCalled()
  })

  it('실패하면 빈 목록이고 던지지 않는다', async () => {
    // 제안이 없을 뿐 칸은 그대로 쓸 수 있어야 한다(FR-8).
    const run = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'boom', failure: null }))
    const catalog = createModelCatalog(run)

    expect(await catalog.list('opencode', '/bin/opencode')).toEqual([])
  })

  it('조회가 터져도 빈 목록으로 돌아온다', async () => {
    const run = vi.fn(() => Promise.reject(new Error('갑자기 터짐')))
    const catalog = createModelCatalog(run)

    expect(await catalog.list('opencode', '/bin/opencode')).toEqual([])
  })

  it('실패도 캐시한다 — 화면을 오갈 때마다 다시 띄우지 않는다', async () => {
    // 슬래시 커맨드가 같은 이유로 실패를 캐시한다(FR-13). 다시 받으려면
    // 사용자가 `다시 확인`을 누른다.
    const run = vi.fn(async () => ({ code: 1, stdout: '', stderr: '', failure: null }))
    const catalog = createModelCatalog(run)

    await catalog.list('opencode', '/bin/opencode')
    await catalog.list('opencode', '/bin/opencode')

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('refresh는 캐시를 버리고 다시 조회한다', async () => {
    const run = vi.fn(async () => ok(LIST))
    const catalog = createModelCatalog(run)

    await catalog.list('opencode', '/bin/opencode')
    catalog.refresh()
    await catalog.list('opencode', '/bin/opencode')

    expect(run).toHaveBeenCalledTimes(2)
  })
})
