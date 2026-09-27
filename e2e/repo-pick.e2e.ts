import { describe, it, expect } from 'vitest'
import { basename } from 'node:path'
import { launchApp } from './driver'

describe('repo 폴더 선택', () => {
  it('대화상자에서 고른 폴더로 repo가 등록된다', async () => {
    const app = await launchApp()
    const { page } = app

    // 네이티브 대화상자는 Playwright가 누를 수 없다 — main의 dialog만 바꿔 세우고,
    // 버튼 → preload → ipcMain.handle → 폼까지의 왕복은 진짜로 탄다.
    await app.electron.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [picked] })) as typeof dialog.showOpenDialog
    }, app.repoDir)

    await page.getByPlaceholder('새 workspace 이름…').fill('pick-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: 'pick-ws', exact: true })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    await page.getByRole('button', { name: 'repo 등록' }).click()
    await page.getByRole('button', { name: '폴더 선택' }).click()
    await expect.poll(() => page.getByPlaceholder('/절대/경로').inputValue()).toBe(app.repoDir)
    const name = basename(app.repoDir)
    expect(await page.getByPlaceholder('repo 이름').inputValue()).toBe(name)

    await page.getByRole('button', { name: '추가' }).click()
    await page.getByRole('button', { name: `${name} repo` }).waitFor({ state: 'visible', timeout: 10_000 })
  })
})
