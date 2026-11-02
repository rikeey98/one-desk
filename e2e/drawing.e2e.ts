import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Locator, Page } from 'playwright-core'
import { launchApp, type AppSession } from './driver'
import { clickRowAction } from './rowAction'

/**
 * 그림 (docs/sdlc/drawings/ spec §11). 진짜 Excalidraw로 그리고 진짜 IPC → core → SQLite를 탄다. 단위 테스트는 캔버스를 대신하므로
 * 저장 · 창 사이 합치기 · 묘비 · 끌어 놓기 막기 · 글꼴 · CSP는 여기서만 본다. 그린 요소는 main에서 DB를 읽어 센다(home.e2e의 runSql과
 * 같은 방식) — 캔버스는 그림이라 DOM으로 읽을 수 없다.
 */

const ARTIFACTS = resolve(__dirname, 'artifacts', 'drawing')

interface StoredElement { id: string; type: string; isDeleted?: boolean; text?: string }

/** 그림 행의 장면을 읽는다 — 모듈은 절대 경로로 넘긴다(home.e2e의 runSql과 같은 이유) */
async function readScenes(app: AppSession): Promise<Array<{ title: string; elements: StoredElement[] }>> {
  const modulePath = createRequire(import.meta.url).resolve('better-sqlite3')
  const rows = await app.electron.evaluate((_electron, input) => {
    type Req = (id: string) => unknown
    const req = (process as unknown as { mainModule?: { require: Req } }).mainModule?.require
      ?? (globalThis as unknown as { require: Req }).require
    const Database = req(input.modulePath) as new (file: string, opts: { readonly: boolean }) => {
      prepare(sql: string): { all(): Array<{ title: string; scene: string }> }
      close(): void
    }
    const db = new Database(input.file, { readonly: true })
    try {
      return db.prepare('SELECT title, scene FROM drawing ORDER BY created_at').all()
    } finally {
      db.close()
    }
  }, { file: join(app.dataDir, 'one-desk.db'), modulePath })
  return rows.map((r) => ({ title: r.title, elements: (JSON.parse(r.scene) as { elements: StoredElement[] }).elements }))
}

const live = (elements: StoredElement[]) => elements.filter((e) => !e.isDeleted)
const liveTypes = async (app: AppSession) => {
  const scenes = await readScenes(app)
  return scenes.length === 0 ? [] : live(scenes[0]!.elements).map((e) => e.type).sort()
}

async function prepareApp(app: AppSession): Promise<void> {
  const { page } = app
  await page.getByPlaceholder('새 workspace 이름…').fill('draw-ws')
  await page.getByPlaceholder('새 workspace 이름…').press('Enter')
  const ws = page.getByRole('button', { name: 'draw-ws', exact: true })
  await ws.waitFor({ state: 'visible', timeout: 10_000 })
  await ws.click()
  await page.getByRole('button', { name: 'repo 등록' }).click()
  await page.getByPlaceholder('repo 이름').fill('api')
  await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
  await page.getByRole('button', { name: '추가', exact: true }).click()
  await page.getByRole('button', { name: 'api repo', exact: true }).waitFor({ timeout: 10_000 })
}

/** CSP 위반을 모은다 — 콘솔 오류와 securitypolicyviolation 둘 다 */
function watchCsp(page: Page): string[] {
  const seen: string[] = []
  page.on('console', (m) => { if (/Content Security Policy/.test(m.text())) seen.push(m.text().slice(0, 200)) })
  return seen
}

/** 캔버스 안의 한 점 — 캔버스 상자 기준 비율 */
async function at(canvas: Locator, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const box = await canvas.boundingBox()
  if (!box) throw new Error('캔버스가 보이지 않습니다')
  return { x: box.x + box.width * fx, y: box.y + box.height * fy }
}

/** 도구 단축키를 누르고 끌어서 도형 하나를 그린다 */
async function drawShape(page: Page, canvas: Locator, tool: string, from: [number, number], to: [number, number]): Promise<void> {
  const start = await at(canvas, ...from)
  const end = await at(canvas, ...to)
  // 빈 자리를 한 번 눌러 캔버스에 포커스를 둔다 — 단축키는 캔버스가 받는다
  await page.mouse.click(start.x - 10, start.y - 10)
  await page.keyboard.press(tool)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.press('Escape')
}

