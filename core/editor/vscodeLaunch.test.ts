import { describe, it, expect } from 'vitest'
import { vscodeExeCandidates, newWindowArgs } from './vscodeLaunch'

describe('vscodeExeCandidates', () => {
  it('Windows의 bin\\code.cmd에서 설치 디렉토리의 Code.exe를 유도한다', () => {
    // PATH에 있는 것은 .cmd shim이고 그것은 shell 없이 spawn할 수 없다(EINVAL).
    // 실제 실행 파일은 bin의 부모에 있다.
    expect(vscodeExeCandidates(
      'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd', 'win32'
    )).toEqual([
      'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
      'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code - Insiders.exe'
    ])
  })

  it('bin 아래가 아니면 유도하지 않는다 — 엉뚱한 경로를 지어내지 않는다', () => {
    expect(vscodeExeCandidates('C:\\tools\\code.cmd', 'win32'))
      .toEqual(['C:\\tools\\code.cmd'])
  })

  it('Windows에서도 .exe를 찾았으면 그대로 쓴다', () => {
    expect(vscodeExeCandidates('C:\\VS Code\\Code.exe', 'win32'))
      .toEqual(['C:\\VS Code\\Code.exe'])
  })

  it('macOS·Linux의 code는 셸 스크립트라 그대로 쓴다', () => {
    expect(vscodeExeCandidates('/usr/local/bin/code', 'darwin'))
      .toEqual(['/usr/local/bin/code'])
    expect(vscodeExeCandidates('/usr/bin/code', 'linux'))
      .toEqual(['/usr/bin/code'])
  })
})

describe('newWindowArgs', () => {
  it('--new-window를 반드시 붙인다 — 없으면 기존 창을 덮어쓴다', () => {
    expect(newWindowArgs('/tmp/api', 'darwin')[0]).toBe('--new-window')
  })

  it('경로를 -- 뒤에 둔다 — -로 시작하는 경로가 옵션으로 읽히지 않게', () => {
    expect(newWindowArgs('/tmp/-weird', 'darwin'))
      .toEqual(['--new-window', '--', '/tmp/-weird'])
  })

  it('끝의 구분자를 떼어낸다', () => {
    expect(newWindowArgs('C:\\repo\\', 'win32'))
      .toEqual(['--new-window', '--', 'C:\\repo'])
    expect(newWindowArgs('/tmp/api/', 'darwin'))
      .toEqual(['--new-window', '--', '/tmp/api'])
  })

  it('루트는 그대로 둔다', () => {
    expect(newWindowArgs('/', 'darwin')).toEqual(['--new-window', '--', '/'])
  })
})

describe('findVscodeExecutable', () => {
  it('PATH에 code가 없으면 null이다 — 호출자가 URL로 되돌아가는 신호다', async () => {
    const { findVscodeExecutable } = await import('./vscodeLaunch')
    const found = await findVscodeExecutable({
      platform: 'win32',
      // PATH도 홈도 비우면 후보가 하나도 만들어지지 않는다.
      env: { PATH: '', PATHEXT: '.EXE;.CMD' }
    })
    expect(found).toBeNull()
  })
})
