import { describe, it, expect } from 'vitest'
import { runCli } from './exec'
import { asLinuxPackage, PRINT_LOADER_ENV, RESTORED } from '../runner/fixtures/linuxPackageEnv'

describe('runCli — 띄우는 CLI의 환경 (docs/sdlc/linux-launch-env/)', () => {
  it('리눅스 패키지에서는 사용자의 LD_LIBRARY_PATH를 되돌려 준다 — 인증·모델 조회가 run과 같은 환경을 본다', async () => {
    const out = await asLinuxPackage(() => runCli({ executable: process.execPath, args: ['-e', PRINT_LOADER_ENV] }))
    expect(out.failure).toBeNull()
    expect(JSON.parse(out.stdout)).toEqual(RESTORED)
  })
})
