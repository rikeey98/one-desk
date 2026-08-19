import { describe, it, expect } from 'vitest'
import { launchApp } from './driver'

const ISSUE = '토큰 만료 버그'
const PROMPT = '파일 목록 알려줘'

describe('핵심 한 바퀴', () => {
  it('맥락을 담아 실행하면 도크에 탭이 즉시 생기고 로그가 흐른다', async () => {
    // 여기서 try/finally { await app.close() }로 직접 닫지 않는다. smoke.e2e.ts와 같은
    // 이유다 — launchApp()이 onTestFinished로 정리(스크린샷 → 종료 → 임시 디렉토리
    // 삭제)를 스스로 예약하므로 테스트는 아무것도 닫지 않는다.
    const app = await launchApp()
    const page = app.page

    // 1. workspace 만들고 고른다
    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const wsButton = page.getByRole('button', { name: 'e2e-ws' })
    await wsButton.waitFor({ state: 'visible', timeout: 10_000 })
    await wsButton.click()

    // 2. repo 등록 — cwd로 쓰이므로 실제로 존재하는 디렉토리여야 한다
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
    const chip = page.getByRole('button', { name: `${ISSUE} ✕` })
    await chip.waitFor({ state: 'visible', timeout: 5_000 })

    // 5. 권한을 읽기 전용으로
    await page.getByLabel('권한').selectOption('read_only')
    expect(await page.getByLabel('권한').inputValue()).toBe('read_only')

    // 6. 지시를 넣고 실행
    // run-start 버튼의 접근성 이름은 정확히 "실행"뿐이다. exact 없이 substring으로
    // 잡으면 도크 토글("▾ 실행")과 슬롯 표시기("실행 슬롯" aria-label)까지 걸려
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
    const runningTab = page.getByRole('button', { name: new RegExp(`running.*${PROMPT}`) })
    await runningTab.waitFor({ state: 'visible', timeout: 5_000 })

    // 8. 로그가 흐른다
    await page.getByText('작업 중').waitFor({ state: 'visible', timeout: 10_000 })

    // 9. 완료되면 배지가 바뀌고 결과가 보인다
    // "끝남"은 대화록의 답변(.turn-answer)과, 진행 중이라 펼쳐진 로그의 마지막
    // result 줄(.log-result) 양쪽에 같은 텍스트로 나타난다(실측 — 이 턴은 running
    // 상태로 처음 마운트돼 기본으로 펼쳐져 있다). page.getByText('끝남')은 그 둘에
    // 다 걸려 strict mode 위반이 된다 — 대화록의 답변으로 범위를 좁힌다.
    const doneTab = page.getByRole('button', { name: new RegExp(`succeeded.*${PROMPT}`) })
    await doneTab.waitFor({ state: 'visible', timeout: 20_000 })
    await page.locator('.turn-answer').filter({ hasText: '끝남' }).waitFor({ state: 'visible', timeout: 5_000 })
  })
})
