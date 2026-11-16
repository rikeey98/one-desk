import { describe, it, expect } from 'vitest'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchApp, type AppSession } from './driver'
import { waitConvStatus } from './dock'

/**
 * 답을 낸 뒤 백그라운드 작업을 기다리는 턴 (docs/sdlc/background-wait/).
 *
 * claude -p는 `run_in_background`로 띄운 작업이 끝날 때까지 프로세스를 끝내지 않는다 — 답은 와 있는데
 * run은 실행 중이다. 가짜 CLI의 `background` 시나리오가 실측한 줄 순서를 흘리고, 이 파일은 그동안 상태
 * 줄이 이유를 말하는지, 작업이 끝나면 턴이 끝나고 마지막 답이 서는지를 빌드된 앱에서 본다.
 */

const ARTIFACTS = join(dirname(fileURLToPath(import.meta.url)), 'artifacts')
const PROMPT = 'dev 서버를 띄워줘'

async function prepare(app: AppSession, workspace: string): Promise<void> {
  const { page } = app
  await page.getByPlaceholder('새 workspace 이름…').fill(workspace)
  await page.getByPlaceholder('새 workspace 이름…').press('Enter')
  const ws = page.getByRole('button', { name: workspace, exact: true })
  await ws.waitFor({ state: 'visible', timeout: 10_000 })
  await ws.click()
  await page.getByRole('button', { name: 'repo 등록' }).click()
  await page.getByPlaceholder('repo 이름').fill('샘플')
  await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
  await page.getByRole('button', { name: '추가', exact: true }).click()
  await page.getByRole('button', { name: '샘플 맥락에 담기' }).waitFor({ state: 'visible', timeout: 10_000 })
}

describe('백그라운드 작업을 기다리는 턴', () => {
  it('답이 온 뒤에도 실행 중인 이유를 상태 줄이 말하고, 작업이 끝나면 턴이 끝난다', async () => {
    const app = await launchApp({ env: { ONE_DESK_FAKE_SCRIPT: 'background', ONE_DESK_FAKE_BG_MS: '6000' } })
    try {
      const { page } = app
      await prepare(app, 'bg-wait')
      await page.getByRole('textbox', { name: '지시' }).fill(PROMPT)
      await page.getByRole('button', { name: '실행', exact: true }).click()
      const turn = page.locator('.turn').filter({ has: page.locator('.turn-user', { hasText: PROMPT }) })

      // 답은 이미 와 있고, 상태 줄이 왜 아직 도는지 말한다
      const status = turn.locator('.turn-status')
      await expect.poll(() => status.textContent(), { timeout: 10_000 }).toContain('답 도착 · 기다리는 중')
      expect(await status.locator('.turn-status-tool').textContent()).toBe('백그라운드 작업 1개 실행 중 · dev 서버 띄우기')
      expect(await turn.locator('.turn-answer').textContent()).toContain('dev 서버를 띄웠습니다.')
      expect(await status.getByRole('button', { name: '실행 중인 턴 멈추기' }).isVisible()).toBe(true)
      mkdirSync(ARTIFACTS, { recursive: true })
      await page.screenshot({ path: join(ARTIFACTS, 'background-wait.png') })
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(ARTIFACTS, 'background-wait-dark.png') })
      await page.emulateMedia({ colorScheme: 'light' })

      // 작업이 끝나면 한 턴이 더 돌고 끝난다 — 마지막 답이 선다
      await waitConvStatus(page, null, 'succeeded', 30_000)
      expect(await turn.locator('.turn-status').count()).toBe(0)
      expect(await turn.locator('.turn-answer').textContent()).toContain('dev 서버가 종료 코드 0으로 끝났습니다.')

      // 펼치면 시작과 끝의 공지선과 첫 답이 제자리에 있다
      await turn.getByRole('button', { name: '자세히' }).click()
      const notices = turn.locator('.tl-notice-line')
      await expect.poll(() => notices.allTextContents(), { timeout: 10_000 })
        .toEqual(['백그라운드 작업 1개 실행 중 · dev 서버 띄우기', '백그라운드 작업이 끝났습니다'])
      expect(await turn.locator('.tl-text').allTextContents()).toEqual(['dev 서버를 띄웠습니다.'])
      await page.screenshot({ path: join(ARTIFACTS, 'background-wait-done.png') })
    } finally {
      await app.close()
    }
  })
})
