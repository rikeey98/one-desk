// 단언은 전부 Playwright의 waitFor다 — 조건이 안 맞으면 타임아웃으로 던진다.
// 일회성 expect(await …textContent())는 재시도가 없어 이 화면에서는 경합에 진다.
import { describe, it } from 'vitest'
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
    const wsButton = page.getByRole('button', { name: 'e2e-queue', exact: true })
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
    // 표시가 예뻐졌는지 보는 게 아니다. 이 숫자는 렌더러 → IPC → app_setting →
    // queue.setLimit → queueUpdate push를 모두 돈 뒤에야 1로 바뀌므로, "상한이 큐에
    // 실제로 적용됐다"의 프록시다. 여기서 기다리지 않고 실행을 시작하면 아래 대기
    // 단언이 상한이 아직 3인 채로 흘러가 버린다.
    await slots.getByText('실행 중 0/1').waitFor({ state: 'visible', timeout: 5_000 })

    // 3. 두 번 연달아 실행한다. 가짜 CLI가 1500ms 지연되므로 관찰할 창이 있다.
    // run-start 버튼의 접근성 이름은 정확히 "실행"뿐이다. exact 없이 substring으로
    // 잡으면 도크 토글("▾ 실행")과 슬롯 표시기("실행 슬롯" aria-label)까지 걸려
    // strict mode 위반이 된다(실측).
    const send = page.getByRole('button', { name: '실행', exact: true })
    await page.getByPlaceholder(/무엇을 시킬지/).fill(FIRST)
    await send.click()

    const runningTab = page.getByRole('button', { name: new RegExp(`running.*${FIRST}`) })
    await runningTab.waitFor({ state: 'visible', timeout: 10_000 })

    // 도크 탭은 이제 run이 아니라 대화 단위다 — "+ 새 실행"이 "+ 새 대화"로 바뀌었다.
    await page.getByRole('button', { name: '+ 새 대화' }).click()
    await page.getByPlaceholder(/무엇을 시킬지/).fill(SECOND)
    await send.click()

    // 4. 두 번째는 대기한다 — 상한이 1이므로 슬롯이 없다
    const pendingTab = page.getByRole('button', { name: new RegExp(`pending.*${SECOND}`) })
    await pendingTab.waitFor({ state: 'visible', timeout: 5_000 })
    await page.getByText('대기 1').waitFor({ state: 'visible', timeout: 5_000 })
    // 일회성 textContent()는 재시도가 없어 push가 한 박자 늦으면 그대로 깨진다.
    await slots.getByText('실행 중 1/1').waitFor({ state: 'visible', timeout: 5_000 })

    // 5. 앞이 끝나면 뒤가 시작해서 끝난다
    await page.getByRole('button', { name: new RegExp(`succeeded.*${FIRST}`) })
      .waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByRole('button', { name: new RegExp(`succeeded.*${SECOND}`) })
      .waitFor({ state: 'visible', timeout: 20_000 })
    // 여기는 순서가 특히 아슬아슬하다. finish()는 onRunUpdate(succeeded 탭)를 먼저
    // 쏘고 finally에서야 queue.release(queueUpdate)를 부르므로, 슬롯 표시기의 갱신은
    // 방금 기다린 succeeded 탭보다 반드시 나중에 온다. 재시도가 필요하다.
    await slots.getByText('실행 중 0/1').waitFor({ state: 'visible', timeout: 5_000 })
  })
})
