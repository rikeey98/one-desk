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

    // 4. 이슈를 눌러 맥락에 담는다 — 칩에는 제거 표시가 함께 붙는다
    await issueButton.click()
    const chip = page.getByRole('button', { name: `${ISSUE} ✕` })
    await chip.waitFor({ state: 'visible', timeout: 5_000 })

    // 5. 권한을 읽기 전용으로
    await page.getByLabel('권한').selectOption('read_only')
    expect(await page.getByLabel('권한').inputValue()).toBe('read_only')

    // 6. 지시를 넣고 실행
    await page.getByPlaceholder(/무엇을 시킬지/).fill(PROMPT)
    await page.getByRole('button', { name: '▶ 실행' }).click()

    // 7. 탭이 즉시 생긴다.
    //    execution.start()가 완료를 기다리지 않는다는 계약을 화면에서 고정한다 —
    //    종료까지 await했다면 여기서 몇 분을 기다리다 실패한다.
    const runningTab = page.getByRole('button', { name: new RegExp(`running.*${PROMPT}`) })
    await runningTab.waitFor({ state: 'visible', timeout: 5_000 })

    // 8. 로그가 흐른다
    await page.getByText('작업 중').waitFor({ state: 'visible', timeout: 10_000 })

    // 9. 완료되면 배지가 바뀌고 결과가 보인다
    const doneTab = page.getByRole('button', { name: new RegExp(`succeeded.*${PROMPT}`) })
    await doneTab.waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByText('끝남').waitFor({ state: 'visible', timeout: 5_000 })
  })
})
