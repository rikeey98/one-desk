import { describe, it, expect } from 'vitest'
import { launchApp } from './driver'

const PROMPT = '인박스 확인용 지시'

describe('결과 인박스', () => {
  it('끝난 run이 인박스에 뜨고 확인함을 누르면 사라진다', async () => {
    const app = await launchApp()
    const page = app.page

    // 1. workspace와 repo를 만든다 — repo가 없으면 실행 버튼이 비활성이다
    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-inbox')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const wsButton = page.getByRole('button', { name: /e2e-inbox/ })
    await wsButton.waitFor({ state: 'visible', timeout: 10_000 })
    await wsButton.click()

    await page.getByPlaceholder('repo 이름').fill('샘플')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가' }).click()
    await page.getByRole('button', { name: '샘플 맥락에 담기' })
      .waitFor({ state: 'visible', timeout: 10_000 })

    // 2. 실행하고 끝나기를 기다린다
    await page.getByPlaceholder(/무엇을 시킬지/).fill(PROMPT)
    await page.getByRole('button', { name: '▶ 실행' }).click()
    await page.getByRole('button', { name: new RegExp(`succeeded.*${PROMPT}`) })
      .waitFor({ state: 'visible', timeout: 20_000 })

    // 3. 사이드바 배지가 붙는다 — 아직 아무것도 확인하지 않았다
    // 브리프의 page.getByRole('button', { name: /인박스/ })는 그대로 두 요소에 걸린다:
    // 사이드바의 인박스 링크와, PROMPT 자체에 "인박스"라는 글자가 들어 있어 방금 끝난
    // run의 Dock 탭 버튼("succeeded 인박스 확인용 지시")도 같은 정규식에 걸려
    // strict mode violation으로 던진다(실측). 사이드바는 <nav>가 이 화면에 하나뿐이라
    // 그 landmark로 스코프를 좁혀 사이드바의 인박스 링크만 가리키게 한다.
    const inboxLink = page.getByRole('navigation').getByRole('button', { name: /인박스/ })
    await inboxLink.getByText('1').waitFor({ state: 'visible', timeout: 10_000 })

    // 4. 인박스에 그 run이 있다
    await inboxLink.click()
    // 이 항목(li.inbox-item) 안으로 스코프한다. 사이드바의 workspace 버튼도 "e2e-inbox"를
    // 항상 그리고 있어서(1단계부터 떠 있다), 스코프 없이 page.getByText('e2e-inbox')를
    // 쓰면 InboxPanel이 workspace 이름을 아예 안 그려도(예: 늘 "(사라진 workspace)") 사이드바
    // 쪽에 걸려 조용히 통과해버린다(실측 — 리뷰에서 지적됨). PROMPT로 항목을 특정한 뒤 그
    // 안에서만 "전역 목록이라 어느 workspace 것인지가 함께 보여야 한다"를 확인한다.
    const inboxItem = page.locator('.inbox-item').filter({ hasText: PROMPT })
    await inboxItem.waitFor({ state: 'visible', timeout: 5_000 })
    await inboxItem.getByText('e2e-inbox').waitFor({ state: 'visible', timeout: 5_000 })

    // 5. 확인함을 누르면 목록과 배지에서 함께 사라진다
    await page.getByRole('button', { name: '확인함' }).click()
    await page.getByText('처리할 결과가 없습니다').waitFor({ state: 'visible', timeout: 10_000 })
    expect(await inboxLink.textContent()).not.toContain('1')
  })
})
