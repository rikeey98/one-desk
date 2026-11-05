import { describe, it, expect } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { launchApp } from './driver'

const ISSUE = '웹 화면 깜빡임'

async function addRepo(page: Page, name: string, path: string) {
  await page.getByRole('button', { name: 'repo 등록' }).click()
  await page.getByPlaceholder('repo 이름').fill(name)
  await page.getByPlaceholder('/절대/경로').fill(path)
  await page.getByRole('button', { name: '추가' }).click()
  await page.getByRole('button', { name: `${name} repo` }).waitFor({ state: 'visible', timeout: 10_000 })
}

/** repo 둘 + web에 붙은 이슈 하나. 끝나면 사이드바 선택이 풀려 있다. */
async function workspaceWithWebIssue(page: Page, apiDir: string, webDir: string) {
  await page.getByPlaceholder('새 workspace 이름…').fill('flow-ws')
  await page.getByPlaceholder('새 workspace 이름…').press('Enter')
  await page.getByRole('button', { name: 'flow-ws', exact: true }).click()
  await addRepo(page, 'api', apiDir)
  await addRepo(page, 'web', webDir)

  await page.getByRole('button', { name: 'web repo' }).click()
  await page.getByPlaceholder('새 이슈 (첫 줄이 제목)').fill(ISSUE)
  await page.getByPlaceholder('새 이슈 (첫 줄이 제목)').press('Enter')
  await page.getByRole('button', { name: ISSUE, exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
  await page.getByRole('button', { name: 'web repo' }).click()
}

describe('이슈에서 대화 시작 (docs/sdlc/issue-flow/ FR-1·FR-3)', () => {
  it('새 대화의 작업 디렉토리는 이슈의 repo이고, 첫 턴도 거기서 돈다', async () => {
    const app = await launchApp()
    const page = app.page
    const webDir = join(app.repoDir, 'web')
    mkdirSync(webDir, { recursive: true })
    await workspaceWithWebIssue(page, app.repoDir, webDir)

    await page.getByRole('button', { name: ISSUE, exact: true }).click()
    await page.getByRole('button', { name: '대화 시작' }).click()
    await expect.poll(() => page.getByLabel('작업 디렉토리', { exact: true }).inputValue(), { timeout: 5_000 }).toBe(webDir)

    await page.getByRole('textbox', { name: '지시' }).fill('화면을 고쳐')
    await page.getByRole('button', { name: '실행', exact: true }).click()
    await page.locator('.turn-user').filter({ hasText: '화면을 고쳐' }).waitFor({ state: 'visible', timeout: 10_000 })
    expect(await page.locator('input.run-locked[aria-label="작업 디렉토리"]').getAttribute('title')).toBe(webDir)
  })

  it('사이드바에서 다른 repo를 골라도 이슈의 repo가 남고, 알약으로 고르면 그것을 쓴다', async () => {
    const app = await launchApp()
    const page = app.page
    const webDir = join(app.repoDir, 'web')
    mkdirSync(webDir, { recursive: true })
    await workspaceWithWebIssue(page, app.repoDir, webDir)

    await page.getByRole('button', { name: ISSUE, exact: true }).click()
    await page.getByRole('button', { name: '대화 시작' }).click()
    const cwd = page.getByLabel('작업 디렉토리', { exact: true })
    await expect.poll(() => cwd.inputValue(), { timeout: 5_000 }).toBe(webDir)

    await page.getByRole('button', { name: 'api repo' }).click()
    await page.getByRole('status').filter({ hasText: 'api 대화만' }).waitFor({ state: 'visible', timeout: 5_000 })
    expect(await cwd.inputValue()).toBe(webDir)

    await cwd.selectOption(app.repoDir)
    await page.getByRole('button', { name: 'web에서 시작' }).click()
    await expect.poll(() => cwd.inputValue(), { timeout: 5_000 }).toBe(webDir)
  })

  it('담은 이슈의 repo로 옮겨 가고, 첫 턴도 거기서 돈다', async () => {
    const app = await launchApp()
    const page = app.page
    const webDir = join(app.repoDir, 'web')
    mkdirSync(webDir, { recursive: true })
    await workspaceWithWebIssue(page, app.repoDir, webDir)

    const cwd = page.getByLabel('작업 디렉토리', { exact: true })
    await page.getByRole('button', { name: 'api repo' }).click()
    await page.getByRole('button', { name: 'api repo' }).click()
    await expect.poll(() => cwd.inputValue(), { timeout: 5_000 }).toBe(app.repoDir)

    await page.getByRole('button', { name: `${ISSUE} 맥락에 담기` }).click()
    await expect.poll(() => cwd.inputValue(), { timeout: 5_000 }).toBe(webDir)

    await page.getByRole('textbox', { name: '지시' }).fill('화면을 고쳐')
    await page.getByRole('button', { name: '실행', exact: true }).click()
    await page.locator('.turn-user').filter({ hasText: '화면을 고쳐' }).waitFor({ state: 'visible', timeout: 10_000 })
    expect(await page.locator('input.run-locked[aria-label="작업 디렉토리"]').getAttribute('title')).toBe(webDir)
  })

  it('상세가 열려 도크가 하한이어도 어긋남 안내가 입력 카드를 잘라 내지 않는다', async () => {
    const app = await launchApp()
    const page = app.page
    const webDir = join(app.repoDir, 'web')
    mkdirSync(webDir, { recursive: true })
    await workspaceWithWebIssue(page, app.repoDir, webDir)

    await page.getByRole('button', { name: ISSUE, exact: true }).click()
    await page.getByRole('button', { name: '대화 시작' }).click()
    const cwd = page.getByLabel('작업 디렉토리', { exact: true })
    await expect.poll(() => cwd.inputValue(), { timeout: 5_000 }).toBe(webDir)
    await cwd.selectOption(app.repoDir)
    await page.getByRole('button', { name: 'web에서 시작' }).waitFor({ state: 'visible', timeout: 5_000 })

    const card = await page.locator('.composer-card').boundingBox()
    const dock = await page.locator('.dock-main').boundingBox()
    expect(card!.y + card!.height).toBeLessThanOrEqual(dock!.y + dock!.height)
  })
})
