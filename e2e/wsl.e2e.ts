import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchApp } from './driver'
import { waitConvStatus } from './dock'

/**
 * WSL repo (docs/sdlc/wsl-support/ plan 14단계). 진짜 WSL이 없는 장비에서 **가짜 wsl.exe**(`fake-wsl.mjs`)로 "WSL repo의 프로세스가
 * 어떤 모양으로 떴나"를 본다 — interop·파이프·kill은 흉내내지 않는다(그것은 사용자 장비의 실측, plan 15단계).
 *
 * 등록은 UNC 경로 그대로다 — 등록은 존재를 검사하지 않고, 같은 경로를 다시 보내는 저장도 검사하지 않는다. 그래서 `\\wsl$\…`가
 * 없는 장비에서도 repo 탭에서 실행 환경을 WSL로 바꿀 수 있다. **Windows에서만 WSL을 고를 수 있다**(FR-4) — 다른 OS에서는 라디오가
 * 없고 그 사실을 본다.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const FAKE_WSL = resolve(HERE, '../core/runner/fixtures/fake-wsl.mjs')
const WSL_PATH = '\\\\wsl$\\Ubuntu\\home\\me\\api'

async function registerWslRepo(app: Awaited<ReturnType<typeof launchApp>>) {
  const page = app.page
  await page.getByPlaceholder('새 workspace 이름…').fill('wsl-ws')
  await page.getByPlaceholder('새 workspace 이름…').press('Enter')
  const ws = page.getByRole('button', { name: 'wsl-ws', exact: true })
  await ws.waitFor({ state: 'visible', timeout: 10_000 })
  await ws.click()

  await page.getByRole('button', { name: 'repo 등록' }).click()
  await page.getByPlaceholder('repo 이름').fill('샘플')
  await page.getByPlaceholder('/절대/경로').fill(WSL_PATH)
  await page.getByRole('button', { name: '추가' }).click()
  await page.getByRole('button', { name: '샘플 맥락에 담기' }).waitFor({ state: 'visible', timeout: 10_000 })
  return ws
}

describe('WSL repo (docs/sdlc/wsl-support/)', () => {
  it.skipIf(process.platform !== 'win32')('repo 탭에서 WSL로 바꾸면 IPC를 왕복해 그대로 남고, run이 wsl.exe로 감싸여 뜬다', async () => {
    const app = await launchApp({ env: { ONE_DESK_WSL_PATH: FAKE_WSL } })
    const page = app.page
    const capture = join(app.dataDir, 'wsl-capture.jsonl')
    // 캡처 파일은 앱의 env로 넘겨야 가짜 wsl이 본다 — 드라이버의 env는 그대로 자식(가짜 wsl)에 물려진다
    await app.electron.evaluate((_e, file) => { process.env['ONE_DESK_WSL_CAPTURE'] = file }, capture)
    const ws = await registerWslRepo(app)

    // 1. repo 탭 — 라디오와 파싱 결과, 저장, 다시 열어도 WSL
    await page.getByRole('button', { name: '설정' }).click()
    await page.getByRole('tab', { name: 'repo' }).click()
    const group = page.getByRole('radiogroup', { name: '샘플 claude 실행 환경' })
    await group.waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByText('WSL 폴더입니다', { exact: false }).waitFor({ state: 'visible' })
    await group.getByRole('radio', { name: 'WSL' }).check()
    await page.getByText('배포판 Ubuntu · /home/me/api').waitFor({ state: 'visible' })
    await page.getByRole('button', { name: '샘플 저장', exact: true }).click()
    await ws.click()
    await page.getByRole('button', { name: '설정' }).click()
    await page.getByRole('tab', { name: 'repo' }).click()
    await expect.poll(() => page.getByRole('radiogroup', { name: '샘플 claude 실행 환경' }).getByRole('radio', { name: 'WSL' }).isChecked(), { timeout: 10_000 }).toBe(true)

    // 2. 실행 탭의 CLI 상태에 WSL 줄이 선다 (FR-13)
    await page.getByRole('tab', { name: '실행' }).click()
    await page.getByText(/Claude Code \(WSL · Ubuntu\)/).waitFor({ state: 'visible', timeout: 15_000 })

    // 3. OpenCode는 고를 수 없다 (FR-7)
    await ws.click()
    const opencode = page.getByLabel('agent').getByRole('option', { name: 'OpenCode' })
    await expect.poll(() => opencode.isDisabled(), { timeout: 10_000 }).toBe(true)

    // 4. 한 턴 — 가짜 wsl이 안의 가짜 claude를 그대로 띄우므로 성공으로 끝난다
    await page.getByPlaceholder(/무엇을 시킬지/).fill('WSL에서 돌아라')
    await page.getByRole('button', { name: '실행', exact: true }).click()
    await waitConvStatus(page, '샘플', 'succeeded', 30_000)

    // 5. 모양: wsl.exe -d Ubuntu --cd /home/me/api -- /bin/sh <launcher> <pidfile> <claude> … --mcp-config /mnt/…
    const lines = readFileSync(capture, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { argv: string[] })
    const launch = lines.map((l) => l.argv).find((a) => a.includes('--cd'))
    expect(launch?.slice(0, 5)).toEqual(['-d', 'Ubuntu', '--cd', '/home/me/api', '--'])
    expect(launch?.[5]).toBe('/bin/sh')
    expect(launch?.[6]).toMatch(/launcher\.sh$/)
    expect(launch?.[launch.indexOf('--mcp-config') + 1]).toMatch(/^\/mnt\//)
    // 판정도 WSL 안에서 — test -x
    expect(lines.some((l) => l.argv.includes('test') && l.argv.includes('-x'))).toBe(true)
    // pidfile은 run이 끝나면 없다 (FR-19)
    expect(existsSync(join(app.dataDir, 'wsl'))).toBe(true)
  }, 120_000)

  it.skipIf(process.platform === 'win32')('Windows가 아니면 repo 탭에 실행 환경 라디오가 없다 (FR-4)', async () => {
    const app = await launchApp()
    const page = app.page
    await registerWslRepo(app)
    await page.getByRole('button', { name: '설정' }).click()
    await page.getByRole('tab', { name: 'repo' }).click()
    await page.getByLabel('샘플 경로').waitFor({ state: 'visible', timeout: 10_000 })
    expect(await page.getByRole('radiogroup').count()).toBe(0)
    await page.getByRole('tab', { name: '앱' }).click()
    await page.getByLabel('터미널 셸 실행 파일').waitFor({ state: 'visible', timeout: 10_000 })
    expect(await page.getByLabel('WSL claude 경로').count()).toBe(0)
  }, 60_000)
})
