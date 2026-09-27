import { describe, it, expect } from 'vitest'
import { launchApp } from './driver'
import { waitConvStatus } from './dock'

const PROMPT = '인박스 확인용 지시'

describe('결과 인박스', () => {
  it('끝난 run이 인박스에 뜨고 확인함을 누르면 사라진다', async () => {
    const app = await launchApp()
    const page = app.page

    // 1. workspace와 repo를 만든다 — repo가 없으면 실행 버튼이 비활성이다
    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-inbox')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const wsButton = page.getByRole('button', { name: /^e2e-inbox$/ })
    await wsButton.waitFor({ state: 'visible', timeout: 10_000 })
    await wsButton.click()

    await page.getByRole('button', { name: 'repo 등록' }).click()
    await page.getByPlaceholder('repo 이름').fill('샘플')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가' }).click()
    await page.getByRole('button', { name: '샘플 맥락에 담기' })
      .waitFor({ state: 'visible', timeout: 10_000 })

    // 2. 실행하고 끝나기를 기다린다
    // run-start 버튼의 접근성 이름은 정확히 "실행"뿐이다. exact 없이 substring으로
    // 잡으면 슬롯 표시기("실행 슬롯")·멈추기("이 대화의 실행 멈추기") 같은 aria-label까지 걸려
    // strict mode 위반이 된다(실측).
    await page.getByPlaceholder(/무엇을 시킬지/).fill(PROMPT)
    await page.getByRole('button', { name: '실행', exact: true }).click()
    await waitConvStatus(page, PROMPT, 'succeeded')

    // 3. **배지는 붙지 않는다.** 완료·미확인은 "지금 손이 필요한 것"이 아니므로
    //    빨간 숫자를 올리지 않는다(conversation-lifecycle FR-4). 예전에는 여기서
    //    '1'을 기다렸고, 그래서 대화 수만큼 숫자가 단조 증가했다 — 그것이 이 변경이
    //    고친 증상이다. 목록에는 여전히 남는다(아래 4단계).
    //
    // 브리프의 page.getByRole('button', { name: /인박스/ })는 그대로 두 요소에 걸린다:
    // 사이드바의 인박스 링크와, PROMPT 자체에 "인박스"라는 글자가 들어 있어 방금 끝난
    // run의 도크 줄 버튼("succeeded 인박스 확인용 지시")도 같은 정규식에 걸려
    // strict mode violation으로 던진다(실측). 사이드바는 <nav>가 이 화면에 하나뿐이라
    // 그 landmark로 스코프를 좁혀 사이드바의 인박스 링크만 가리키게 한다.
    const inboxLink = page.getByRole('navigation').getByRole('button', { name: /인박스/ })
    expect(await inboxLink.locator('.badge').count()).toBe(0)

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

    // 5. 확인함을 누르면 목록에서 사라진다
    await page.getByRole('button', { name: '확인함' }).click()
    await page.getByText('처리할 결과가 없습니다').waitFor({ state: 'visible', timeout: 10_000 })
    expect(await inboxLink.locator('.badge').count()).toBe(0)
  })

  /**
   * **본 대화는 저절로 확인된다** (conversation-lifecycle FR-5).
   *
   * 이 기능이 고치려던 증상이 바로 "인박스에 가서 확인함을 눌러야만 내려간다"였다.
   * 여기서는 인박스 화면에 **가지 않고** 도크 목록에서 대화를 열기만 한다.
   *
   * e2e로 검증할 수 있는 것은 driver가 `ONE_DESK_AGENT_LAUNCHER`로 node를 물려
   * 가짜 CLI가 **양쪽 플랫폼에서 똑같이 성공**하기 때문이다(단위 테스트의
   * `ONE_DESK_AGENT_PATH`만 쓰는 경로와 다르다 — 그쪽은 Windows에서 spawn이 실패해
   * run이 failed로 끝난다).
   */
  it('완료된 대화를 도크에서 열면 인박스에서 저절로 내려간다', async () => {
    const app = await launchApp()
    const page = app.page

    await page.getByPlaceholder('새 workspace 이름…').fill('seen-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const wsButton = page.getByRole('button', { name: /^seen-ws$/ })
    await wsButton.waitFor({ state: 'visible', timeout: 10_000 })
    await wsButton.click()

    await page.getByRole('button', { name: 'repo 등록' }).click()
    await page.getByPlaceholder('repo 이름').fill('샘플')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가' }).click()
    await page.getByRole('button', { name: '샘플 맥락에 담기' })
      .waitFor({ state: 'visible', timeout: 10_000 })

    await page.getByPlaceholder(/무엇을 시킬지/).fill('저절로 내려갈 대화')
    await page.getByRole('button', { name: '실행', exact: true }).click()
    await page.locator('.dock-conv .status-succeeded')
      .waitFor({ state: 'visible', timeout: 20_000 })

    // 인박스 목록에 올라와 있다 — 아직 아무것도 확인하지 않았다.
    const inboxLink = page.getByRole('navigation').getByRole('button', { name: /인박스/ })
    await inboxLink.click()
    await expect.poll(() => page.locator('.inbox-list > li').count(), { timeout: 10_000 }).toBe(1)

    // workspace로 돌아가 **도크 목록에서 그 대화를 누른다.** 인박스의 "확인함"을
    // 누르지 않는다.
    await wsButton.click()
    await page.locator('.dock-conv-title', { hasText: '저절로 내려갈 대화' }).click()

    await inboxLink.click()
    await page.getByText('처리할 결과가 없습니다').waitFor({ state: 'visible', timeout: 10_000 })
  })
})
