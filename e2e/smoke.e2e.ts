import { describe, it, expect } from 'vitest'
import { launchApp } from './driver'

describe('드라이버', () => {
  it('앱을 띄우고 빈 데이터로 시작한다', async () => {
    // 여기서 try/finally { await app.close() }로 직접 닫지 않는다. 닫는 걸 여기로
    // 되돌리면 실패 스크린샷이 조용히 사라진다 — 증상은 "artifacts 디렉토리는 생기는데
    // 안이 비어 있다"라 원인을 잡기 어렵다. finally는 테스트 함수 자신의 Promise가
    // settle되기 전에 실행되므로, onTestFailed 훅이 도는 시점엔 이미 창이 닫혀 있어
    // page.screenshot()이 "Target page, context or browser has been closed"로 죽는다.
    // launchApp()이 onTestFinished로 정리를 직접 예약하므로 여기서는 부르지 않는다.
    const app = await launchApp()

    const blank = app.page.getByText('왼쪽에서 workspace를 선택하세요')
    await blank.waitFor({ state: 'visible', timeout: 10_000 })

    // 실제 사용자 데이터였다면 workspace가 하나라도 있다.
    // 비어 있다는 것이 ONE_DESK_USER_DATA가 먹혔다는 증거다.
    const empty = app.page.getByText('workspace가 없습니다')
    await empty.waitFor({ state: 'visible', timeout: 5_000 })
    expect(await empty.textContent()).toBe('workspace가 없습니다')
  })
})
