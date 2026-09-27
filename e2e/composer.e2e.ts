import { describe, it, expect } from 'vitest'
import type { Page } from 'playwright-core'
import { launchApp, type AppSession } from './driver'
import { convRow, dragDockToMin, waitConvStatus } from './dock'

/**
 * 입력부·대화 헤더·도크 (docs/sdlc/conversation-timeline/ spec §7 e2e — FR-28·FR-31·FR-35·FR-38·
 * FR-39·FR-42).
 *
 * 단위 테스트가 답하지 못하는 것만 본다: jsdom에는 레이아웃·스크롤·popover가 없고, 초안 스토어의
 * Provider는 `main.tsx`의 한 줄이라(plan 다듬은 것 6) 도크가 **실제로 언마운트되는** 인박스 왕복을
 * 빌드된 앱에서 태워야 그 배선이 고정된다.
 */

async function prepare(app: AppSession, ws: string): Promise<Page> {
  const { page } = app
  await page.getByPlaceholder('새 workspace 이름…').fill(ws)
  await page.getByPlaceholder('새 workspace 이름…').press('Enter')
  const wsButton = page.getByRole('button', { name: ws, exact: true })
  await wsButton.waitFor({ state: 'visible', timeout: 10_000 })
  await wsButton.click()

  await page.getByRole('button', { name: 'repo 등록' }).click()
  await page.getByPlaceholder('repo 이름').fill('샘플')
  await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
  await page.getByRole('button', { name: '추가' }).click()
  await page.getByRole('button', { name: '샘플 맥락에 담기' }).waitFor({ state: 'visible', timeout: 10_000 })
  return page
}

/**
 * 첫 턴을 보내고 대화록에 뜰 때까지 기다린다. 목록 줄이 아니라 대화록으로 기다린다 — 입력부가
 * 새 대화 칸에서 그 대화로 다시 마운트되기 전에 다음 입력을 채우면 옛 입력부에 들어간다(CLAUDE.md).
 */
async function send(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: '지시' }).fill(text)
  await page.getByRole('button', { name: '실행', exact: true }).click()
  await page.locator('.turn-user', { hasText: text }).waitFor({ state: 'visible', timeout: 20_000 })
}

/** 대화록이 바닥에 붙어 있는가 — `renderer/followBottom.ts`와 같은 24px 문턱이다. */
async function transcriptAtBottom(page: Page): Promise<boolean> {
  return page.evaluate(`(() => {
    const el = document.querySelector('.transcript')
    return el.scrollHeight - el.scrollTop - el.clientHeight <= 24
  })()`) as Promise<boolean>
}

