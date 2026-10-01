import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { launchApp, type AppSession } from './driver'
import { clickRowAction } from './rowAction'

/**
 * 패널 창 (docs/sdlc/item-windows/). 이슈·메모·skill 패널을 (종류, repo)마다 별도 OS 창으로 연다.
 *
 * 창은 Playwright가 `electron.waitForEvent('window')`로 받는다. 창을 "사용자가 X를 누른 것처럼" 닫을 때는
 * main의 `BrowserWindow.close()`를 부른다 — `page.close()`는 기본으로 beforeunload를 건너뛰어 FR-15의
 * 장치를 보지 못한다.
 */

async function setupWorkspace(page: Page, name: string): Promise<void> {
  await page.getByPlaceholder('새 workspace 이름…').fill(name)
  await page.getByPlaceholder('새 workspace 이름…').press('Enter')
  const ws = page.getByRole('button', { name, exact: true })
  await ws.waitFor({ state: 'visible', timeout: 10_000 })
  await ws.click()
}

async function addRepo(page: Page, name: string, path: string): Promise<void> {
  await page.getByRole('button', { name: 'repo 등록' }).click()
  await page.getByPlaceholder('repo 이름').fill(name)
  await page.getByPlaceholder('/절대/경로').fill(path)
  await page.getByRole('button', { name: '추가' }).click()
  await page.getByRole('button', { name: `${name} repo`, exact: true }).waitFor({ timeout: 10_000 })
}

async function addIssue(page: Page, title: string): Promise<void> {
  await page.getByPlaceholder('새 이슈 제목…').fill(title)
  await page.getByPlaceholder('새 이슈 제목…').press('Enter')
  await page.getByRole('button', { name: title, exact: true }).waitFor({ timeout: 10_000 })
}

/** 패널 헤더의 "새 창으로 열기"를 눌러 새 창을 받는다. */
async function openPanelWindow(app: AppSession, label: string): Promise<Page> {
  const next = app.electron.waitForEvent('window')
  await app.page.getByRole('button', { name: label, exact: true }).click()
  const win = await next
  await win.waitForLoadState('domcontentloaded')
  return win
}

async function windowTitles(app: AppSession): Promise<string[]> {
  return app.electron.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => w.getTitle()).sort())
}

/** 사용자가 창의 X를 누른 것과 같다 — beforeunload를 탄다. */
async function closeWindowTitled(app: AppSession, title: string): Promise<void> {
  await app.electron.evaluate(({ BrowserWindow }, t) => {
    BrowserWindow.getAllWindows().find((w) => w.getTitle() === t)?.close()
  }, title)
}

