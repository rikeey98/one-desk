import { describe, it, expect } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { launchApp } from './driver'
import { waitConvStatus } from './dock'

async function addRepo(page: Page, name: string, path: string) {
  await page.getByRole('button', { name: 'repo 등록' }).click()
  await page.getByPlaceholder('repo 이름').fill(name)
  await page.getByPlaceholder('/절대/경로').fill(path)
  await page.getByRole('button', { name: '추가' }).click()
  await page.getByRole('button', { name: `${name} repo` }).waitFor({ state: 'visible', timeout: 10_000 })
}

const titles = (page: Page) => page.locator('.dock-conv-list .dock-section-name, .dock-conv-list .dock-conv-title').allTextContents()

/**
 * 도크 목록의 repo 구획과 사이드바 거름 (`docs/sdlc/dock-repo-sections/`). 대화의 repo는 실제로 돈 run의 `cwd`에서 오므로,
 * 사이드바에서 repo를 고르고 새 대화를 보내면 그 repo의 구획에 들어가는지까지 실제 앱으로 본다.
 */
describe('도크 repo 구획', () => {
  it('repo마다 대화를 나누고, 사이드바에서 고르면 그 repo만, 풀면 다시 구획으로', async () => {
    const app = await launchApp()
    const page = app.page
    const webDir = join(app.repoDir, 'web')
    mkdirSync(webDir, { recursive: true })

    await page.getByPlaceholder('새 workspace 이름…').fill('repo-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    await page.getByRole('button', { name: 'repo-ws', exact: true }).click()
    await addRepo(page, 'api', app.repoDir)
    await addRepo(page, 'web', webDir)

    const prompt = page.getByRole('textbox', { name: '지시' })
    const send = page.getByRole('button', { name: '실행', exact: true })

    // api를 고르고 보낸다 — 새 대화의 작업 디렉토리는 사이드바의 repo다
    await page.getByRole('button', { name: 'api repo' }).click()
    await page.getByRole('status').filter({ hasText: 'api 대화만' }).waitFor({ state: 'visible', timeout: 5_000 })
    await prompt.fill('api에서 한 일')
    await send.click()
    await waitConvStatus(page, null, ['succeeded', 'failed'])

    await page.getByRole('button', { name: 'web repo' }).click()
    await page.getByText('web에서 나눈 대화가 없습니다').waitFor({ state: 'visible', timeout: 5_000 })
    await page.getByRole('button', { name: '새 대화', exact: true }).click()
    await prompt.fill('web에서 한 일')
    await send.click()
    await page.locator('.dock-conv-title').filter({ hasText: 'web에서 한 일' }).waitFor({ state: 'visible', timeout: 10_000 })
    expect(await titles(page)).toEqual(['web에서 한 일'])

    // 거름을 풀면 구획 둘 — 최근 활동순이라 web이 위다
    await page.getByRole('button', { name: 'repo 거름 풀기' }).click()
    await page.getByRole('button', { name: 'web 대화 묶음' }).waitFor({ state: 'visible', timeout: 5_000 })
    expect(await titles(page)).toEqual(['web', 'web에서 한 일', 'api', 'api에서 한 일'])
    expect(await page.getByRole('button', { name: 'api repo' }).getAttribute('class')).not.toContain('repo-card-selected')

    // 구획을 접으면 줄이 숨는다
    await page.getByRole('button', { name: 'api 대화 묶음' }).click()
    expect(await titles(page)).toEqual(['web', 'web에서 한 일', 'api'])
  })
})
