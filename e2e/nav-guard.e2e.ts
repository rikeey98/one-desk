import { describe, it, expect } from 'vitest'
import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, dirname, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright-core'
import { launchApp, type AppSession } from './driver'

/**
 * main의 탐색 가드 (docs/sdlc/conversation-timeline/ spec FR-24).
 *
 * 앱 창이 원격 문서로 넘어가면 preload가 그 문서에도 붙어 `window.oneDesk`가 그 문서의 것이
 * 된다. 렌더러의 마크다운이 링크를 거르지만(FR-22) 거기에만 기대지 않는다 — 이 파일은
 * **렌더러의 거름을 거치지 않고** 페이지에서 직접 `window.open`·`location`을 불러, main의
 * `setWindowOpenHandler`·`will-navigate`만으로 막히는지 본다. 판정 함수 자체는
 * `shared/links.test.ts`가 고정한다 — main에는 단위 테스트가 없어 여기서 실제 창으로 본다.
 *
 * `shell.openExternal`은 기록만 하게 바꿔 세운다 — e2e가 사용자의 브라우저를 열면 안 된다
 * (repo-pick.e2e의 대화상자와 같은 방식).
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const RENDERER_OUT = resolve(HERE, '../out/renderer')

/** 막힌 탐색은 아무 사건도 남기지 않는다 — 넘어갈 시간을 준 뒤 그대로인지 본다. */
const SETTLE_MS = 1_000

async function waitForApp(page: Page): Promise<void> {
  await page.getByPlaceholder('새 workspace 이름…').waitFor({ state: 'visible', timeout: 10_000 })
}

async function stubOpenExternal(app: AppSession): Promise<void> {
  await app.electron.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __opened: string[] }
    g.__opened = []
    shell.openExternal = (async (url: string) => { g.__opened.push(url) }) as typeof shell.openExternal
  })
}

async function openedUrls(app: AppSession): Promise<string[]> {
  return app.electron.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened)
}

async function windowCount(app: AppSession): Promise<number> {
  return app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
}

/**
 * 탐색을 시도시키고, 문서가 그대로인지 본다. 표식을 심어 두고 시도 뒤에도 표식이 살아
 * 있으면 같은 문서다(넘어갔다면 새 문서에는 표식이 없거나 evaluate가 던진다).
 * 탐색은 setTimeout으로 미룬다 — evaluate 도중에 문서가 바뀌면 그 evaluate가 먼저 죽는다.
 * evaluate에 함수 대신 식 문자열을 넘기는 것은 e2e의 tsconfig에 DOM 타입이 없어서다
 * (asset·conversation e2e와 같은 방식).
 */
async function expectNavigationBlocked(page: Page, target: string): Promise<void> {
  const before = page.url()
  await page.evaluate(`(() => {
    window.__stay = 1
    setTimeout(() => { location.href = ${JSON.stringify(target)} }, 0)
  })()`)
  await page.waitForTimeout(SETTLE_MS)
  expect(page.url()).toBe(before)
  expect(await page.evaluate('window.__stay')).toBe(1)
  expect(await page.evaluate('typeof window.oneDesk')).toBe('object')
}

/** 같은 앱 문서로의 탐색은 통과해야 한다 — 새 문서가 뜨고 앱이 다시 그려진다. */
async function expectNavigationAllowed(page: Page, target: string, urlPattern: RegExp): Promise<void> {
  await page.evaluate(`(() => {
    window.__stay = 1
    setTimeout(() => { location.assign(${JSON.stringify(target)}) }, 0)
  })()`)
  await page.waitForURL(urlPattern, { timeout: 10_000 })
  await waitForApp(page)
  expect(await page.evaluate('window.__stay')).toBeUndefined()
  expect(await page.evaluate('typeof window.oneDesk')).toBe('object')
}

describe('탐색 가드 — 새 창', () => {
  it('http(s)만 OS 브라우저로 넘기고 나머지는 조용히 거부한다 — 창은 늘지 않는다', async () => {
    const app = await launchApp()
    const { page } = app
    await waitForApp(page)
    await stubOpenExternal(app)

    // https를 **마지막에** 연다: 핸들러는 순서대로 불리므로 그것이 기록됐을 때는 앞의
    // 거부된 넷도 이미 지나갔다 — "하나뿐"을 기다림 없이 단언할 수 있다.
    await page.evaluate(`(() => {
      window.open('javascript:alert(1)')
      window.open('file:///C:/Windows/win.ini')
      window.open('data:text/html,<script>1</script>')
      window.open('/relative')
      window.open('https://example.com/docs?a=1')
    })()`)
    await expect.poll(() => openedUrls(app)).toHaveLength(1)
    expect(await openedUrls(app)).toEqual(['https://example.com/docs?a=1'])
    expect(await windowCount(app)).toBe(1)
  })
})

