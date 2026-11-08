import { describe, it, expect } from 'vitest'
import type { Page } from 'playwright-core'
import { launchApp, type AppSession } from './driver'

/** better-interface 검토의 HIGH 항목 중 실제 창에서만 드러나는 것 — 확대, 키보드, 등록 오류 */

async function createWorkspace(page: Page, name: string): Promise<void> {
  await page.getByPlaceholder('새 workspace 이름…').fill(name)
  await page.getByPlaceholder('새 workspace 이름…').press('Enter')
  await page.getByRole('button', { name, exact: true }).click()
  await page.getByRole('button', { name: 'repo 등록' }).waitFor({ state: 'visible', timeout: 10_000 })
}

async function registerRepo(app: AppSession, path: string): Promise<void> {
  const { page } = app
  await page.getByRole('button', { name: 'repo 등록' }).click()
  await page.getByPlaceholder('repo 이름').fill('api')
  await page.getByPlaceholder('/절대/경로').fill(path)
  await page.getByRole('button', { name: '추가', exact: true }).click()
}

const setZoom = (app: AppSession, factor: number) => app.electron.evaluate(({ BrowserWindow }, zoom) => {
  BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(zoom)
}, factor)

const boxOf = async (page: Page, selector: string) => {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`${selector}가 그려지지 않았다`)
  return box
}

/** 바닥에 붙은 삭제 띠 아래, 스크롤 칸 안에서 보이는 본문 요소. 비어야 한다 */
const BELOW_ACTIONS = `(() => {
  const actions = document.querySelector('.detail-actions')
  let scroller = actions.parentElement
  while (getComputedStyle(scroller).overflowY === 'visible') scroller = scroller.parentElement
  const a = actions.getBoundingClientRect()
  const s = scroller.getBoundingClientRect()
  const x = Math.round((s.left + s.right) / 2)
  const seen = []
  for (let y = Math.ceil(a.bottom); y < Math.floor(s.bottom); y++) {
    const hit = document.elementFromPoint(x, y)
    if (hit && hit !== scroller && scroller.contains(hit) && !actions.contains(hit)) seen.push(y + ':' + hit.tagName)
  }
  return { overflows: scroller.scrollHeight > scroller.clientHeight, seen }
})()`

describe('상세의 바닥', () => {
  it('긴 본문이 넘쳐도 삭제 띠 아래로 본문이 비치지 않는다 — 메모와 스킬 둘 다', async () => {
    const app = await launchApp()
    const { page } = app
    await createWorkspace(page, 'detail-ws')
    const body = Array.from({ length: 12 }, (_, i) => `## 섹션 ${i + 1}\n\n- 첫 줄\n- 둘째 줄\n`).join('\n')
    await page.evaluate(`(async () => {
      const c = window.oneDesk
      const ws = (await c.workspaces.list()).find((w) => w.name === 'detail-ws')
      await c.memos.create({ workspaceId: ws.id, title: '긴 메모', body: ${JSON.stringify(body)} })
      await c.assets.createAuthored({ workspaceId: ws.id, kind: 'skill', name: 'long-skill', content: ${JSON.stringify(body)} })
    })()`)
    await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1000, 620))

    await page.getByRole('button', { name: '긴 메모', exact: true }).click()
    await page.locator('.detail-actions').waitFor()
    expect(await page.evaluate(BELOW_ACTIONS)).toEqual({ overflows: true, seen: [] })

    await page.getByRole('button', { name: '축소', exact: true }).click()
    await page.getByRole('button', { name: 'long-skill', exact: true }).click()
    await page.locator('.detail-actions').waitFor()
    expect(await page.evaluate(BELOW_ACTIONS)).toEqual({ overflows: true, seen: [] })
  }, 60_000)
})

describe('좁아진 창과 등록 오류', () => {
  it('200% 확대에서도 세 패널이 남고, 본문을 스크롤하면 전송 버튼에 닿으며, 문서는 스크롤하지 않는다', async () => {
    const app = await launchApp()
    const { page } = app
    await createWorkspace(page, 'zoom-ws')
    await registerRepo(app, app.repoDir)
    await page.getByRole('button', { name: 'api 맥락에 담기' }).waitFor({ state: 'visible', timeout: 10_000 })

    await setZoom(app, 2)
    await page.waitForFunction('window.innerWidth < 900')

    expect((await boxOf(page, '.columns')).height).toBeGreaterThanOrEqual(150)
    expect((await boxOf(page, '.panel')).height).toBeGreaterThanOrEqual(150)
    expect(await page.evaluate('document.documentElement.scrollHeight <= window.innerHeight')).toBe(true)

    await page.locator('.run-start').scrollIntoViewIfNeeded()
    const send = await boxOf(page, '.run-start')
    const height = await page.evaluate<number>('window.innerHeight')
    expect(send.y + send.height).toBeLessThanOrEqual(height)
    const column = await boxOf(page, '.dock-main')
    expect(send.y + send.height).toBeLessThanOrEqual(column.y + column.height)

    await setZoom(app, 1)
  }, 60_000)

  it('없는 폴더를 등록하면 그 자리에서 이유를 말하고 repo를 만들지 않는다', async () => {
    const app = await launchApp()
    const { page } = app
    await createWorkspace(page, 'path-ws')
    await registerRepo(app, app.repoDir + '-no-such')

    await expect.poll(() => page.getByRole('alert').first().textContent()).toContain('존재하지 않는 경로입니다')
    expect(await page.getByRole('button', { name: 'api repo' }).count()).toBe(0)
  }, 60_000)
})
