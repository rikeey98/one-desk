import { describe, it, expect } from 'vitest'
import { launchApp } from './driver'

const ISSUE = '회원 탈퇴 플로우 문의'

describe('이슈 훑기', () => {
  it('던지고 훑으면 해당 그룹에 나타난다', async () => {
    // 여기서 try/finally { await app.close() }로 직접 닫지 않는다. smoke.e2e.ts와
    // 같은 이유다 — launchApp()이 onTestFinished로 정리를 스스로 예약하므로
    // 테스트는 아무것도 닫지 않는다.
    const app = await launchApp()
    const page = app.page

    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-triage')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: /^e2e-triage$/ })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    // 던질 땐 제목만이다
    await page.getByPlaceholder('새 이슈 제목…').fill(ISSUE)
    await page.getByPlaceholder('새 이슈 제목…').press('Enter')

    const banner = page.getByText('⚠ 정리 안 됨 (1)')
    await banner.waitFor({ state: 'visible', timeout: 10_000 })

    // 훑기는 상세 자리를 빌려 쓴다 — 패널이 확장되면서 카드가 뜬다
    await page.getByRole('button', { name: '훑어보기', exact: true }).click()
    const next = page.getByRole('button', { name: '다음', exact: true })
    await next.waitFor({ state: 'visible', timeout: 5_000 })

    // 축이 덜 찍힌 동안은 막혀 있다
    expect(await next.isDisabled()).toBe(true)

    await page.getByRole('button', { name: '회의', exact: true }).click()
    await page.getByRole('button', { name: '조사', exact: true }).click()
    await page.getByRole('button', { name: '이번주', exact: true }).click()
    expect(await next.isDisabled()).toBe(false)
    await next.click()

    // 대기열이 비면 배너가 사라진다 — 0건을 그리지 않는다
    await banner.waitFor({ state: 'detached', timeout: 5_000 })

    // 그리고 그 이슈가 '이번주' 그룹 안에 있다
    const group = page.getByRole('button', { name: /이번주 \(1\)/ })
    await group.waitFor({ state: 'visible', timeout: 5_000 })

    // 축을 바꾸면 다시 묶인다 — App.tsx가 repos를 안 내려보내면 여기서 깨진다
    await page.getByLabel('묶기').selectOption('kind')
    await page.getByRole('button', { name: /조사 \(1\)/ })
      .waitFor({ state: 'visible', timeout: 5_000 })
  })
})