describe('패널 창 (docs/sdlc/item-windows/)', () => {
  it('repo마다 창이 생기고, 앱 창에서 repo를 바꿔도 창은 연 repo에 남는다 — 같은 범위는 창 하나다', async () => {
    const app = await launchApp()
    const webDir = mkdtempSync(join(tmpdir(), 'one-desk-e2e-web-'))
    try {
      const page = app.page
      await setupWorkspace(page, 'pw-ws')
      await addRepo(page, 'api', app.repoDir)
      await addRepo(page, 'web', webDir)

      await page.getByRole('button', { name: 'api repo', exact: true }).click()
      await addIssue(page, 'api 이슈')
      await page.getByRole('button', { name: 'web repo', exact: true }).click()
      await addIssue(page, 'web 이슈')

      // api를 골라 연다 (FR-1·5)
      await page.getByRole('button', { name: 'api repo', exact: true }).click()
      const apiWin = await openPanelWindow(app, '이슈 새 창으로 열기')
      await apiWin.getByRole('heading', { name: '이슈 · api' }).waitFor({ timeout: 10_000 })
      await apiWin.getByRole('button', { name: 'api 이슈', exact: true }).waitFor()
      expect(await apiWin.getByRole('button', { name: 'web 이슈', exact: true }).count()).toBe(0)
      // 패널 창에는 담기가 없다 (FR-8)
      expect(await apiWin.getByRole('button', { name: /맥락에 담기/ }).count()).toBe(0)

      // 앱 창에서 web을 골라도 창은 api다 (FR-2)
      await page.getByRole('button', { name: 'web repo', exact: true }).click()
      await page.getByRole('button', { name: 'web 이슈', exact: true }).waitFor()
      await apiWin.waitForTimeout(500)
      expect(await apiWin.getByRole('heading', { name: '이슈 · api' }).count()).toBe(1)
      expect(await apiWin.getByRole('button', { name: 'web 이슈', exact: true }).count()).toBe(0)

      // web 창이 따로 선다
      const webWin = await openPanelWindow(app, '이슈 새 창으로 열기')
      await webWin.getByRole('heading', { name: '이슈 · web' }).waitFor({ timeout: 10_000 })
      await expect.poll(() => windowTitles(app)).toEqual(['one-desk', '이슈 · api', '이슈 · web'].sort())

      // 같은 범위를 다시 열면 창이 늘지 않는다 (FR-3)
      await page.getByRole('button', { name: 'api repo', exact: true }).click()
      await page.getByRole('button', { name: '이슈 새 창으로 열기', exact: true }).click()
      await page.waitForTimeout(800)
      expect((await windowTitles(app)).length).toBe(3)

      // 창에서 고친 것이 앱 창 목록에 곧바로 보인다 (FR-17·18)
      await apiWin.getByRole('button', { name: 'api 이슈', exact: true }).click()
      const title = apiWin.getByRole('textbox', { name: '제목', exact: true })
      await title.fill('api 이슈 고침')
      await page.getByRole('button', { name: 'api 이슈 고침', exact: true }).waitFor({ timeout: 10_000 })
      // 상세가 열려 있어도 목록이 옆에 남는다 (FR-7)
      expect(await apiWin.getByRole('button', { name: 'api 이슈 고침', exact: true }).isVisible()).toBe(true)

      // 앱 창에서 repo를 지우면 창이 그렇게 말한다 (FR-10)
      const repoRow = page.locator('.repo-slot').filter({ has: page.getByRole('button', { name: 'api repo', exact: true }) })
      await clickRowAction(repoRow, 'api 삭제')
      await clickRowAction(repoRow, '정말 삭제?')
      await apiWin.getByText('이 repo는 삭제됐습니다').waitFor({ timeout: 10_000 })
    } finally {
      rmSync(webDir, { recursive: true, force: true })
    }
  })

  it('창을 닫기 직전에 친 글자가 남는다 — 대기 중인 저장을 흘려보낸 뒤 닫힌다 (FR-15)', async () => {
    const app = await launchApp()
    const page = app.page
    await setupWorkspace(page, 'pw-close')
    await addIssue(page, '닫기 이슈')

    const win = await openPanelWindow(app, '이슈 새 창으로 열기')
    await win.getByRole('heading', { name: '이슈 · pw-close 전체' }).waitFor({ timeout: 10_000 })
    await win.getByRole('button', { name: '닫기 이슈', exact: true }).click()
    await win.getByRole('textbox', { name: '본문', exact: true }).fill('닫기 직전에 친 글자')
    // 디바운스(600ms)가 끝나기 전에 닫는다.
    const closed = win.waitForEvent('close')
    await closeWindowTitled(app, '이슈 · pw-close 전체')
    await closed

    await page.getByRole('button', { name: '닫기 이슈', exact: true }).click()
    await page.locator('.detail-body-read').getByText('닫기 직전에 친 글자').waitFor({ timeout: 10_000 })
  })

  it('앱 창도 닫기 직전에 친 글자를 잃지 않는다 (FR-16a)', async () => {
    const app = await launchApp()
    await setupWorkspace(app.page, 'pw-main')
    await addIssue(app.page, '앱 창 이슈')
    await app.page.getByRole('button', { name: '앱 창 이슈', exact: true }).click()
    await app.page.getByRole('textbox', { name: '본문', exact: true }).fill('앱을 끄기 직전에 친 글자')
    await closeWindowTitled(app, 'one-desk')

    await app.relaunch()
    await app.page.getByRole('button', { name: 'pw-main', exact: true }).click()
    await app.page.getByRole('button', { name: '앱 창 이슈', exact: true }).click()
    await app.page.locator('.detail-body-read').getByText('앱을 끄기 직전에 친 글자').waitFor({ timeout: 10_000 })
  })

  it('skill 창은 그 repo의 skill을 보이고 본문을 마크다운으로 읽힌다', async () => {
    const app = await launchApp()
    const skillDir = join(app.repoDir, '.claude', 'skills', '배포')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: 배포\ndescription: 배포 절차\n---\n# 배포 절차\n\n**먼저** 테스트를 돌린다\n')

    await setupWorkspace(app.page, 'pw-skill')
    await addRepo(app.page, 'api', app.repoDir)
    await app.page.getByRole('button', { name: 'api repo', exact: true }).click()

    const win = await openPanelWindow(app, 'skill 새 창으로 열기')
    await win.getByRole('heading', { name: 'skill · api' }).waitFor({ timeout: 10_000 })
    await win.getByRole('button', { name: '배포', exact: true }).click()
    await win.getByRole('heading', { name: '배포 절차' }).waitFor({ timeout: 10_000 })
    expect(await win.locator('.detail-body-read strong').textContent()).toBe('먼저')
  })

  it('목록을 숨기고 경계를 마우스로 끌어 폭을 바꾼다 (FR-26·27)', async () => {
    const app = await launchApp()
    await setupWorkspace(app.page, 'pw-split')
    await addIssue(app.page, '폭 이슈')
    const win = await openPanelWindow(app, '이슈 새 창으로 열기')
    await win.getByRole('heading', { name: '이슈 · pw-split 전체' }).waitFor({ timeout: 10_000 })

    const list = win.locator('.window-split > .panel-split-list')
    const widthOf = async () => (await list.boundingBox())?.width ?? 0
    const before = await widthOf()
    const handle = win.getByRole('separator', { name: '목록 폭 조절' })
    const box = (await handle.boundingBox())!
    await win.mouse.move(box.x + box.width / 2, box.y + 40)
    await win.mouse.down()
    await win.mouse.move(box.x + box.width / 2 + 150, box.y + 40, { steps: 5 })
    await win.mouse.up()
    await expect.poll(widthOf).toBeGreaterThan(before + 120)

    // 숨기면 상세가 창을 다 쓴다
    const detail = win.locator('.window-split > .panel-split-detail')
    const detailBefore = (await detail.boundingBox())!.width
    await win.getByRole('button', { name: '목록 숨기기', exact: true }).click()
    await list.waitFor({ state: 'hidden' })
    expect((await detail.boundingBox())!.width).toBeGreaterThan(detailBefore + 200)
    await win.getByRole('button', { name: '목록 보이기', exact: true }).click()
    await win.getByRole('button', { name: '폭 이슈', exact: true }).waitFor()
  })
})
