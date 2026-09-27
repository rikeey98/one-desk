import { describe, it, expect } from 'vitest'
import { launchApp } from './driver'
import { clickRowAction } from './rowAction'

describe('대화', () => {
  it('한 세션에서 세 턴을 주고받고 인박스에는 한 줄만 남는다', async () => {
    // launchApp()이 onTestFinished로 정리를 스스로 예약하므로 이 테스트는 앱을 직접
    // 닫지 않는다. ONE_DESK_FAKE_DELAY_MS로 가짜 CLI를 늦춰, 1턴이 도는 동안 2턴을
    // 쳐 넣을 시간을 만든다. driver.ts의 기본값(1500ms)보다 올려서 이 env 통로가
    // 실제로 일을 하게 한다 — 예약 관찰 창도 넓어져 느린 기계에서의 간헐 실패를 줄인다.
    const app = await launchApp({ env: { ONE_DESK_FAKE_DELAY_MS: '4000' } })
    const page = app.page

    // workspace와 repo 준비 — core-loop.e2e.ts의 1~2단계와 같다.
    await page.getByPlaceholder('새 workspace 이름…').fill('conv-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const wsButton = page.getByRole('button', { name: 'conv-ws', exact: true })
    await wsButton.waitFor({ state: 'visible', timeout: 10_000 })
    await wsButton.click()

    await page.getByRole('button', { name: 'repo 등록' }).click()
    await page.getByPlaceholder('repo 이름').fill('샘플')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가' }).click()
    const attach = page.getByRole('button', { name: '샘플 맥락에 담기' })
    await attach.waitFor({ state: 'visible', timeout: 10_000 })
    // 이 대화가 무엇을 받았는지 보여주는 줄을 함께 본다
    // (docs/sdlc/conversation-context/). 담아 두고 1턴을 보낸다.
    await attach.click()

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

    const applied = page.locator('.applied-chip')

    // 1턴
    await prompt.fill('첫 지시')
    await send.click()
    await turnPrompt('첫 지시').waitFor({ state: 'visible', timeout: 5_000 })

    // 담아 보낸 것이 대화에 남아 보인다.
    await applied.filter({ hasText: 'repo · 샘플' })
      .waitFor({ state: 'visible', timeout: 5_000 })
    // 그리고 입력부의 칩은 비었다 — 두 줄이 서로 다른 것을 말한다(설계 §4-1, FR-8).
    await page.getByText('왼쪽 항목의 ＋를 눌러 맥락을 담으세요')
      .waitFor({ state: 'visible', timeout: 5_000 })

    // 2턴 — 1턴이 도는 중에 보낸다. 대화당 예약은 하나뿐이라(설계 §3-2) 예약 버블이
    // 생기고 전송이 잠긴다. RunQueue의 groupKey가 같은 대화의 두 턴을 동시에 띄우지
    // 않으므로, 전체 동시 실행 상한과 무관하게 항상 대기 상태를 관찰할 수 있다.
    //
    // "대기 중"이 뜬 뒤에야 확인하는 게 아니라, 클릭 직후 바로 waitFor를 걸어
    // Playwright의 자동 대기(폴링)에 맡긴다 — 고정 sleep 뒤에 스냅샷을 찍으면
    // 이미 다음 상태로 넘어간 순간을 놓칠 수 있지만, waitFor는 나타나는 즉시 잡는다.
    await prompt.fill('둘째 지시')
    await send.click()
    await page.getByText('대기 중').waitFor({ state: 'visible', timeout: 5_000 })

    // 전송 성공 직후 RunPanel이 프롬프트를 비운다(RunPanel.tsx:137) — 그래서 빈
    // 프롬프트에서 disabled를 확인하면 "예약 중이라 잠김"과 "쓸 지시가 없어 원래
    // 비활성" 두 이유가 겹쳐 공허해진다(ready는 prompt.trim() !== ''도 요구한다,
    // RunPanel.tsx:112-113). 3턴 프롬프트를 미리 채워 그 혼입을 없앤 뒤에야 아래
    // disabled 단언이 reserved만을 가리킨다 — 이렇게 안 하면 RunPanel.tsx:113의
    // `&& !reserved`를 통째로 지워도 이 시나리오가 끝까지 초록이다(실측, 아래
    // "대화당 예약은 하나" 검증).
    await prompt.fill('셋째 지시')
    // vitest의 expect에는 Playwright의 toBeDisabled 매처가 없다(playwright-core만
    // 쓰고 @playwright/test는 의존성에 없다) — expect.poll로 같은 재시도 의미를 살린다.
    await expect.poll(() => send.isDisabled(), { timeout: 5_000 }).toBe(true)

    // 1턴이 끝나면 2턴이 자동으로 뜬다 — 이 계획 전체의 핵심 약속이다.
    await page.getByText('대기 중').waitFor({ state: 'hidden', timeout: 20_000 })
    await expect.poll(() => send.isDisabled(), { timeout: 20_000 }).toBe(false)

    // 3턴 — 프롬프트는 이미 채워져 있다.
    await send.click()
    await turnPrompt('셋째 지시').waitFor({ state: 'visible', timeout: 5_000 })

    // 대화록에 턴이 셋, 도크 탭은 하나다 — 세 턴이 별개의 대화로 흩어지지 않았다.
    await expect.poll(() => page.locator('.turn').count(), { timeout: 20_000 }).toBe(3)

    // 그 턴이 무엇으로 돌았고 얼마나 썼는지 (docs/sdlc/run-info/). 어댑터 →
    // manager 병합 → DB 아홉 컬럼 → IPC → 화면까지가 이 한 줄에 걸려 있다.
    //
    // **끝난 턴에만 붙는다** — 사용량은 result와 함께 오므로, 이 줄을 기다리는
    // 것은 곧 그 턴이 끝나기를 기다리는 것이다. 위쪽(2턴 예약을 관찰하는 구간)에
    // 두면 1턴을 끝내버려 예약 버블이 영영 뜨지 않는다.
    const info = page.locator('.turn-info').first()
    await info.waitFor({ state: 'visible', timeout: 10_000 })
    await expect.poll(() => info.textContent(), { timeout: 10_000 })
      .toContain('claude-fake-5[1m]')
    // 캐시를 포함한 마지막 요청의 프롬프트 크기로 잰다 — 2+15428+37917 = 53,347.
    expect(await info.textContent()).toContain('컨텍스트 5%')
    // 비용은 화면이 아니라 호버로만 읽는다 (FR-4).
    expect(await info.textContent()).not.toContain('$')
    expect(await info.getAttribute('title')).toContain('$0.3870')

    // 2·3턴은 아무것도 담지 않았다 — 줄은 1턴의 것 하나 그대로다(FR-2).
    await expect.poll(() => applied.count(), { timeout: 5_000 }).toBe(1)

    // 2턴이 pending을 벗어났다는 사실만으로는 부족하다 — resume spec이 잘못된
    // session id나 cwd를 만들어 즉시 실패·취소돼도 위 단언들은 전부 그대로
    // 만족된다(대기 버블이 사라지고, .turn 개수는 실패·취소 턴에도 붙는다). 특정
    // 턴(둘째 지시)에 .status-succeeded가 실제로 붙는지까지 확인해야 이 기능의
    // 심장부 — 이어받은 세션이 정말로 성공한다 — 를 검증한다. 가짜 CLI는 매 턴
    // 성공 시나리오라(fake-claude.mjs) 시간이 지나면 반드시 붙는다.
    const secondTurn = page.locator('.turn').filter({ hasText: '둘째 지시' })
    await secondTurn.locator('.status-succeeded').waitFor({ state: 'visible', timeout: 20_000 })

    // 목록 줄 개수로 "대화는 하나"를 문자 그대로 지킨다 — /첫 지시/ 줄이 "존재"하는
    // 것만 보면 2·3턴이 별개 대화로 새서 "둘째 지시" 제목의 줄이 하나 더 생겨도
    // 이 매칭에는 안 잡혀 그대로 통과해버린다. "＋ 새 대화"는 .dock-new라 안 세인다.
    //
    // 제목으로 세지 않는다: 줄 끝 액션의 접근성 이름이 `<제목> 이름 바꾸기`·
    // `<제목> 대화 끝내기`라(FR-21) 제목 문자열은 줄 하나당 세 번 걸린다.
    //
    // **제목은 지시가 아니라 담은 맥락에서 온다** (FR-11). 이 대화는 repo '샘플'을
    // 담았고 이슈·메모는 없으므로 3단(첫 repo 이름)까지 내려온다 — '첫 지시'가
    // 아니다. 예전에는 첫 지시의 첫 줄이 곧 제목이었다.
    expect(await page.locator('.dock-conv-title', { hasText: '샘플' }).count()).toBe(1)
    await expect.poll(() => page.locator('.dock-conv').count(), { timeout: 5_000 }).toBe(1)

    // **목록과 대화는 따로 스크롤한다.** .dock-body가 스크롤러가 되면 둘이 한 덩어리로
    // 움직여 대화록을 내릴 때 목록도 함께 올라간다(사용자 실측 보고). jsdom은 레이아웃을
    // 계산하지 않아 단위 테스트로는 잡을 수 없다 — 여기서만 답할 수 있는 질문이다.
    //
    // 본문을 **문자열로** 넘긴다. 함수로 쓰면 TS가 이 파일을 node 프로젝트
    // (`tsconfig.node.json`)로 검사하는데 거기엔 DOM lib이 없어서 `document`를 못 찾는다.
    // lib에 "DOM"을 더하면 같은 프로젝트에 묶인 `core/`가 브라우저 타입을 알게 되어
    // 경계 1("core는 electron/브라우저를 모른다")이 흐려진다 — 그쪽을 건드리지 않는다.
    const scroll = await page.evaluate(`(() => {
      const pick = (sel) => document.querySelector(sel)
      const body = pick('.dock-body')
      const side = pick('.dock-side')
      const main = pick('.dock-main')
      // 대화 칸을 끝까지 내려 본다 — 목록이 따라 움직이는지가 이 단언의 핵심이다.
      main.scrollTop = main.scrollHeight
      return {
        // 소수점 반올림으로 1px 차이가 나는 경우가 있어 여유를 둔다.
        bodyOverflows: body.scrollHeight > body.clientHeight + 1,
        // 실행 패널만 284px이라 도크 기본 높이에서는 대화 칸이 반드시 넘친다.
        mainScrolled: main.scrollTop > 0,
        sideScrollTop: side.scrollTop
      }
    })()`) as { bodyOverflows: boolean; mainScrolled: boolean; sideScrollTop: number }
    // .dock-body가 스크롤러면 둘이 한 덩어리로 움직인다.
    expect(scroll.bodyOverflows).toBe(false)
    expect(scroll.mainScrolled).toBe(true)
    expect(scroll.sideScrollTop).toBe(0)

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

  /**
   * 대화 종료와 되살아남 (`docs/sdlc/conversation-lifecycle/` FR-12·FR-13·FR-20·FR-23).
   *
   * IPC 왕복을 실제로 태운다: `client.runs.close` → preload → `ipcMain.handle` →
   * 저장소의 트랜잭션. `create(parentRunId)`가 `closedAt`을 지우는 반대쪽 절반까지
   * 한 시나리오 안에서 확인한다.
   *
   * **자동 확인은 여기서 검증하지 않는다** — 이 시나리오는 끝내기와 되살아남만 본다.
   * e2e의 run은 driver가 `ONE_DESK_AGENT_LAUNCHER`로 node를 물려 두 플랫폼에서 똑같이
   * 성공한다(CLAUDE.md). 자동 확인 규칙(`INBOX_RULES`의 `clearsOnView` — 실패·중단·완료는
   * 열면 확인되고 답변 필요만 남는다)은 `Dock.test.tsx`가 status를 직접 세워 카테고리마다
   * 고정한다.
   */
  it('대화를 끝내면 목록에서 내려가고, 턴을 이으면 되살아난다', async () => {
    const app = await launchApp()
    const page = app.page

    await page.getByPlaceholder('새 workspace 이름…').fill('close-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const wsButton = page.getByRole('button', { name: 'close-ws', exact: true })
    await wsButton.waitFor({ state: 'visible', timeout: 10_000 })
    await wsButton.click()

    await page.getByRole('button', { name: 'repo 등록' }).click()
    await page.getByPlaceholder('repo 이름').fill('샘플')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가' }).click()
    await page.getByRole('button', { name: '샘플 맥락에 담기' })
      .waitFor({ state: 'visible', timeout: 10_000 })

    const prompt = page.getByRole('textbox', { name: '지시' })
    const send = page.getByRole('button', { name: '실행', exact: true })

    await prompt.fill('끝낼 대화')
    await send.click()
    // 목록 텍스트가 아니라 대화록으로 기다린다 — RunPanel이 재마운트되기 전에 다음
    // 입력을 채우면 빈 프롬프트로 전송이 막힌다(CLAUDE.md).
    await page.locator('.turn-user', { hasText: '끝낼 대화' })
      .waitFor({ state: 'visible', timeout: 20_000 })
    await expect.poll(() => page.locator('.dock-conv').count(), { timeout: 10_000 }).toBe(1)

    // 줄 끝 아이콘은 폭 0으로 접혀 있다 — 줄을 먼저 hover해야 누를 수 있다.
    // 헬퍼가 눌릴 수 있을 때까지 hover를 다시 건다(FR-23).
    const row = page.locator('.dock-conv-row').first()
    await clickRowAction(row, /대화 끝내기/)

    // 기본 목록에서 내려가고, 보고 있던 대화였으므로 새 대화로 돌아온다(FR-23).
    await expect.poll(() => page.locator('.dock-conv').count(), { timeout: 10_000 }).toBe(0)
    await page.getByText('지시를 입력하면 대화가 시작됩니다')
      .waitFor({ state: 'visible', timeout: 10_000 })

    // 토글을 펼치면 다시 보이고 열 수 있다 (FR-20).
    const toggle = page.getByRole('button', { name: /끝낸 대화/ })
    await toggle.waitFor({ state: 'visible', timeout: 10_000 })
    await toggle.click()
    await expect.poll(() => page.locator('.dock-conv').count(), { timeout: 5_000 }).toBe(1)
    await page.locator('.dock-conv-title', { hasText: '끝낼 대화' }).click()
    await page.locator('.turn-user', { hasText: '끝낼 대화' })
      .waitFor({ state: 'visible', timeout: 10_000 })

    // 턴을 이으면 종료가 풀려 기본 목록으로 돌아온다 (FR-13).
    await prompt.fill('이어서')
    await send.click()
    await page.locator('.turn-user', { hasText: '이어서' })
      .waitFor({ state: 'visible', timeout: 20_000 })
    await expect.poll(() => page.locator('.dock-conv').count(), { timeout: 10_000 }).toBe(1)
    await expect.poll(
      () => page.getByRole('button', { name: /끝낸 대화/ }).count(), { timeout: 10_000 }
    ).toBe(0)
  })
})
