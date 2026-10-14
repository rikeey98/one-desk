import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchApp } from './driver'
import { waitConvStatus } from './dock'

/**
 * WSL repo (docs/sdlc/wsl-support/ plan 14단계). 진짜 WSL이 없는 장비에서 **가짜 wsl.exe**(`fake-wsl.mjs`)로 "WSL repo의 프로세스가
 * 어떤 모양으로 떴나"를 본다 — interop·파이프·kill은 흉내내지 않는다. 가짜는 모양만 본다: 진짜 wsl.exe와 진짜 claude는
 * `e2e/wsl-real.e2e.ts`(선택 실행, spec §4-B)다.
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
  it.skipIf(process.platform !== 'win32')('WSL 버튼으로 고른 폴더가 한 번에 WSL repo가 되고, WSL 탭에 모이고, run이 wsl.exe로 감싸여 뜬다', async () => {
    const app = await launchApp({ env: { ONE_DESK_WSL_PATH: FAKE_WSL } })
    const page = app.page
    const capture = join(app.dataDir, 'wsl-capture.jsonl')
    // 캡처 파일은 앱의 env로 넘겨야 가짜 wsl이 본다 — 드라이버의 env는 그대로 자식(가짜 wsl)에 물려진다
    await app.electron.evaluate((_e, file) => { process.env['ONE_DESK_WSL_CAPTURE'] = file }, capture)
    // 네이티브 대화상자는 Playwright가 누를 수 없다 — main의 dialog만 바꿔 세우고 시작 폴더를 적어 둔다. 버튼 → preload →
    // ipcMain.handle → core.wsl.folderStart → 대화상자까지의 왕복은 진짜다(repo-pick.e2e와 같은 방식).
    await app.electron.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const options = args[args.length - 1] as { defaultPath?: string }
        ;(globalThis as { pickedFrom?: string | null }).pickedFrom = options.defaultPath ?? null
        return { canceled: false, filePaths: [picked] }
      }) as typeof dialog.showOpenDialog
    }, WSL_PATH)

    await page.getByPlaceholder('새 workspace 이름…').fill('wsl-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: 'wsl-ws', exact: true })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    // 1. 등록 폼 — WSL 버튼은 기본 배포판의 홈에서 열고, 고른 WSL 폴더는 체크가 켜진 채 온다 (wsl-repo-setup FR-1~5)
    await page.getByRole('button', { name: 'repo 등록' }).click()
    await page.getByPlaceholder('repo 이름').fill('샘플')
    await page.getByRole('button', { name: 'WSL 폴더 고르기' }).click()
    await expect.poll(() => page.getByPlaceholder('/절대/경로').inputValue()).toBe(WSL_PATH)
    expect(await app.electron.evaluate(() => (globalThis as { pickedFrom?: string | null }).pickedFrom)).toBe('\\\\wsl$\\Ubuntu\\home\\me')
    const check = page.getByRole('checkbox', { name: 'WSL 안의 claude로 실행' })
    expect(await check.isChecked()).toBe(true)
    // 배포판과 Linux 경로가 체크 아래 두 줄로 선다
    expect(await page.locator('.add-repo-env-hint').innerText()).toBe('Ubuntu\n/home/me/api')
    await page.getByRole('button', { name: '추가', exact: true }).click()
    const card = page.getByRole('button', { name: '샘플 repo', exact: true })
    await card.waitFor({ state: 'visible', timeout: 10_000 })
    // 사이드바 카드가 WSL로 등록됐음을 말한다 (FR-6)
    await card.locator('.repo-env', { hasText: 'WSL' }).waitFor({ state: 'visible' })

    // 2. repo 탭 — 설정에 가서 바꾸지 않았는데 이미 WSL이다(IPC 왕복). 다시 열어도 그대로
    await page.getByRole('button', { name: '설정' }).click()
    await page.getByRole('tab', { name: 'repo' }).click()
    const group = page.getByRole('radiogroup', { name: '샘플 claude 실행 환경' })
    await group.waitFor({ state: 'visible', timeout: 10_000 })
    expect(await group.getByRole('radio', { name: 'WSL' }).isChecked()).toBe(true)
    await page.getByText('배포판 Ubuntu · /home/me/api').waitFor({ state: 'visible' })

    // 3. WSL 탭 — 배포판·WSL claude 줄·WSL repo가 한곳에 모인다 (wsl-repo-setup FR-8)
    await page.getByRole('tab', { name: 'WSL', exact: true }).click()
    const distros = page.getByRole('list', { name: 'WSL 배포판' })
    await distros.waitFor({ state: 'visible', timeout: 10_000 })
    expect(await distros.getByRole('listitem').allInnerTexts()).toEqual([expect.stringContaining('Ubuntu'), 'Debian'])
    await page.getByRole('list', { name: 'WSL claude 상태' }).getByText(/Claude Code \(WSL · Ubuntu\)/).waitFor({ state: 'visible', timeout: 15_000 })
    const rows = page.getByRole('list', { name: 'WSL repo' }).getByRole('listitem')
    expect(await rows.count()).toBe(1)
    await rows.first().getByText('WSL claude', { exact: true }).waitFor({ state: 'visible' })
    // 바로가기 — repo 탭의 그 repo 실행 환경으로 (FR-9)
    await page.getByRole('button', { name: '샘플: repo 탭에서 열기' }).click()
    await expect.poll(() => page.getByRole('radiogroup', { name: '샘플 claude 실행 환경' }).locator('input[value="wsl"]:focus').count(),
      { timeout: 10_000 }).toBe(1)

    // 4. 실행 탭의 CLI 상태에도 같은 WSL 줄이 선다 (wsl-support FR-13)
    await page.getByRole('tab', { name: '실행' }).click()
    await page.getByText(/Claude Code \(WSL · Ubuntu\)/).waitFor({ state: 'visible', timeout: 15_000 })

    // 5. OpenCode는 고를 수 없다 (FR-7)
    await ws.click()
    const opencode = page.getByLabel('agent').getByRole('option', { name: 'OpenCode' })
    await expect.poll(() => opencode.isDisabled(), { timeout: 10_000 }).toBe(true)

    // 6. 한 턴 — 가짜 wsl이 안의 가짜 claude를 그대로 띄우므로 성공으로 끝난다
    await page.getByPlaceholder(/무엇을 시킬지/).fill('WSL에서 돌아라')
    await page.getByRole('button', { name: '실행', exact: true }).click()
    await waitConvStatus(page, '샘플', 'succeeded', 30_000)

    // 7. 모양: wsl.exe -d Ubuntu --cd /home/me/api --exec /bin/sh <launcher> <pidfile> <claude> … --mcp-config /mnt/…
    const lines = readFileSync(capture, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { argv: string[] })
    // run은 `--mcp-config`가 있는 호출이다 — 저장 직후의 CLI 상태 재판정(probe)도 `--cd`로 먼저 떠 캡처의 앞에 있다
    const launch = lines.map((l) => l.argv).find((a) => a.includes('--mcp-config'))
    expect(launch?.slice(0, 5)).toEqual(['-d', 'Ubuntu', '--cd', '/home/me/api', '--exec'])
    expect(launch?.[5]).toBe('/bin/sh')
    expect(launch?.[6]).toMatch(/launcher\.sh$/)
    expect(launch?.[launch.indexOf('--mcp-config') + 1]).toMatch(/^\/mnt\//)
    // 판정도 WSL 안에서 — test -x
    expect(lines.some((l) => l.argv.includes('test') && l.argv.includes('-x'))).toBe(true)
    // pidfile은 run이 끝나면 없다 (FR-19)
    expect(existsSync(join(app.dataDir, 'wsl'))).toBe(true)
  }, 120_000)

  it.skipIf(process.platform === 'win32')('Windows가 아니면 등록 폼에 WSL 버튼·체크가, 설정에 라디오·WSL 탭이 없다 (FR-4, wsl-repo-setup FR-1·7)', async () => {
    const app = await launchApp()
    const page = app.page
    await registerWslRepo(app)
    await page.getByRole('button', { name: 'repo 등록' }).click()
    await page.getByPlaceholder('/절대/경로').fill(WSL_PATH)
    expect(await page.getByRole('button', { name: 'WSL 폴더 고르기' }).count()).toBe(0)
    expect(await page.getByRole('checkbox').count()).toBe(0)
    await page.getByRole('button', { name: '설정' }).click()
    await page.getByRole('tab', { name: 'repo' }).click()
    await page.getByLabel('샘플 경로').waitFor({ state: 'visible', timeout: 10_000 })
    expect(await page.getByRole('radiogroup').count()).toBe(0)
    expect(await page.getByRole('tab', { name: 'WSL' }).count()).toBe(0)
    await page.getByRole('tab', { name: '앱' }).click()
    await page.getByLabel('터미널 셸 실행 파일').waitFor({ state: 'visible', timeout: 10_000 })
    expect(await page.getByLabel('WSL claude 경로').count()).toBe(0)
  }, 60_000)
})
