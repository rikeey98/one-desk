import { expect } from 'vitest'
import type { Locator, Page } from 'playwright-core'

/**
 * run 상태 — `shared/models.ts`의 `RunStatus`와 같은 값이다. e2e는 shared를 import하지 않는다
 * (빌드된 앱을 UI로만 다룬다, eslint가 막는다) — 그래서 여기 옮겨 적는다. 클래스 이름이 이
 * 값 그대로이므로(`status-<enum>`) 어긋나면 기다리던 점이 영영 안 나타나 타임아웃으로 드러난다.
 */
type RunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'interrupted'

/**
 * 도크 목록 줄을 **클래스로** 잡는 도우미 (`docs/sdlc/conversation-timeline/` spec §6 우려 9).
 *
 * 예전에는 줄 버튼의 접근성 이름에 섞인 상태 점의 영어 `aria-label`로 잡았다
 * (`/succeeded.*제목/`). 상태 이름이 한국어 표(`renderer/runStatus.ts`)로 바뀌면서 그 정규식이
 * 전부 깨졌다 — 한국어 정규식으로 옮기면 화면 문구가 바뀔 때마다 또 깨진다. 그래서 문구가 아니라
 * **enum 그대로인 클래스**(`.status-dot.status-<enum>`)를 본다.
 *
 * 점은 도는 턴을 먼저 그린다(`conv.active ?? conv.state` — spec FR-45 다듬음). 예약이 걸린
 * 대화라도 앞 턴이 돌면 `running`이다.
 */

/**
 * 도크를 하한(280px, `renderer/dockHeight.ts`)까지 끌어내린다. 창 **안**에서 멈춘다 — 창 밖으로
 * 끌면 그쪽 pointermove가 전달되지 않거나 합쳐져, 어디서 멈출지가 실행마다 달랐다(실측: 280px과
 * 306px). 창 바닥 근처면 계산된 높이가 하한 아래라 늘 하한으로 클램프된다.
 */
export async function dragDockToMin(page: Page): Promise<void> {
  const handle = page.getByRole('separator', { name: '대화창 크기 조절' })
  const box = (await handle.boundingBox())!
  const bottom = await page.evaluate('window.innerHeight') as number
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, bottom - 4, { steps: 10 })
  await page.mouse.up()
  await expect.poll(
    async () => Math.round((await page.locator('.dock').boundingBox())!.height), { timeout: 5_000 }
  ).toBe(280)
}

/** 대화 목록의 한 줄. `text`를 주면 그 글자(대개 제목)를 담은 줄로 좁힌다 */
export function convRow(page: Page, text?: string): Locator {
  const rows = page.locator('.dock-conv')
  return text === undefined ? rows : rows.filter({ hasText: text })
}

/**
 * 그 줄의 상태 점이 `status`(여럿이면 그중 하나)가 될 때까지 기다린다. `text`가 null이면
 * 아무 줄이든 — 대화가 하나뿐인 시나리오에서 쓴다.
 */
export async function waitConvStatus(
  page: Page,
  text: string | null,
  status: RunStatus | readonly RunStatus[],
  timeout = 20_000
): Promise<void> {
  const statuses = typeof status === 'string' ? [status] : status
  const selector = statuses.map((s) => `.status-dot.status-${s}`).join(', ')
  await convRow(page, text ?? undefined).locator(selector).first()
    .waitFor({ state: 'visible', timeout })
}
