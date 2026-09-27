import { describe, it, expect } from 'vitest'
import { launchApp } from './driver'
import { waitConvStatus } from './dock'

const ISSUE = '토큰 만료 버그'
const PROMPT = '파일 목록 알려줘'

describe('핵심 한 바퀴', () => {
  it('맥락을 담아 실행하면 도크에 탭이 즉시 생기고 로그가 흐른다', async () => {
    // 여기서 try/finally { await app.close() }로 직접 닫지 않는다. smoke.e2e.ts와 같은
    // 이유다 — launchApp()이 onTestFinished로 정리(스크린샷 → 종료 → 임시 디렉토리
    // 삭제)를 스스로 예약하므로 테스트는 아무것도 닫지 않는다.
    //
    // 가짜 CLI를 늦춘다 — 8단계는 "작업 중"이 답 칸에 흐르는 **진행 중의 순간**을 봐야 하고,
    // 끝나면 답 칸이 최종 답("끝남")으로 바뀌어 그 순간이 사라진다. driver의 기본값(1500ms)은
    // 느린 기계에서 창이 좁다(conversation.e2e.ts와 같은 이유).
    const app = await launchApp({ env: { ONE_DESK_FAKE_DELAY_MS: '4000' } })
    const page = app.page

    // 1. workspace 만들고 고른다
    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const wsButton = page.getByRole('button', { name: 'e2e-ws', exact: true })
    await wsButton.waitFor({ state: 'visible', timeout: 10_000 })
    await wsButton.click()

    // 2. repo 등록 — cwd로 쓰이므로 실제로 존재하는 디렉토리여야 한다
    await page.getByRole('button', { name: 'repo 등록' }).click()
    await page.getByPlaceholder('repo 이름').fill('샘플')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가' }).click()
    // repo 이름은 카드와 작업 디렉토리 select 양쪽에 나온다. getByText('샘플')은
    // 두 개를 잡아 strict mode 위반이 된다. 카드에만 있는 aria-label로 기다린다.
    await page.getByRole('button', { name: '샘플 맥락에 담기' })
      .waitFor({ state: 'visible', timeout: 10_000 })

    // 3. 이슈 만들기
    await page.getByPlaceholder('새 이슈 제목…').fill(ISSUE)
    await page.getByPlaceholder('새 이슈 제목…').press('Enter')
    const issueButton = page.getByRole('button', { name: ISSUE, exact: true })
    await issueButton.waitFor({ state: 'visible', timeout: 10_000 })

    // 4. 담기 토글을 눌러 맥락에 담는다 — 칩에는 제거 표시가 함께 붙는다
    await page.getByRole('button', { name: `${ISSUE} 맥락에 담기` }).click()
    const chip = page.getByRole('button', { name: `${ISSUE} 맥락에서 빼기` })
    await chip.waitFor({ state: 'visible', timeout: 5_000 })

    // 5. 권한을 읽기 전용으로
    await page.getByLabel('권한').selectOption('read_only')
    expect(await page.getByLabel('권한').inputValue()).toBe('read_only')

    // 6. 지시를 넣고 실행
    // run-start 버튼의 접근성 이름은 정확히 "실행"뿐이다. exact 없이 substring으로
    // 잡으면 슬롯 표시기("실행 슬롯")·멈추기("이 대화의 실행 멈추기") 같은 aria-label까지 걸려
    // strict mode 위반이 된다(실측).
    await page.getByPlaceholder(/무엇을 시킬지/).fill(PROMPT)
    await page.getByRole('button', { name: '실행', exact: true }).click()

    // 7. 탭이 즉시 생긴다.
    //    이 단언이 실제로 검증하는 것: markStarted 직후의 상태 push(onRunUpdate)가
    //    runs:start의 IPC 응답과는 무관한 별도 채널로 화면에 곧바로 반영된다는 것.
    //    이 단언이 검증하지 "않는" 것: execution.start()가 manager.start()의 완료를
    //    기다리는지 여부. notify(markStarted)가 manager.start() 호출보다 먼저 실행되므로,
    //    execution.start()가 manager.start()를 통째로 await하도록 바뀌어도(즉 완료까지
    //    기다리는 회귀가 생겨도) 이 위치에서는 잡히지 않는다 — 실제로 manager.start()를
    //    그대로 await하도록 고쳐놓고 돌려봐도 이 단언은 그대로 통과했다(커밋 40f7f93).
    //    그 계약은 core 단위 테스트가 잡아야 할 자리다.
    // **줄의 제목은 지시가 아니라 담은 맥락에서 온다** (conversation-lifecycle FR-11).
    // 이 대화는 이슈를 담았으므로 2단(첫 이슈 이름)이다 — PROMPT로 찾으면 못 찾는다.
    // 상태는 점의 클래스로 본다 — 이름은 한국어 표라 문구가 바뀌면 깨진다(e2e/dock.ts).
    await waitConvStatus(page, ISSUE, 'running', 5_000)

    // 8. 로그가 흐른다
    // **접힌 채로 흐른다** (docs/sdlc/conversation-timeline/ spec FR-12, 성공 기준 1) —
    // 진행 중인 턴의 답 칸이 지금까지의 마지막 텍스트를 보인다. 가짜 CLI의 텍스트
    // "작업 중"이 상태 줄의 "작업 중"과 겹치므로(spec §6 우려 10) 답 칸으로 좁힌다.
    await page.locator('.turn-answer').filter({ hasText: '작업 중' })
      .waitFor({ state: 'visible', timeout: 10_000 })
    // 펼치면 그때부터 로그 파일까지 되살리는 훅이 붙는다(useRunEvents). 진행 중의 흐르는
    // 텍스트는 펼친 턴에서 답 칸이 아니라 블록(.tl-text) 안에 제자리로 있다(FR-13).
    // `자세히`는 턴마다 하나라 **턴으로 좁혀** 잡는다(spec NFR-6) — 페이지 범위면 턴이 하나 더
    // 붙는 순간 부분 일치가 둘을 잡아 strict 위반이 난다(리뷰가 찾은 것).
    const turn = page.locator('.turn').filter({ hasText: PROMPT })
    await turn.getByRole('button', { name: '자세히' }).click()
    await turn.locator('.tl-text').getByText('작업 중')
      .waitFor({ state: 'visible', timeout: 10_000 })

    // 9. 완료되면 배지가 바뀌고 결과가 보인다
    // 답은 대화록의 답 칸(.turn-answer)에 선다. 펼친 턴의 블록은 result를 그리지 않으므로
    // (spec FR-2 — 답은 run 행에서 온다) "끝남"이 블록에 한 번 더 나오지는 않는다. 그래도
    // 답 칸으로 좁혀 둔다 — 목록 줄의 부제 같은 다른 칸에 같은 글자가 생겨도 흔들리지 않게.
    await waitConvStatus(page, ISSUE, 'succeeded')
    await page.locator('.turn-answer').filter({ hasText: '끝남' }).waitFor({ state: 'visible', timeout: 5_000 })
  })
})
