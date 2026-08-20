import { describe, it, expect } from 'vitest'
import { launchApp } from './driver'

const ISSUE = '토큰 만료 버그'
const BODY = '재현: 로그인 후 24시간 대기'

describe('이슈 본문', () => {
  it('본문을 쓰고 접었다 열면 그대로 있다', async () => {
    const app = await launchApp()
    const page = app.page

    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-body')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: /^e2e-body$/ })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    await page.getByPlaceholder('새 이슈 제목…').fill(ISSUE)
    await page.getByPlaceholder('새 이슈 제목…').press('Enter')
    const title = page.getByRole('button', { name: ISSUE, exact: true })
    await title.waitFor({ state: 'visible', timeout: 10_000 })

    // 클릭은 여는 동작이다 — 맥락에 담기지 않는다
    await title.click()
    const body = page.getByLabel('본문')
    await body.waitFor({ state: 'visible', timeout: 5_000 })

    // 상태도 목록이 아니라 상세에서 고친다 (설계 §9). 이 쓰기가 잠긴 경로로 나가지
    // 않으면 기대값이 낡아, 바로 아래 본문 저장이 유령 충돌로 거부된다 — 그러면
    // 다시 열었을 때 본문이 비어 이 테스트가 빨개진다.
    await page.getByLabel('상태').selectOption('doing')
    await body.fill(BODY)

    // 접으면 대기 중인 저장이 flush된다
    await page.keyboard.press('Escape')
    await body.waitFor({ state: 'detached', timeout: 5_000 })

    await title.click()
    // vitest의 expect에는 Playwright의 toHaveValue 매처가 없다(playwright-core만 쓰고
    // @playwright/test는 의존성에 없다) — expect.poll로 같은 재시도 의미를 살린다.
    await expect.poll(() => page.getByLabel('본문').inputValue(), { timeout: 5_000 }).toBe(BODY)
    await expect.poll(() => page.getByLabel('상태').inputValue(), { timeout: 5_000 }).toBe('doing')
  })

  it('담기 토글만 맥락 칩을 만든다', async () => {
    const app = await launchApp()
    const page = app.page

    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-pick')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: /^e2e-pick$/ })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    await page.getByPlaceholder('새 이슈 제목…').fill(ISSUE)
    await page.getByPlaceholder('새 이슈 제목…').press('Enter')
    const title = page.getByRole('button', { name: ISSUE, exact: true })
    await title.waitFor({ state: 'visible', timeout: 10_000 })

    await title.click()
    // 제목을 눌러도 도크에 칩이 생기지 않는다
    expect(await page.getByRole('button', { name: new RegExp(`${ISSUE}.*✕`) }).count()).toBe(0)

    await page.getByRole('button', { name: `${ISSUE} 맥락에 담기` }).click()
    await page.getByRole('button', { name: new RegExp(`${ISSUE}.*✕`) })
      .waitFor({ state: 'visible', timeout: 5_000 })
  })
})