describe('탐색 가드 — 창 안 탐색 (index.html을 file:로 연 앱)', () => {
  it('원격 문서·다른 file: 문서로는 넘어가지 않는다', async () => {
    const app = await launchApp()
    const { page } = app
    await waitForApp(page)

    // 포트 9(discard)는 곧바로 연결이 거부된다 — 가드가 뚫려도 바깥으로 나가지 않는다.
    await expectNavigationBlocked(page, 'http://127.0.0.1:9/evil')
    await expectNavigationBlocked(page, 'file:///C:/Windows/win.ini')
    await expectNavigationBlocked(page, 'other.html')
  })

  it('같은 index.html로의 탐색은 통과한다 — main이 계산한 앱 주소가 창의 실제 주소와 같다', async () => {
    const app = await launchApp()
    const { page } = app
    await waitForApp(page)

    await expectNavigationAllowed(page, '?again=1', /index\.html\?again=1$/)
  })
})

/** out/renderer를 그대로 내주는 정적 서버. 개발 서버(ELECTRON_RENDERER_URL) 분기를 흉내 낸다. */
async function serveRenderer(): Promise<{ server: Server; url: string }> {
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8'
  }
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    const file = resolve(RENDERER_OUT, `.${path === '/' ? '/index.html' : decodeURIComponent(path)}`)
    if (file !== RENDERER_OUT && !file.startsWith(RENDERER_OUT + sep)) {
      res.writeHead(403).end()
      return
    }
    readFile(file).then(
      (body) => res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(body),
      () => res.writeHead(404).end()
    )
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('정적 서버의 주소를 얻지 못했습니다')
  return { server, url: `http://127.0.0.1:${address.port}` }
}

/**
 * 다운로드 (리뷰가 찾은 것). Chromium은 Windows·Linux에서 **Alt+클릭한 링크를 새 창도 탐색도 아닌
 * 다운로드로** 처리하고, 그 요청은 `setWindowOpenHandler`·`will-navigate` 어디에도 걸리지 않고
 * session의 `will-download`로 간다. 막지 않으면 agent가 준 주소의 파일에 대한 저장 대화상자가 뜬다 —
 * "앱 창은 앱 문서 말고는 아무것도 열지 않는다"(FR-24)의 빈틈이다.
 *
 * 링크는 답의 마크다운 링크와 같은 모양(`target="_blank"`)으로 페이지에 직접 심는다 — 렌더러의
 * 거름을 거치지 않는다(이 파일의 다른 테스트와 같은 원칙). 주소는 이 테스트가 띄운 정적 서버라
 * 가드가 뚫려도 바깥으로 나가지 않는다.
 */
describe('탐색 가드 — 다운로드', () => {
  it('Alt+클릭한 링크는 내려받지 않는다 — 앱이 다운로드를 막는다', async () => {
    const { server, url } = await serveRenderer()
    try {
      const app = await launchApp()
      const { page } = app
      await waitForApp(page)
      await stubOpenExternal(app)
      // 다운로드를 지켜본다. 앱의 핸들러보다 뒤에 붙으므로 앱이 막았는지(defaultPrevented)가 보인다.
      // 저장 대화상자가 테스트를 붙잡지 않게 이 관찰자도 늘 막는다 — 앱이 막았는지는 막기 전에 적는다.
      await app.electron.evaluate(({ session }) => {
        const g = globalThis as unknown as { __downloads: { url: string; prevented: boolean }[] }
        g.__downloads = []
        session.defaultSession.on('will-download', (event, item) => {
          g.__downloads.push({ url: item.getURL(), prevented: event.defaultPrevented })
          event.preventDefault()
        })
      })
      const target = `${url}/index.html`
      await page.evaluate(`(() => {
        const a = document.createElement('a')
        a.id = 'alt-link'
        a.href = ${JSON.stringify(target)}
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        a.textContent = '내려받기 시험'
        a.style.cssText = 'position:fixed;top:48px;left:48px;z-index:2147483647;padding:8px;background:white'
        document.body.appendChild(a)
      })()`)
      const before = page.url()
      await page.locator('#alt-link').click({ modifiers: ['Alt'] })

      const downloads = () => app.electron.evaluate(
        () => (globalThis as unknown as { __downloads: { url: string; prevented: boolean }[] }).__downloads
      )
      await expect.poll(downloads, { timeout: 5_000 }).toHaveLength(1)
      expect(await downloads()).toEqual([{ url: target, prevented: true }])
      expect(await openedUrls(app)).toEqual([])
      expect(await windowCount(app)).toBe(1)
      expect(page.url()).toBe(before)
      await app.close()
    } finally {
      server.close()
    }
  })
})

describe('탐색 가드 — 창 안 탐색 (개발 서버로 연 앱)', () => {
  it('같은 origin은 통과하고(Vite의 전체 새로고침) 다른 origin은 막는다', async () => {
    const { server, url } = await serveRenderer()
    try {
      const app = await launchApp({ env: { ELECTRON_RENDERER_URL: url } })
      const { page } = app
      await waitForApp(page)
      expect(page.url()).toBe(`${url}/`)

      await expectNavigationBlocked(page, 'http://127.0.0.1:9/evil')
      await expectNavigationBlocked(page, 'file:///C:/Windows/win.ini')
      await expectNavigationAllowed(page, '/?reload=1', /\/\?reload=1$/)
      await app.close()
    } finally {
      server.close()
    }
  })
})
