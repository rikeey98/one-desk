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

/** better-layout 검토의 HIGH 항목 — 좁은 패널, 대화 줄의 메타, sticky 띠 아래의 포커스, 좁은 창의 껍데기 */
describe('좁은 창의 레이아웃', () => {
  const seed = (page: Page, workspace: string, script: string) => page.evaluate(`(async () => {
    const c = window.oneDesk
    const ws = (await c.workspaces.list()).find((w) => w.name === ${JSON.stringify(workspace)})
    ${script}
  })()`)
  const resize = (app: AppSession, width: number, height: number) => app.electron.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height)
  }, { width, height })
  const widthOf = async (page: Page, name: string) => {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox()
    return box?.width ?? 0
  }
  const NO_SIDEWAYS_SCROLL = '[...document.querySelectorAll(".panel-body")].every((e) => e.scrollWidth <= e.clientWidth + 1)'
  /** 줄 오른쪽 표식이 제목·이름 위로 넘친 줄의 이름. 비어야 한다 */
  // 표식이 이름을 덮는가 — 두 상자가 가로·세로 모두 겹칠 때만이다. 이슈·메모 줄은 표식이 제목 아래 줄이라(docs/sdlc/item-look/)
  // 가로로만 보면 늘 겹쳐 보인다. 스킬 줄처럼 한 줄에 나란한 표식이 왼쪽으로 넘쳐 이름을 덮는 것은 그대로 잡는다.
  const META_OVER_NAME = `[...document.querySelectorAll('.item')].flatMap((row) => {
    const name = row.querySelector('.item-title, .item-open'), meta = row.querySelector('.item-meta')
    if (!name || !meta || !meta.offsetWidth) return []
    const n = name.getBoundingClientRect()
    return [...meta.children].some((c) => {
      const r = c.getBoundingClientRect()
      return r.left < n.right - 1 && r.right > n.left + 1 && r.top < n.bottom - 1 && r.bottom > n.top + 1
    }) ? [name.textContent] : []
  })`

  it('패널이 좁아져도 이슈·스킬 줄의 제목이 남아 눌린다 — 100%의 1000px 창과 200% 확대', async () => {
    const app = await launchApp()
    const { page } = app
    await createWorkspace(page, 'layout-ws')
    const issue = '결제 재시도 큐의 중복 처리'
    const skill = 'release-checklist-for-production'
    await seed(page, 'layout-ws', `
      const i = await c.issues.create({ workspaceId: ws.id, title: ${JSON.stringify(issue)}, priority: 'urgent', kind: 'bug', source: 'dev' })
      await c.issues.updateIfUnchanged({ id: i.id, expectedUpdatedAt: i.updatedAt, status: 'doing' })
      await c.assets.createAuthored({ workspaceId: ws.id, kind: 'skill', name: ${JSON.stringify(skill)}, content: '본문' })
    `)
    await page.getByRole('button', { name: skill, exact: true }).waitFor({ state: 'visible', timeout: 10_000 })

    // 표식이 접히지 않는 넓이(목록 칸 240px 초과)에서도 표식 셋(버그·개발중·진행 중)이 제목 몫을 먹지 못하고, 이름을 덮지도 않는다
    await resize(app, 1100, 700)
    await expect.poll(() => page.evaluate<number>('document.querySelector(".panel-body").clientWidth - 16')).toBeGreaterThan(240)
    await expect.poll(() => widthOf(page, issue)).toBeGreaterThanOrEqual(70)
    expect(await page.evaluate<string[]>(META_OVER_NAME)).toEqual([])

    await resize(app, 1000, 620)
    await expect.poll(() => widthOf(page, issue)).toBeGreaterThanOrEqual(70)
    expect(await widthOf(page, skill)).toBeGreaterThanOrEqual(70)
    expect(await page.evaluate(NO_SIDEWAYS_SCROLL)).toBe(true)

    await resize(app, 1440, 900)
    await setZoom(app, 2)
    await expect.poll(() => page.evaluate<number>('window.innerWidth')).toBeLessThan(900)
    await expect.poll(() => widthOf(page, issue)).toBeGreaterThanOrEqual(70)
    expect(await widthOf(page, skill)).toBeGreaterThanOrEqual(70)
    expect(await page.evaluate(NO_SIDEWAYS_SCROLL)).toBe(true)
    await page.getByRole('button', { name: issue, exact: true }).click()
    await page.locator('.panel-split-detail .detail-actions').waitFor({ state: 'visible', timeout: 10_000 })

    await setZoom(app, 1)
  }, 60_000)

  it('대화 줄에서 repo 이름이 길어도 턴 수와 시각이 보이고, repo 이름 전체는 title로 닿는다', async () => {
    const app = await launchApp()
    const { page } = app
    await createWorkspace(page, 'layout-ws')
    await seed(page, 'layout-ws', `
      await c.repos.create({ workspaceId: ws.id, name: 'customer-billing-service-api', path: ${JSON.stringify(app.repoDir)} })
      await c.runs.start({ workspaceId: ws.id, agentKind: 'claude-code', cwd: ${JSON.stringify(app.repoDir)}, permission: 'edit', userPrompt: '중복 처리 원인을 찾아 줘', context: [] })
    `)
    await page.locator('.dock-conv-meta').first().waitFor({ state: 'visible', timeout: 10_000 })

    // 끝의 시각 글자가 메타 칸 안에 그려지는가 — 잘린 글자의 Range는 칸 밖까지 뻗는다
    const meta = await page.evaluate<{ text: string, timeRight: number, metaRight: number, titles: string[] }>(`(() => {
      const meta = document.querySelector('.dock-conv-meta')
      const walker = document.createTreeWalker(meta, NodeFilter.SHOW_TEXT)
      let last = null
      for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent.trim()) last = node
      const range = document.createRange()
      range.selectNodeContents(last)
      return {
        text: meta.textContent,
        timeRight: range.getBoundingClientRect().right,
        metaRight: meta.getBoundingClientRect().right,
        titles: [...meta.querySelectorAll('[title]')].map((e) => e.title)
      }
    })()`)
    expect(meta.text).toMatch(/^customer-billing-service-api · 1턴 · /)
    expect(meta.timeRight).toBeLessThanOrEqual(meta.metaRight + 0.5)
    expect(meta.titles).toContain('customer-billing-service-api')
  }, 60_000)

  it('상세를 Tab으로 내려가도 포커스가 바닥의 삭제 띠 아래에 숨지 않는다 — 메모와 스킬 둘 다', async () => {
    const app = await launchApp()
    const { page } = app
    await createWorkspace(page, 'layout-ws')
    const links = Array.from({ length: 30 }, (_, i) => `${i + 1}. [링크 ${i + 1}](https://example.com/${i + 1})`).join('\n')
    await seed(page, 'layout-ws', `
      await c.memos.create({ workspaceId: ws.id, title: '링크 메모', body: ${JSON.stringify(links)} })
      await c.assets.createAuthored({ workspaceId: ws.id, kind: 'skill', name: 'link-skill', content: ${JSON.stringify(links)} })
    `)
    await page.getByRole('button', { name: 'link-skill', exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
    await resize(app, 1000, 620)

    const hiddenFocus = async () => {
      await page.locator('.detail-body-read a').first().focus()
      const hidden: string[] = []
      for (let i = 0; i < 30; i++) {
        const overlap = await page.evaluate<{ name: string, px: number } | null>(`(() => {
          const f = document.activeElement
          const band = document.querySelector('.detail-actions')
          if (!f || !band || band.contains(f) || !f.closest('.detail')) return null
          const a = f.getBoundingClientRect(), b = band.getBoundingClientRect()
          return { name: f.textContent, px: Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) }
        })()`)
        if (overlap && overlap.px > 0) hidden.push(`${overlap.name} ${overlap.px}px`)
        await page.keyboard.press('Tab')
      }
      return hidden
    }

    await page.getByRole('button', { name: '링크 메모', exact: true }).click()
    await page.locator('.detail-actions').waitFor()
    expect(await hiddenFocus()).toEqual([])

    await page.getByRole('button', { name: '축소', exact: true }).click()
    await page.getByRole('button', { name: 'link-skill', exact: true }).click()
    await page.locator('.detail-actions').waitFor()
    expect(await hiddenFocus()).toEqual([])
  }, 60_000)

  it('창이 좁으면 사이드바가 저절로 접히고, 제목 줄 글자가 버튼과 겹치지 않으며, 창은 최소 크기 아래로 줄지 않는다', async () => {
    const app = await launchApp()
    const { page } = app
    const workspace = '프로덕트 엔지니어링 플랫폼 팀'
    await createWorkspace(page, workspace)
    await seed(page, workspace, `
      await c.repos.create({ workspaceId: ws.id, name: 'customer-billing-service-api', path: ${JSON.stringify(app.repoDir)} })
    `)
    await page.getByRole('button', { name: 'customer-billing-service-api repo', exact: true }).click()
    await page.getByRole('button', { name: '파일', exact: true }).waitFor({ state: 'visible', timeout: 10_000 })

    await setZoom(app, 2)
    await expect.poll(() => page.evaluate<number>('window.innerWidth')).toBeLessThan(900)
    await expect.poll(() => page.locator('nav.sidebar').getAttribute('class')).toContain('sidebar-collapsed')
    expect(await page.evaluate('localStorage.getItem("one-desk.sidebar.collapsed")')).toBeNull()

    // 좁은 동안 펼친 것은 기억하지 않는다 — 넓어지면 기억한 값(펼침)으로 돌아간다
    await page.getByRole('button', { name: '사이드바 복원' }).click()
    await expect.poll(() => page.locator('nav.sidebar').getAttribute('class')).not.toContain('sidebar-collapsed')
    expect(await page.evaluate('localStorage.getItem("one-desk.sidebar.collapsed")')).toBeNull()
    await setZoom(app, 1)
    await expect.poll(() => page.evaluate<number>('window.innerWidth')).toBeGreaterThanOrEqual(900)
    expect(await page.locator('nav.sidebar').getAttribute('class')).not.toContain('sidebar-collapsed')

    await resize(app, 320, 400)
    const [width, height] = await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentSize())
    expect(width).toBeGreaterThanOrEqual(760)
    expect(height).toBeGreaterThanOrEqual(500)

    // 최소 창을 200%로 키우면(380px) 창 가운데 기준의 제목 글자가 코드 칸 단추에 닿았다 — 흐름 안에 두면 겹치지 않는다
    await setZoom(app, 2)
    await expect.poll(() => page.evaluate<number>('window.innerWidth')).toBeLessThan(400)
    const overlaps = await page.evaluate<string[]>(`(() => {
      const t = document.querySelector('.titlebar-title').getBoundingClientRect()
      return [...document.querySelectorAll('.titlebar button')]
        .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.left < t.right - 1 && r.right > t.left + 1 })
        .map((b) => b.getAttribute('aria-label'))
    })()`)
    expect(overlaps).toEqual([])
    await setZoom(app, 1)
  }, 60_000)
})
