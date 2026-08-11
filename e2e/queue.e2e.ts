import { describe, it, expect } from 'vitest'
import { launchApp } from './driver'

const FIRST = '첫째 지시'
const SECOND = '둘째 지시'

describe('동시 실행 상한', () => {
  it('상한이 1이면 두 번째 실행이 대기했다가 앞이 끝나면 시작한다', async () => {
    const app = await launchApp()
    const page = app.page

    // 1. workspace와 repo를 만든다 — repo가 없으면 실행 버튼이 비활성이다
    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-queue')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const wsButton = page.getByRole('button', { name: 'e2e-queue' })
    await wsButton.waitFor({ state: 'visible', timeout: 10_000 })
    await wsButton.click()

    await page.getByPlaceholder('repo 이름').fill('샘플')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가' }).click()
    await page.getByRole('button', { name: '샘플 맥락에 담기' })
      .waitFor({ state: 'visible', timeout: 10_000 })

    // 2. 상한을 1로 낮춘다. app_setting을 직접 건드리지 않고 UI를 거쳐야
    //    조절 화면과 저장 경로까지 같은 테스트가 덮는다.
    const slots = page.getByRole('button', { name: '실행 슬롯' })
    await slots.waitFor({ state: 'visible', timeout: 10_000 })
    await slots.click()
    const limitInput = page.getByLabel('동시 실행 상한')
    await limitInput.fill('1')
    await limitInput.press('Enter')
    await slots.getByText('실행 중 0/1').waitFor({ state: 'visible', timeout: 5_000 })

    // 3. 두 번 연달아 실행한다. 가짜 CLI가 1500ms 지연되므로 관찰할 창이 있다.
    await page.getByPlaceholder(/무엇을 시킬지/).fill(FIRST)
    await page.getByRole('button', { name: '▶ 실행' }).click()

    const runningTab = page.getByRole('button', { name: new RegExp(`running.*${FIRST}`) })
    await runningTab.waitFor({ state: 'visible', timeout: 10_000 })

    await page.getByRole('button', { name: '+ 새 실행' }).click()
    await page.getByPlaceholder(/무엇을 시킬지/).fill(SECOND)
    await page.getByRole('button', { name: '▶ 실행' }).click()

    // 4. 두 번째는 대기한다 — 상한이 1이므로 슬롯이 없다
    const pendingTab = page.getByRole('button', { name: new RegExp(`pending.*${SECOND}`) })
    await pendingTab.waitFor({ state: 'visible', timeout: 5_000 })
    await page.getByText('대기 1').waitFor({ state: 'visible', timeout: 5_000 })
    expect(await slots.textContent()).toContain('1/1')

    // 5. 앞이 끝나면 뒤가 시작해서 끝난다
    await page.getByRole('button', { name: new RegExp(`succeeded.*${FIRST}`) })
      .waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByRole('button', { name: new RegExp(`succeeded.*${SECOND}`) })
      .waitFor({ state: 'visible', timeout: 20_000 })
    expect(await slots.textContent()).toContain('0/1')
  })
})
