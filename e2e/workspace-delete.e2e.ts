import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp } from './driver'
import { waitConvStatus } from './dock'
import { clickRowAction } from './rowAction'

const WORKSPACE = 'e2e-지울-곳'
const PROMPT = '파일 목록 알려줘'

describe('workspace 삭제', () => {
  it('화면에서 지우면 그 workspace의 run 로그 폴더도 사라진다', async () => {
    const app = await launchApp()
    const page = app.page
    const logRuns = () => readdirSync(join(app.dataDir, 'logs'))

    await page.getByPlaceholder('새 workspace 이름…').fill(WORKSPACE)
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const workspaceButton = page.getByRole('button', { name: WORKSPACE, exact: true })
    await workspaceButton.waitFor({ state: 'visible', timeout: 10_000 })
    await workspaceButton.click()

    await page.getByRole('button', { name: 'repo 등록' }).click()
    await page.getByPlaceholder('repo 이름').fill('샘플')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가' }).click()
    await page.getByRole('button', { name: '샘플 repo' }).waitFor({ state: 'visible', timeout: 10_000 })

    await page.getByRole('textbox', { name: '지시', exact: true }).fill(PROMPT)
    await page.getByRole('button', { name: '실행', exact: true }).click()
    await waitConvStatus(page, null, 'succeeded')
    expect(logRuns()).toHaveLength(1)

    await clickRowAction(page.locator('.ws-row', { hasText: WORKSPACE }), `${WORKSPACE} 삭제`)
    await page.getByLabel(`삭제하려면 ${WORKSPACE} 을 입력`).fill(WORKSPACE)
    await page.getByRole('button', { name: `${WORKSPACE} 삭제 확인` }).click()
    await workspaceButton.waitFor({ state: 'detached', timeout: 10_000 })

    await expect.poll(logRuns, { timeout: 5_000 }).toEqual([])
  })
})
