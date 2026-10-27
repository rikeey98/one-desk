import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { launchApp, type AppSession } from './driver'

/**
 * 코드 칸의 터미널 (docs/sdlc/code-editor/terminal-spec.md · terminal-plan 10단계). **진짜 셸**을 띄운다 — 빌드한 앱의
 * node-pty(ConPTY) → core의 셸 서비스 → IPC → xterm까지 실제로 탄다. 셸은 설정이 비었으므로 기본값(Windows는 pwsh, 없으면
 * Windows PowerShell)이다.
 *
 * **프롬프트 모양에 기대지 않는다**(plan 위험 2) — 셸 프로필이 무엇을 찍을지 모른다. 명령은 계산을 품게 써서(`$(40+2)`)
 * 되울림(echo)이 아니라 출력에만 나타나는 글자(`…-42`)를 기다린다.
 */

const WIN = process.platform === 'win32'
/** 출력에만 `<tag>-42`가 나타나는 명령 — PowerShell은 `$(…)`, posix 셸은 `$((…))` */
const echo42 = (tag: string) => (WIN ? `echo "${tag}-$(40+2)"` : `echo "${tag}-$((40+2))"`)

const extraDirs: string[] = []
afterEach(() => {
  for (const dir of extraDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** workspace 하나에 repo 둘(api = 드라이버의 repo, web = 새 임시 폴더) */
async function prepare(app: AppSession): Promise<void> {
  const { page } = app
  const web = mkdtempSync(join(tmpdir(), 'one-desk-e2e-web-'))
  extraDirs.push(web)
  await page.getByPlaceholder('새 workspace 이름…').fill('term-ws')
  await page.getByPlaceholder('새 workspace 이름…').press('Enter')
  await page.getByRole('button', { name: 'term-ws', exact: true }).click()
  for (const [name, path] of [['api', app.repoDir], ['web', web]] as const) {
    await page.getByRole('button', { name: 'repo 등록' }).click()
    await page.getByPlaceholder('repo 이름').fill(name)
    await page.getByPlaceholder('/절대/경로').fill(path)
    await page.getByRole('button', { name: '추가', exact: true }).click()
    await page.getByRole('button', { name: `${name} repo`, exact: true }).waitFor({ timeout: 10_000 })
  }
}

const terminalPane = (page: Page) => page.getByRole('region', { name: '터미널 칸' })
/** xterm이 그린 줄의 글자 — DOM 렌더러라 보이는 줄이 `.xterm-rows`에 있다 */
const termText = (page: Page) => terminalPane(page).locator('.xterm-rows').innerText()

async function waitForText(page: Page, text: string, timeout = 30_000): Promise<void> {
  await expect.poll(async () => (await termText(page)).includes(text), { timeout }).toBe(true)
}

/**
 * 셸이 입력을 받을 준비가 될 때까지 — 출력이 생기고 1.5초 동안 그대로면 준비된 것으로 본다. PowerShell은 프로필을 읽는 동안
 * (이 장비의 conda 프로필은 3초 가까이 걸렸다) 친 글자를 버린다. 프롬프트 모양에는 기대지 않는다(plan 위험 2).
 */
async function waitShellIdle(page: Page): Promise<void> {
  let last = ''
  let stableSince = Date.now()
  await expect.poll(async () => {
    const now = await termText(page)
    if (now !== last) { last = now; stableSince = Date.now() }
    return now.trim() !== '' && Date.now() - stableSince >= 1500
  }, { timeout: 30_000, interval: 250 }).toBe(true)
}

/** 셸에 한 줄을 친다 — 셸이 준비된 뒤 xterm의 숨은 입력칸에 포커스를 주고 친다 */
async function run(page: Page, command: string): Promise<void> {
  await waitShellIdle(page)
  await terminalPane(page).locator('.xterm').click()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

/** 지금 보이는 탭 (terminal-tabs FR-1) */
const selectedTab = (page: Page) => terminalPane(page).getByRole('tab', { selected: true })
const terminalTab = (page: Page, name: string) => terminalPane(page).getByRole('tab', { name, exact: true })

/** `PID=<n>`를 찍고 잠드는 node — 되울림에는 `process.pid*1`이 그대로 있고 출력에만 숫자가 있다 */
const SLEEPING_NODE = `node -e "console.log('PID='+(process.pid*1)); setInterval(()=>{},1e9)"`

async function readPid(page: Page): Promise<number> {
  await expect.poll(async () => /PID=\d+/.test(await termText(page)), { timeout: 30_000 }).toBe(true)
  return Number(/PID=(\d+)/.exec(await termText(page))![1])
}

const isAlive = (pid: number) => { try { process.kill(pid, 0); return 'alive' } catch { return 'gone' } }

async function openTerminal(page: Page): Promise<void> {
  await page.getByRole('button', { name: '터미널', exact: true }).click()
  await terminalPane(page).locator('.xterm-rows').waitFor({ timeout: 20_000 })
}

describe('코드 칸 — 터미널', () => {
  it('명령의 출력이 보이고, 다른 repo로 갔다 와도·파일 칸으로 바꿨다 와도 같은 셸의 출력이 남아 있다', async () => {
    const app = await launchApp()
    const { page } = app
    await prepare(app)

    // 새 대화 칸 — 대상은 작업 디렉토리 알약의 repo(api)다
    await openTerminal(page)
    await run(page, echo42('api'))
    await waitForText(page, 'api-42')

    // 다른 repo — 칸이 web의 셸로 바뀐다(앞의 셸은 core에서 계속 돈다)
    await page.getByLabel('작업 디렉토리', { exact: true }).selectOption({ label: 'web' })
    await expect.poll(async () => (await termText(page)).includes('api-42'), { timeout: 20_000 }).toBe(false)
    await run(page, echo42('web'))
    await waitForText(page, 'web-42')

    // 돌아오면 api 셸의 출력이 그대로다(스냅샷)
    await page.getByLabel('작업 디렉토리', { exact: true }).selectOption({ label: 'api' })
    await waitForText(page, 'api-42')

    // 파일 칸으로 바꿨다 돌아와도 같은 셸이다
    await page.getByRole('button', { name: '파일', exact: true }).click()
    await expect.poll(() => terminalPane(page).count()).toBe(0)
    await page.getByRole('button', { name: '터미널', exact: true }).click()
    await waitForText(page, 'api-42')
    await app.close()
  }, 120_000)

  it('셸 다시 시작은 두 번 눌러야 하고 앞의 출력을 지운다 — exit를 치면 끝남 줄이 선다', async () => {
    const app = await launchApp()
    const { page } = app
    await prepare(app)
    await openTerminal(page)
    await run(page, echo42('before'))
    await waitForText(page, 'before-42')

    await terminalPane(page).getByRole('button', { name: '셸 다시 시작', exact: true }).click()
    await terminalPane(page).getByRole('button', { name: '정말 다시 시작' }).click()
    await expect.poll(async () => (await termText(page)).includes('before-42'), { timeout: 20_000 }).toBe(false)

    await run(page, echo42('after'))
    await waitForText(page, 'after-42')
    await run(page, 'exit')
    await expect.poll(
      () => terminalPane(page).getByRole('status').textContent(), { timeout: 20_000 }
    ).toContain('셸이 끝났습니다 (종료 코드 0)')
    await app.close()
  }, 120_000)

  it('설정에서 셸을 바꾸면 다시 시작한 셸이 그것이다', async () => {
    const app = await launchApp()
    const { page } = app
    await prepare(app)
    await openTerminal(page)
    // 탭 이름이 셸 이름이다 — 다시 시작한 default 탭은 바뀐 셸의 이름으로 다시 매긴다 (terminal-tabs FR-16)
    const shellName = selectedTab(page)
    await expect.poll(() => shellName.textContent(), { timeout: 20_000 }).toMatch(/pwsh|powershell|sh/)

    await page.getByRole('navigation').getByRole('button', { name: /설정/ }).click()
    await page.getByRole('tab', { name: '앱' }).click()
    const target = WIN ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'cmd.exe') : '/bin/sh'
    // 설정을 읽어 오기 전에 치면 읽은 값이 덮어 저장이 잠긴 채다(전체 e2e에서 한 번 깨졌다) — placeholder가 기본값을 말할 때까지
    await expect.poll(() => page.getByLabel('터미널 셸 실행 파일').getAttribute('placeholder'), { timeout: 20_000 }).toMatch(/^기본값: /)
    await page.getByLabel('터미널 셸 실행 파일').fill(target)
    await page.getByRole('button', { name: '터미널 셸 저장' }).click()
    await expect.poll(() => page.getByLabel('터미널 셸 실행 파일').inputValue()).toBe(target)

    await page.getByRole('button', { name: 'term-ws', exact: true }).click()
    await terminalPane(page).locator('.xterm-rows').waitFor({ timeout: 20_000 })
    await terminalPane(page).getByRole('button', { name: '셸 다시 시작', exact: true }).click()
    await terminalPane(page).getByRole('button', { name: '정말 다시 시작' }).click()
    await expect.poll(() => shellName.textContent(), { timeout: 20_000 }).toBe(WIN ? 'cmd' : 'sh')
    await app.close()
  }, 120_000)

  it('앱을 끄면 셸이 띄운 자식 프로세스까지 끝난다 (FR-9)', async () => {
    const app = await launchApp()
    const { page } = app
    await prepare(app)
    await openTerminal(page)
    await run(page, SLEEPING_NODE)
    const pid = await readPid(page)
    expect(isAlive(pid)).toBe('alive')

    await app.close()
    await expect.poll(() => isAlive(pid), { timeout: 10_000 }).toBe('gone')
  }, 120_000)
})

describe('코드 칸 — 터미널 탭 (docs/sdlc/terminal-tabs/)', () => {
  it.runIf(WIN)('셸 고르기에서 명령 프롬프트를 고르면 cmd 탭이 서고, PowerShell 탭의 출력은 그대로다 (FR-7·8)', async () => {
    const app = await launchApp()
    const { page } = app
    await prepare(app)
    await openTerminal(page)
    const first = (await selectedTab(page).textContent())!
    await run(page, echo42('ps'))
    await waitForText(page, 'ps-42')

    await terminalPane(page).getByRole('button', { name: '셸 고르기' }).click()
    await page.getByRole('menuitem', { name: '명령 프롬프트', exact: true }).click()
    await expect.poll(() => selectedTab(page).textContent(), { timeout: 20_000 }).toBe('cmd')
    await expect.poll(async () => (await termText(page)).includes('ps-42'), { timeout: 20_000 }).toBe(false)
    // 되울림에는 `%OS%`가 그대로 남고 출력에만 펼친 값이 있다(spec §6의 3)
    await run(page, 'echo tab-cmd-%OS%')
    await waitForText(page, 'tab-cmd-Windows_NT')

    await terminalTab(page, first).click()
    await waitForText(page, 'ps-42')
    await app.close()
  }, 120_000)

  it('탭 둘이 따로 돈다 — 탭을 오가고 인박스에 다녀와도 출력이 남고, 탭을 닫으면 그 탭의 자식만 끝나며 앱을 끄면 다 끝난다 (FR-4·18·20)', async () => {
    const app = await launchApp()
    const { page } = app
    await prepare(app)
    await openTerminal(page)
    const nameA = (await selectedTab(page).textContent())!
    await run(page, SLEEPING_NODE)
    const pidA = await readPid(page)

    await terminalPane(page).getByRole('button', { name: '새 터미널', exact: true }).click()
    await expect.poll(() => terminalPane(page).getByRole('tab').count(), { timeout: 20_000 }).toBe(2)
    const nameB = (await selectedTab(page).textContent())!
    expect(nameB).not.toBe(nameA)
    await expect.poll(async () => (await termText(page)).includes(`PID=${pidA}`), { timeout: 20_000 }).toBe(false)
    await run(page, SLEEPING_NODE)
    const pidB = await readPid(page)
    expect(pidB).not.toBe(pidA)

    await terminalTab(page, nameA).click()
    await waitForText(page, `PID=${pidA}`)
    await terminalTab(page, nameB).click()
    await waitForText(page, `PID=${pidB}`)

    // 인박스에 다녀오면 칸이 다시 붙는다 — 그 repo에서 마지막으로 본 탭(B)이다 (FR-6)
    await page.getByRole('navigation').getByRole('button', { name: /인박스/ }).click()
    await expect.poll(() => terminalPane(page).count()).toBe(0)
    await page.getByRole('button', { name: 'term-ws', exact: true }).click()
    await terminalPane(page).locator('.xterm-rows').waitFor({ timeout: 20_000 })
    await expect.poll(() => selectedTab(page).textContent(), { timeout: 20_000 }).toBe(nameB)
    await waitForText(page, `PID=${pidB}`)

    await terminalPane(page).getByRole('button', { name: `${nameB} 터미널 닫기`, exact: true }).click()
    await terminalPane(page).getByRole('button', { name: '정말 닫기', exact: true }).click()
    await expect.poll(() => isAlive(pidB), { timeout: 10_000 }).toBe('gone')
    expect(isAlive(pidA)).toBe('alive')
    await expect.poll(() => selectedTab(page).textContent(), { timeout: 20_000 }).toBe(nameA)
    await waitForText(page, `PID=${pidA}`)

    await app.close()
    await expect.poll(() => isAlive(pidA), { timeout: 10_000 }).toBe('gone')
  }, 180_000)

  it('탭은 repo당 8개까지다 — 8개면 새 터미널이 잠기고 이유를 말하며, 하나를 닫으면 풀린다 (FR-3)', async () => {
    const app = await launchApp()
    const { page } = app
    await prepare(app)
    await openTerminal(page)
    const tabs = terminalPane(page).getByRole('tab')
    // 셸 여덟을 띄운다 — 준비를 기다리지 않고 탭 수와 잠김만 본다(plan 위험 1). Windows는 가벼운 cmd로
    for (let n = 2; n <= 8; n++) {
      if (WIN) {
        await terminalPane(page).getByRole('button', { name: '셸 고르기' }).click()
        await page.getByRole('menuitem', { name: '명령 프롬프트', exact: true }).click()
      } else {
        await terminalPane(page).getByRole('button', { name: '새 터미널', exact: true }).click()
      }
      await expect.poll(() => tabs.count(), { timeout: 20_000 }).toBe(n)
    }
    const plus = terminalPane(page).getByRole('button', { name: '새 터미널', exact: true })
    await expect.poll(() => plus.getAttribute('aria-disabled')).toBe('true')
    expect(await plus.getAttribute('title')).toBe('터미널은 repo당 8개까지입니다 — 하나를 닫으세요')
    // aria-disabled는 Playwright가 비활성으로 본다 — 눌러도 아무것도 안 생기는지 보려고 억지로 누른다
    await plus.click({ force: true })
    await page.waitForTimeout(500)
    expect(await tabs.count()).toBe(8)

    const last = (await tabs.last().textContent())!
    await terminalPane(page).getByRole('button', { name: `${last} 터미널 닫기`, exact: true }).click()
    await terminalPane(page).getByRole('button', { name: '정말 닫기', exact: true }).click()
    await expect.poll(() => tabs.count(), { timeout: 20_000 }).toBe(7)
    await expect.poll(() => plus.getAttribute('aria-disabled')).toBeNull()
    await app.close()
  }, 180_000)

  it.runIf(WIN)('Git Bash가 있는 장비에서는 그 탭이 bash다 (FR-10)', async () => {
    const app = await launchApp()
    const { page } = app
    await prepare(app)
    await openTerminal(page)
    await terminalPane(page).getByRole('button', { name: '셸 고르기' }).click()
    const gitBash = page.getByRole('menuitem', { name: 'Git Bash', exact: true })
    await page.getByRole('menu', { name: '셸 고르기' }).waitFor({ timeout: 10_000 })
    if (await gitBash.count() === 0) {
      // 장비를 탄다(plan 위험 2) — 조용히 빠지지 않게 남긴다
      console.log('[terminal.e2e] 이 장비에는 Git Bash가 없어 Git Bash 탭 시나리오를 건너뛴다')
      await page.keyboard.press('Escape')
      await app.close()
      return
    }
    await gitBash.click()
    await expect.poll(() => selectedTab(page).textContent(), { timeout: 20_000 }).toBe('bash')
    await run(page, 'echo "gb-$((40+2))"')
    await waitForText(page, 'gb-42')
    await app.close()
  }, 120_000)
})
