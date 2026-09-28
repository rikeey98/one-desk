import { describe, it, expect } from 'vitest'
import { join, resolve } from 'node:path'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { launchApp } from './driver'
import { waitConvStatus } from './dock'

/**
 * 요금제 사용률의 한 바퀴 (`docs/sdlc/plan-usage/`). 가짜 CLI의 `rate_limit_event` → 어댑터
 * `parsePlanUsage` → manager `onPlanUsage` → core → `event:planUsage` → preload → 사이드바.
 * 채널 이름·preload 한 줄은 이 테스트만 고정한다 — 단위 테스트는 가짜 client로 돈다.
 */
describe('요금제 사용률', () => {
  it('claude 실행이 사용률을 내면 사이드바에 보이고, 로그에는 남지 않는다', async () => {
    const app = await launchApp({ env: { ONE_DESK_FAKE_PLAN_USAGE: '0.42' } })
    const { page } = app

    await page.getByPlaceholder('새 workspace 이름…').fill('plan-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    await page.getByRole('button', { name: 'plan-ws', exact: true }).click()
    await page.getByRole('button', { name: 'repo 등록' }).click()
    await page.getByPlaceholder('repo 이름').fill('plan-repo')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가', exact: true }).click()
    await page.getByRole('button', { name: 'plan-repo repo' }).waitFor({ timeout: 10_000 })

    // 실행 전에는 줄이 없다 — 0%로 채우지 않는다.
    expect(await page.getByText(/^요금제 /).count()).toBe(0)

    await page.getByRole('textbox', { name: '지시', exact: true }).fill('안녕')
    await page.getByRole('button', { name: '실행', exact: true }).click()
    await waitConvStatus(page, null, 'succeeded', 30_000)

    const row = page.getByText('요금제 5h 42% · 7d 2%', { exact: true })
    await row.waitFor({ timeout: 10_000 })
    expect(await row.getAttribute('title')).toContain('마지막 확인')
    const artifacts = resolve('e2e/artifacts')
    mkdirSync(artifacts, { recursive: true })
    await page.locator('nav.sidebar').screenshot({ path: join(artifacts, 'plan-usage-sidebar.png') })

    // 저장하지 않는다 — 정규화 로그에도 원본 줄 로그에도 없다(FR-1).
    const logs = join(app.dataDir, 'logs')
    for (const run of readdirSync(logs)) {
      for (const file of readdirSync(join(logs, run))) {
        const text = readFileSync(join(logs, run, file), 'utf8')
        expect(text).not.toContain('rate_limit')
        expect(text).not.toContain('utilization')
      }
    }
  })
})
