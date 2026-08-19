import { describe, it, expect } from 'vitest'
import { launchApp } from './driver'

describe('대화', () => {
  it('한 세션에서 세 턴을 주고받고 인박스에는 한 줄만 남는다', async () => {
    // launchApp()이 onTestFinished로 정리를 스스로 예약하므로 이 테스트는 앱을 직접
    // 닫지 않는다. ONE_DESK_FAKE_DELAY_MS로 가짜 CLI를 늦춰, 1턴이 도는 동안 2턴을
    // 쳐 넣을 시간을 만든다 — driver.ts의 기본값도 1500ms라 사실상 같은 값이지만,
    // 이 채널 자체(launchApp의 env 통로)가 이번 태스크에서 새로 낸 것이다.
    const app = await launchApp({ env: { ONE_DESK_FAKE_DELAY_MS: '1500' } })
    const page = app.page

    // workspace와 repo 준비 — core-loop.e2e.ts의 1~2단계와 같다.
    await page.getByPlaceholder('새 workspace 이름…').fill('conv-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const wsButton = page.getByRole('button', { name: 'conv-ws' })
    await wsButton.waitFor({ state: 'visible', timeout: 10_000 })
    await wsButton.click()

    await page.getByPlaceholder('repo 이름').fill('샘플')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가' }).click()
    await page.getByRole('button', { name: '샘플 맥락에 담기' })
      .waitFor({ state: 'visible', timeout: 10_000 })

    const prompt = page.getByRole('textbox', { name: '지시' })
    // run-start 버튼의 접근성 이름은 정확히 "실행"뿐이다. exact 없이 substring으로
    // 잡으면 도크 토글("▾ 실행")과 슬롯 표시기("실행 슬롯" aria-label)까지 걸려
    // strict mode 위반이 된다(실측) — 그래서 exact: true가 필수다.
    const send = page.getByRole('button', { name: '실행', exact: true })
    // 대화록의 사용자 지시 줄로 범위를 좁힌다. 도크 탭도 첫 턴의 제목을 항상 그리고
    // 있어서(Dock의 conversations 목록은 selected와 별개다) page.getByText(prompt)만
    // 쓰면 그 탭에도 걸려버린다 — 실측: 새 대화(view='new')에서 첫 턴을 시작하면
    // Dock의 view/pickedId 전환(동기, onStarted 콜백)과 runs 목록 갱신(비동기, IPC
    // push인 onRunUpdate)이 서로 다른 경로로 오기 때문에 도크 탭이 먼저 보이고 그
    // 뒤에야 ConversationPanel이 'new'에서 실제 대화로 다시 마운트되는 순간이 있다.
    // 탭 텍스트로 "떴다"고 판단하고 바로 다음 입력을 채우면, 곧 사라질 옛 RunPanel
    // 인스턴스에 채워 넣어 버려 전송이 빈 프롬프트로 막힌다(실측: 실행 버튼이 계속
    // disabled로 남아 클릭이 30초 타임아웃). 대화록 쪽 텍스트로 기다리면 그 재마운트가
    // 끝난 뒤의 안정된 인스턴스를 보장한다.
    const turnPrompt = (text: string) => page.locator('.turn-user').filter({ hasText: text })

    // 1턴
    await prompt.fill('첫 지시')
    await send.click()
    await turnPrompt('첫 지시').waitFor({ state: 'visible', timeout: 5_000 })

    // 2턴 — 1턴이 도는 중에 보낸다. 대화당 예약은 하나뿐이라(설계 §3-2) 예약 버블이
    // 생기고 전송이 잠긴다. RunQueue의 groupKey가 같은 대화의 두 턴을 동시에 띄우지
    // 않으므로, 전체 동시 실행 상한과 무관하게 항상 대기 상태를 관찰할 수 있다.
    //
    // "대기 중"이 뜬 뒤에야 확인하는 게 아니라, 클릭 직후 바로 waitFor를 걸어
    // Playwright의 자동 대기(폴링)에 맡긴다 — 고정 sleep 뒤에 스냅샷을 찍으면
    // 이미 다음 상태로 넘어간 순간을 놓칠 수 있지만, waitFor는 나타나는 즉시 잡는다.
    await prompt.fill('둘째 지시')
    await send.click()
    await page.getByText('대기 중').waitFor({ state: 'visible', timeout: 3_000 })
    // vitest의 expect에는 Playwright의 toBeDisabled 매처가 없다(playwright-core만
    // 쓰고 @playwright/test는 의존성에 없다) — expect.poll로 같은 재시도 의미를 살린다.
    await expect.poll(() => send.isDisabled(), { timeout: 3_000 }).toBe(true)

    // 1턴이 끝나면 2턴이 자동으로 뜬다 — 이 계획 전체의 핵심 약속이다.
    await page.getByText('대기 중').waitFor({ state: 'hidden', timeout: 20_000 })

    // 3턴. 전송 성공 직후 RunPanel이 프롬프트를 비우므로(위 1·2턴에서도 마찬가지),
    // 빈 프롬프트에서는 disabled가 "예약 중이라 잠김"과 "쓸 지시가 없어 원래
    // 비활성" 두 이유가 겹쳐 구분이 안 된다 — 프롬프트를 먼저 채운 뒤에야
    // "예약 잠금이 실제로 풀렸는지"를 의미 있게 확인할 수 있다.
    await prompt.fill('셋째 지시')
    await expect.poll(() => send.isDisabled(), { timeout: 20_000 }).toBe(false)
    await send.click()
    await turnPrompt('셋째 지시').waitFor({ state: 'visible', timeout: 5_000 })

    // 대화록에 턴이 셋, 도크 탭은 하나다 — 세 턴이 별개의 대화로 흩어지지 않았다.
    await expect.poll(() => page.locator('.turn').count(), { timeout: 20_000 }).toBe(3)
    expect(await page.getByRole('button', { name: /첫 지시/ }).count()).toBe(1)

    // 인박스에는 대화가 한 줄이다 — 여기서부터만 화면을 벗어난다. 위 1~5번은
    // 인박스로 갔다 오지 않고 확인했다: 다른 화면에 갔다 오면 도크가 재마운트돼
    // 구독이 죽어 있어도 통과해 버린다(mcp.e2e.ts와 같은 이유).
    const inboxLink = page.getByRole('navigation').getByRole('button', { name: /인박스/ })
    await inboxLink.click()
    // 3턴이 아직 끝나지 않았을 수 있다 — 마지막 턴이 succeeded 등 종결 상태가 될
    // 때까지는 인박스 조회(core의 inbox())가 이 대화를 돌려주지 않는다. onInboxUpdate
    // push가 3턴 종료 뒤 목록을 다시 읽게 하므로, 넉넉한 타임아웃의 poll로 기다린다.
    await expect.poll(() => page.locator('.inbox-list > li').count(), { timeout: 20_000 }).toBe(1)

    // 확인하면 내려간다.
    await page.getByRole('button', { name: '확인함' }).click()
    await expect.poll(() => page.locator('.inbox-list > li').count(), { timeout: 5_000 }).toBe(0)
  })
})