describe('입력부와 도크', () => {
  it('입력부의 중지로 도는 턴을 멈추고, 쓰던 초안은 대화를 오가도·인박스에 다녀와도 남는다', async () => {
    // 가짜 CLI를 오래 붙잡아 둔다 — 중지를 누를 동안 턴이 끝나 버리면 안 된다.
    const app = await launchApp({ env: { ONE_DESK_FAKE_DELAY_MS: '15000' } })
    const page = await prepare(app, 'cmp-ws')
    const prompt = page.getByRole('textbox', { name: '지시' })

    // 1. 도는 턴이 있고 입력이 비었으면 전송 버튼이 중지다 (FR-28).
    await send(page, '멈출 지시')
    await waitConvStatus(page, '멈출 지시', 'running', 10_000)
    const stop = page.getByRole('button', { name: '중지', exact: true })
    await stop.waitFor({ state: 'visible', timeout: 10_000 })
    // 대화 헤더의 멈추기는 초안이 있을 때만 선다 — 입력칸이 비면 같은 자리의 중지가 그 일을 한다
    // (FR-29, spec §8의 3 — 결정 2026-09-27). 초안을 쓰면 중지는 실행이 되고 헤더의 멈추기가 선다.
    const headerStop = page.getByRole('button', { name: '이 대화의 실행 멈추기' })
    expect(await headerStop.count()).toBe(0)
    await prompt.fill('멈추기 전에 쓴 초안')
    await headerStop.waitFor({ state: 'visible', timeout: 5_000 })
    await stop.waitFor({ state: 'hidden', timeout: 5_000 })
    await prompt.fill('')
    await headerStop.waitFor({ state: 'hidden', timeout: 5_000 })
    await stop.click()
    await waitConvStatus(page, '멈출 지시', 'canceled', 10_000)
    await page.locator('.turn .status-canceled', { hasText: '취소됨' }).waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByRole('button', { name: '이 대화의 실행 멈추기' }).waitFor({ state: 'hidden', timeout: 5_000 })

    // 2. A에 초안을 쓰고 B를 새로 연다.
    await prompt.fill('A에 쓰던 초안')
    await page.getByRole('button', { name: '새 대화', exact: true }).click()
    await expect.poll(() => prompt.inputValue(), { timeout: 5_000 }).toBe('')
    await send(page, '둘째 대화')

    // 3. A로 돌아오면 쓰던 초안이 그대로다 — 입력부는 대화마다 다시 마운트된다(FR-31).
    await convRow(page, '멈출 지시').click()
    await page.locator('.turn-user', { hasText: '멈출 지시' }).waitFor({ state: 'visible', timeout: 5_000 })
    await expect.poll(() => prompt.inputValue(), { timeout: 5_000 }).toBe('A에 쓰던 초안')
    await convRow(page, '둘째 대화').click()
    await page.locator('.turn-user', { hasText: '둘째 대화' }).waitFor({ state: 'visible', timeout: 5_000 })
    await expect.poll(() => prompt.inputValue(), { timeout: 5_000 }).toBe('')

    // 4. 인박스에 다녀온다 — App은 workspace 화면일 때만 도크를 그리므로 도크가 통째로
    //    언마운트된다. 초안이 도크·입력부의 state였다면 여기서 사라진다.
    await page.getByRole('navigation').getByRole('button', { name: /인박스/ }).click()
    await prompt.waitFor({ state: 'detached', timeout: 5_000 })
    await page.getByRole('button', { name: 'cmp-ws', exact: true }).click()
    await convRow(page, '멈출 지시').click()
    await page.locator('.turn-user', { hasText: '멈출 지시' }).waitFor({ state: 'visible', timeout: 5_000 })
    await expect.poll(() => prompt.inputValue(), { timeout: 5_000 }).toBe('A에 쓰던 초안')
  })

  it('최대화는 세 패널을 숨기고 Esc로 돌아오며, 헤더 메뉴로 이름을 바꾸고 끝내고, 위로 올리면 최신으로 이동이 뜬다', async () => {
    const app = await launchApp()
    const page = await prepare(app, 'max-ws')

    await send(page, '첫 지시')
    await waitConvStatus(page, '첫 지시', 'succeeded')
    await send(page, '둘째 지시')
    await waitConvStatus(page, '첫 지시', 'succeeded')
    await page.locator('.turn').filter({ hasText: '둘째 지시' }).locator('.status-succeeded')
      .waitFor({ state: 'visible', timeout: 20_000 })

    // 0. 기본 높이(창의 50%)에서 대화록 칸이 입력 카드보다 크다 (spec §8의 4, 결정 2026-09-27). 빈
    //    입력칸은 한 줄로 시작하고, 맥락이 비면 칩 줄이 없다. 쓰는 만큼 늘어난다(160px에서 멈춘다).
    const measureComposer = `(() => {
      const box = (sel) => document.querySelector(sel).getBoundingClientRect().height
      const promptBox = document.querySelector('.run-prompt')
      return {
        transcript: box('.transcript-wrap'),
        card: box('.composer-card'),
        prompt: box('.run-prompt'),
        line: parseFloat(getComputedStyle(promptBox).lineHeight),
        chips: document.querySelectorAll('.composer-card .run-chips').length
      }
    })()`
    type Composer = { transcript: number; card: number; prompt: number; line: number; chips: number }
    const empty = await page.evaluate(measureComposer) as Composer
    expect(empty.chips).toBe(0)
    expect(empty.prompt).toBeLessThanOrEqual(empty.line + 1)
    expect(empty.transcript).toBeGreaterThan(empty.card)
    const prompt = page.getByRole('textbox', { name: '지시' })
    await prompt.fill('첫 줄\n둘째 줄\n셋째 줄')
    await expect.poll(async () => (await page.evaluate(measureComposer) as Composer).prompt, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(empty.line * 3 - 1)
    await prompt.fill(Array.from({ length: 30 }, (_, i) => `줄 ${i}`).join('\n'))
    await expect.poll(async () => (await page.evaluate(measureComposer) as Composer).prompt, { timeout: 5_000 })
      .toBeLessThanOrEqual(161)
    await prompt.fill('')
    await expect.poll(async () => (await page.evaluate(measureComposer) as Composer).prompt, { timeout: 5_000 })
      .toBeLessThanOrEqual(empty.line + 1)

    // 1. 최대화 — 세 패널이 숨고(언마운트가 아니라 display: none) Esc로 돌아온다 (FR-38·FR-39).
    const columns = page.locator('.columns')
    await page.getByRole('button', { name: '대화창 최대화' }).click()
    await expect.poll(() => columns.isVisible(), { timeout: 5_000 }).toBe(false)
    expect(await columns.count()).toBe(1)
    await page.keyboard.press('Escape')
    await expect.poll(() => columns.isVisible(), { timeout: 5_000 }).toBe(true)

    // 2. 도크를 하한까지 내려 대화록이 넘치게 한다. 입력부는 밀려나지 않고(FR-41), 대화록은
    //    바닥에서 시작한다(FR-42).
    await dragDockToMin(page)
    const layout = await page.evaluate(`(() => {
      const rect = (sel) => document.querySelector(sel).getBoundingClientRect()
      const t = document.querySelector('.transcript')
      return {
        cardInside: rect('.composer-card').bottom <= rect('.dock').bottom + 1,
        overflows: t.scrollHeight > t.clientHeight + 1
      }
    })()`) as { cardInside: boolean; overflows: boolean }
    expect(layout.cardInside).toBe(true)
    expect(layout.overflows).toBe(true)
    await expect.poll(() => transcriptAtBottom(page), { timeout: 5_000 }).toBe(true)

    // 3. 위로 올리면 따라가기가 풀리고 `최신으로 이동`이 뜬다. 누르면 바닥으로 간다.
    const jump = page.getByRole('button', { name: '최신으로 이동' })
    expect(await jump.count()).toBe(0)
    await page.evaluate(`(() => { document.querySelector('.transcript').scrollTop = 0 })()`)
    await jump.waitFor({ state: 'visible', timeout: 5_000 })
    await jump.click()
    await expect.poll(() => transcriptAtBottom(page), { timeout: 5_000 }).toBe(true)
    await jump.waitFor({ state: 'hidden', timeout: 5_000 })

    // 4. 헤더 메뉴로 이름을 바꾼다 (FR-34·FR-35) — 목록 줄의 제목도 같이 바뀐다.
    //    제목은 담은 repo에서 오지 않는다(아무것도 담지 않았다) — 첫 지시의 첫 줄이다.
    const header = page.locator('.conv-header')
    await header.getByRole('button', { name: '대화 메뉴' }).click()
    await page.getByRole('menuitem', { name: '이름 바꾸기' }).click()
    const rename = header.getByRole('textbox', { name: '첫 지시 새 이름' })
    await rename.fill('헤더에서 붙인 이름')
    await rename.press('Enter')
    await header.locator('.conv-title', { hasText: '헤더에서 붙인 이름' })
      .waitFor({ state: 'visible', timeout: 10_000 })
    await page.locator('.dock-conv-title', { hasText: '헤더에서 붙인 이름' })
      .waitFor({ state: 'visible', timeout: 10_000 })

    // 5. 헤더 메뉴로 끝낸다 — 목록에서 내려가고, 보던 대화였으므로 새 대화로 돌아온다(lifecycle FR-23).
    await header.getByRole('button', { name: '대화 메뉴' }).click()
    await page.getByRole('menuitem', { name: '대화 끝내기' }).click()
    await expect.poll(() => page.locator('.dock-conv').count(), { timeout: 10_000 }).toBe(0)
    await header.locator('.conv-title', { hasText: '새 대화' }).waitFor({ state: 'visible', timeout: 10_000 })
  })
})