async function waitSaved(scope: Locator | Page): Promise<void> {
  await scope.getByRole('status').filter({ hasText: '저장됨' }).waitFor({ timeout: 15_000 })
}

describe('그림 (docs/sdlc/drawings/)', () => {
  it('그리면 저장되고, 새 창과 합쳐지며, 지운 것은 되살아나지 않고, 다시 켜도 남는다', async () => {
    mkdirSync(ARTIFACTS, { recursive: true })
    const app = await launchApp()
    const cspMain = watchCsp(app.page)
    await prepareApp(app)
    const page = app.page

    // 칸 — 제목 줄의 `그림` (FR-11). 그림이 없으면 안내와 첫 그림 만들기 (FR-14)
    await page.getByRole('button', { name: '그림', exact: true }).click()
    const pane = page.getByRole('region', { name: '그림 칸' })
    await pane.getByText('이 repo에 그림이 없습니다').waitFor({ timeout: 10_000 })
    await pane.getByRole('button', { name: '첫 그림 만들기' }).click()
    const canvas = pane.locator('.drawing-canvas')
    await canvas.locator('canvas').first().waitFor({ timeout: 20_000 })
    expect(await pane.getByRole('button', { name: '그림 고르기' }).textContent()).toContain('그림 1')
    // 라이브러리 버튼은 서지 않는다 (FR-25) — 좁은 칸은 모바일 배치다
    expect(await canvas.locator('.sidebar-trigger__label-element').isVisible()).toBe(false)

    // 사각형 하나 → 자동 저장 → DB에 요소 하나
    await drawShape(page, canvas, 'r', [0.3, 0.35], [0.55, 0.5])
    await waitSaved(pane)
    await expect.poll(() => liveTypes(app), { timeout: 10_000 }).toEqual(['rectangle'])

    // 한글 글 — 손글씨 글꼴(Xiaolai)이 앱 안의 파일에서 뜬다 (FR-29)
    const textAt = await at(canvas, 0.35, 0.7)
    await page.mouse.click(textAt.x, textAt.y - 40)
    await page.keyboard.press('t')
    await page.mouse.click(textAt.x, textAt.y)
    await page.keyboard.type('안녕 그림')
    await page.keyboard.press('Escape')
    await expect.poll(async () => {
      const scenes = await readScenes(app)
      return live(scenes[0]?.elements ?? []).find((e) => e.type === 'text')?.text ?? null
    }, { timeout: 15_000 }).toBe('안녕 그림')
    await expect.poll(() => page.evaluate<boolean>(`(async () => {
      await document.fonts.ready
      return [...document.fonts].some((f) => f.family === 'Xiaolai' && f.status === 'loaded')
    })()`), { timeout: 15_000 }).toBe(true)
    await page.screenshot({ path: join(ARTIFACTS, 'pane.png') })

    // 새 창 (FR-9·10) — 같은 그림이 열리고, 거기서 그린 것이 DB에 합쳐진다
    const next = app.electron.waitForEvent('window')
    await pane.getByRole('button', { name: '그림 새 창으로 열기', exact: true }).click()
    const win = await next
    await win.waitForLoadState('domcontentloaded')
    const cspWin = watchCsp(win)
    const winCanvas = win.locator('.drawing-canvas')
    await winCanvas.locator('canvas').first().waitFor({ timeout: 20_000 })
    await expect.poll(() => win.title(), { timeout: 10_000 }).toBe('그림 · 그림 1')
    expect(await win.getByRole('heading', { name: '그림 1' }).isVisible()).toBe(true)
    expect(await winCanvas.locator('.sidebar-trigger__label-element').isVisible()).toBe(false)

    await drawShape(win, winCanvas, 'o', [0.6, 0.2], [0.75, 0.35])
    await waitSaved(win.locator('.drawing-window-head'))
    await expect.poll(() => liveTypes(app), { timeout: 10_000 }).toEqual(['ellipse', 'rectangle', 'text'])

    // 칸에서 하나 더 — 칸의 저장이 창의 타원을 지우지 않는다(합쳐진다)
    await drawShape(page, canvas, 'd', [0.6, 0.55], [0.75, 0.65])
    await expect.poll(() => liveTypes(app), { timeout: 15_000 }).toEqual(['diamond', 'ellipse', 'rectangle', 'text'])
    await win.screenshot({ path: join(ARTIFACTS, 'window.png') })

    // 다른 창에서 지운 것이 되살아나지 않는다 — 창에서 전부 지우고, 칸에서 하나 그린다 (§0, 묘비)
    await win.mouse.click(...Object.values(await at(winCanvas, 0.9, 0.9)) as [number, number])
    await win.keyboard.press('Control+a')
    await win.keyboard.press('Delete')
    await expect.poll(() => liveTypes(app), { timeout: 15_000 }).toEqual([])
    await drawShape(page, canvas, 'r', [0.2, 0.8], [0.3, 0.88])
    await expect.poll(() => liveTypes(app), { timeout: 15_000 }).toEqual(['rectangle'])
    await page.waitForTimeout(1500)
    expect(await liveTypes(app)).toEqual(['rectangle'])

    // 창을 그리자마자 닫아도 그린 것이 남는다 — 대기 중인 자동 저장을 닫기가 흘려보낸다 (main.tsx의 그림 창 분기, item-windows FR-15)
    await drawShape(win, winCanvas, 'd', [0.3, 0.2], [0.4, 0.3])
    await app.electron.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((w) => w.getTitle() === '그림 · 그림 1')?.close()
    })
    await expect.poll(() => liveTypes(app), { timeout: 15_000 }).toEqual(['diamond', 'rectangle'])
    await expect.poll(() => app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), { timeout: 10_000 }).toBe(1)

    // 끌어 놓은 장면 파일은 그림을 바꾸지 않는다 (FR-27)
    const before = JSON.stringify(await readScenes(app))
    await page.evaluate(`(() => {
      const scene = JSON.stringify({ type: 'excalidraw', version: 2, source: 'x', elements: [
        { id: 'dropped', type: 'rectangle', x: 0, y: 0, width: 50, height: 50, version: 1, versionNonce: 1, isDeleted: false,
          angle: 0, strokeColor: '#000', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid',
          roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, boundElements: null, updated: 1,
          link: null, locked: false, index: 'a0' }
      ], appState: {}, files: {} })
      const dt = new DataTransfer()
      dt.items.add(new File([scene], 'other.excalidraw', { type: 'application/json' }))
      const target = document.querySelector('.drawing-canvas .excalidraw__canvas.interactive') || document.querySelector('.drawing-canvas canvas')
      const r = target.getBoundingClientRect()
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 100, clientY: r.top + 100 }))
      }
    })()`)
    await page.waitForTimeout(1500)
    expect(JSON.stringify(await readScenes(app))).toBe(before)

    // CSP 위반이 하나도 없다 — 원격 대체 글꼴을 걷었다 (FR-30)
    expect(cspMain).toEqual([])
    expect(cspWin).toEqual([])

    // 다시 켜도 남는다 — 칸은 열린 채 돌아오고, 그 위에 그린 것이 앞의 것에 더해진다(빈 장면으로 시작했다면 앞의 것이 사라진다)
    await app.relaunch()
    const page2 = app.page
    await page2.getByRole('button', { name: 'draw-ws', exact: true }).click()
    const pane2 = page2.getByRole('region', { name: '그림 칸' })
    const canvas2 = pane2.locator('.drawing-canvas')
    await canvas2.locator('canvas').first().waitFor({ timeout: 20_000 })
    expect(await pane2.getByRole('button', { name: '그림 고르기' }).textContent()).toContain('그림 1')
    await drawShape(page2, canvas2, 'o', [0.4, 0.2], [0.5, 0.3])
    await expect.poll(() => liveTypes(app), { timeout: 15_000 }).toEqual(['diamond', 'ellipse', 'rectangle'])

    // repo 삭제의 확인 글이 그림 개수를 말하고, 지우면 그림도 지워진다 (FR-19·FR-7)
    const repoRow = page2.locator('.repo-slot').filter({ has: page2.getByRole('button', { name: 'api repo', exact: true }) })
    await clickRowAction(repoRow, 'api 삭제')
    await clickRowAction(repoRow, '그림 1개도 지워집니다 · 정말 삭제?')
    await expect.poll(async () => (await readScenes(app)).length, { timeout: 10_000 }).toBe(0)
  }, 240_000)
})
