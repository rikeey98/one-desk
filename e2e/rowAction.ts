import { expect } from 'vitest'
import type { Locator } from 'playwright-core'

export interface RowActionOptions {
  /** 버튼이 눌릴 수 있게 될 때까지 기다리는 전체 시간 */
  timeout?: number
}

/**
 * 줄 끝에 접혀 있는 버튼을 누른다 (`docs/sdlc/conversation-fixes/` spec FR-23).
 *
 * 이슈·메모 줄의 삭제(`.item-actions`), repo 줄의 열기·이름 바꾸기·삭제(`.repo-actions`),
 * 대화 줄의 이름 바꾸기·끝내기(`.dock-conv-actions`)는 평소 **폭 0으로 접혀 있다가**
 * 줄을 hover하거나 포커스가 들어가야 펼쳐진다. 접힌 버튼은 줄이 포인터를 가로채
 * Playwright가 누르지 못한다("li.item intercepts pointer events").
 *
 * **줄을 한 번 hover하고 바로 누르면 가끔 깨진다.** click은 눌리지 않으면 스크롤 방식을
 * 바꿔 가며 다시 시도하는데, 목록이 스크롤되면 줄이 제자리에 멈춘 마우스 밑에서 빠져나가
 * hover가 풀린다. click은 누르기 전까지 마우스를 옮기지 않으므로 그다음 시도는 전부
 * 같은 이유로 막힌다.
 *
 * 그래서 **매번 줄을 다시 hover하고, 누를 수 있는지를 시험 클릭(`trial`)으로 본 뒤에**
 * 진짜로 누른다. 시험 클릭은 실제 클릭과 같은 판정(보임·안정·가로채는 요소 없음)을 하되
 * 이벤트를 페이지에 보내지 않는다 — "폭을 얻었는가"를 CSS 구조에 기대지 않고 Playwright
 * 자신의 판정으로 기다리는 것이다.
 *
 * `name`이 문자열이면 **전체 일치**다. 줄 끝 버튼의 이름은 `<제목> 삭제`처럼 제목을 품어
 * 부분 일치로 잡으면 상세의 `삭제`나 다른 줄의 버튼까지 걸린다(CLAUDE.md). 정규식은 그대로
 * 쓴다. 버튼은 `row` 안에서만 찾는다.
 */
export async function clickRowAction(
  row: Locator,
  name: string | RegExp,
  options: RowActionOptions = {}
): Promise<void> {
  const timeout = options.timeout ?? 10_000
  const button = row.getByRole('button', typeof name === 'string' ? { name, exact: true } : { name })

  await expect.poll(async () => {
    try {
      await row.hover({ timeout: 2_000 })
      await button.click({ trial: true, timeout: 500 })
      return true
    } catch {
      return false
    }
  }, { timeout, interval: 100 }).toBe(true)

  await button.click({ timeout })
}
