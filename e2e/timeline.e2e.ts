import { describe, it, expect } from 'vitest'
import { launchApp, type AppSession } from './driver'
import { waitConvStatus } from './dock'

/**
 * 대화록의 타임라인과 답의 마크다운 (docs/sdlc/conversation-timeline/ spec §7 e2e).
 *
 * 가짜 CLI의 `timeline` 시나리오(`core/runner/fixtures/fake-claude.mjs`)가 텍스트 → 읽기 →
 * Grep → 셸 둘(하나는 실패) → 편집 → MCP → 마크다운 답을 줄마다 쉬며 흘린다. 이 파일은 빌드된
 * 앱에서 세 가지를 본다:
 *
 * 1. **접힌 채로 진행이 보인다**(성공 기준 1) — 상태 줄의 작업 중 · 경과 시간 · 지금 도는 셸.
 * 2. **펼치면 컴팩트 타임라인이다**(FR-13·FR-16~18) — 묶음 라벨, 셸 한 줄의 명령, 실패가 묶음
 *    밖, 편집의 `+1 −1`과 diff.
 * 3. **답은 신뢰할 수 없는 입력이다**(FR-21~25) — 원시 HTML·이미지·`javascript:` 링크가 아무것도
 *    실행·로드·탐색하지 않고, https 링크는 main의 `shell.openExternal`로만 나간다.
 *
 * `shell.openExternal`은 기록만 하게 바꿔 세운다 — e2e가 사용자의 브라우저를 열면 안 된다
 * (repo-pick·nav-guard와 같은 방식). 코드 복사는 시스템 클립보드를 쓰므로 원래 값을 되돌려 둔다.
 */

const REPO = '샘플'
const PROMPT = '로그인이 깨졌어. 고쳐줘'
const CODE = 'if (now >= expiresAt) return refresh()'

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

async function readClipboard(app: AppSession): Promise<string> {
  return app.electron.evaluate(({ clipboard }) => clipboard.readText())
}

describe('대화록 타임라인', () => {
  it('접힌 채로 진행이 보이고, 펼치면 블록이며, 답의 마크다운은 아무것도 실행·로드·탐색하지 않는다', async () => {
    // 줄 사이를 600ms 쉰다 — 셸 둘이 도는 창(약 1.2초)이 상태 줄을 붙잡기에 넉넉하다.
    const app = await launchApp({ env: { ONE_DESK_FAKE_SCRIPT: 'timeline', ONE_DESK_FAKE_STEP_MS: '600' } })
    const { page } = app
    await stubOpenExternal(app)
    const savedClipboard = await readClipboard(app)

    // 렌더러가 연 http(s) 요청 — 앱은 file:로 뜨므로 한 건도 없어야 한다(원격 이미지 0건).
    const remote: string[] = []
    page.on('request', (request) => {
      if (/^https?:/i.test(request.url())) remote.push(request.url())
    })

    try {
      // workspace와 repo 준비 — core-loop.e2e.ts의 1~2단계와 같다. repo는 작업 디렉토리다.
      await page.getByPlaceholder('새 workspace 이름…').fill('tl-ws')
      await page.getByPlaceholder('새 workspace 이름…').press('Enter')
      const ws = page.getByRole('button', { name: 'tl-ws', exact: true })
      await ws.waitFor({ state: 'visible', timeout: 10_000 })
      await ws.click()
      await page.getByRole('button', { name: 'repo 등록' }).click()
      await page.getByPlaceholder('repo 이름').fill(REPO)
      await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
      await page.getByRole('button', { name: '추가' }).click()
      await page.getByRole('button', { name: `${REPO} 맥락에 담기` }).waitFor({ state: 'visible', timeout: 10_000 })

      await page.getByRole('textbox', { name: '지시' }).fill(PROMPT)
      await page.getByRole('button', { name: '실행', exact: true }).click()

      // 1. 접힌 채로 진행이 보인다 — 상태 줄에 작업 중 · 경과 시간 · 지금 도는 셸.
      const turn = page.locator('.turn').filter({ has: page.locator('.turn-user', { hasText: PROMPT }) })
      const status = turn.locator('.turn-status')
      await status.filter({ hasText: '셸 pnpm' }).waitFor({ state: 'visible', timeout: 20_000 })
      // 조각 사이의 `·`는 CSS가 그린다 — 글자에는 조각이 붙어 있다.
      expect(await status.textContent()).toMatch(/작업 중(\d+초|1초 미만)/)
      // 시간은 상태 줄 하나가 말한다 — 도는 동안 끝줄 메타에는 시간 조각이 없다(spec §8의 3).
      const meta = turn.locator('.turn-meta')
      expect(await meta.textContent()).toContain('Claude Code')
      expect(await meta.textContent()).not.toMatch(/\d+초|1초 미만/)
      // 도구 한 줄은 접힌 턴에 없다(FR-12) — 흐르는 것은 답 칸의 텍스트뿐이다.
      expect(await turn.locator('.tl-activity').count()).toBe(0)

      // 끝나면 활동 요약이 남는다 — 도구 여섯, 그중 실패 하나(pnpm lint).
      await waitConvStatus(page, null, 'succeeded')
      const summary = turn.locator('.turn-summary')
      await summary.waitFor({ state: 'visible', timeout: 5_000 })
      expect(await summary.textContent()).toBe('도구 6회 · 실패 1')
      expect(await turn.locator('.turn-status').count()).toBe(0)
      // 끝나면 끝줄이 걸린 시간을 말한다 — 상태 줄이 사라졌으므로 한 번뿐이다.
      expect(await meta.textContent()).toMatch(/\d+초|1초 미만/)

      // 2. 답의 마크다운 — 코드 블록·목록·표가 그려진다.
      const answer = turn.locator('.turn-answer')
      await answer.locator('.md-code').waitFor({ state: 'visible', timeout: 5_000 })
      expect(await answer.locator('li').count()).toBe(2)
      expect(await answer.locator('table').count()).toBe(1)

      // 3. 보안 — 원시 HTML은 글자다. script는 요소가 아니고 실행되지 않았다.
      expect(await answer.locator('script').count()).toBe(0)
      expect(await answer.textContent()).toContain('<script>window.__pwned=1</script>')
      expect(await page.evaluate('typeof window.__pwned')).toBe('undefined')
      // 이미지는 그리지 않는다 — 마크다운 이미지도 HTML img도 요소가 생기지 않는다.
      expect(await answer.locator('img').count()).toBe(0)
      expect(await answer.locator('.md-image').textContent()).toBe('[이미지: p]')
      // javascript: 링크는 글자다 — 원래 주소는 title로 읽는다.
      const inert = answer.locator('.md-link-inert')
      expect(await inert.textContent()).toBe('x')
      expect(await inert.getAttribute('title')).toBe('javascript:alert(1)')
      expect(await answer.locator('a').count()).toBe(1)
      expect(remote).toEqual([])
      // 원시 HTML **블록**은 줄을 지킨 글자 블록이다(FR-21 다듬음) — 뿌리의 맨 글자로 떨어져 앞 문단에
      // 붙지 않는다. 링크의 title은 agent가 적은 제목이 아니라 실제 목적지다(FR-22 다듬음).
      expect(await answer.locator('.md-raw').allTextContents()).toEqual([
        '<img src="http://127.0.0.1:9/q.png">', '<script>window.__pwned=1</script>'
      ])
      expect(await answer.getByRole('link', { name: '문서' }).getAttribute('title')).toBe('https://example.com/')

      // 화면 — jsdom은 캐스케이드와 글꼴을 계산하지 않아 여기서만 본다(리뷰가 찾은 것 둘).
      // (가) 답의 마지막 블록 아래에 여백이 남지 않는다: `.md > :last-child`가 블록 여백 규칙을 이긴다.
      expect(await page.evaluate(`(() => {
        const md = document.querySelector('.turn-answer .md')
        return getComputedStyle(md.lastElementChild).marginBottom
      })()`)).toBe('0px')
      // (나) 코드는 모노 글꼴로 그려진다 — 한국어 Windows의 generic monospace(GulimChe)로 떨어지면
      // `.`이 `,`처럼, `\`가 `₩`로 보인다. 실제로 그린 글꼴을 CDP로 묻는다.
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('DOM.enable')
      await cdp.send('CSS.enable')
      const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.turn-answer .md-code pre code' })
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
      const used = fonts.map((font) => font.familyName)
      expect(used.length).toBeGreaterThan(0)
      expect(used.join(', ')).not.toMatch(/gulim/i)
      await cdp.detach()

      // https 링크는 앱 창을 떠나지 않고 main의 shell.openExternal로만 나간다(FR-22·24).
      const before = page.url()
      await answer.getByRole('link', { name: '문서' }).click()
      await expect.poll(() => openedUrls(app)).toEqual(['https://example.com/'])
      expect(page.url()).toBe(before)

      // 코드 복사는 원문을 시스템 클립보드에 쓴다 — 화면에 그린 모양이 아니다.
      await answer.getByRole('button', { name: '코드 복사' }).click()
      await expect.poll(() => readClipboard(app)).toBe(CODE)

      // 4. 펼치면 컴팩트 타임라인이다 (FR-13).
      await turn.getByRole('button', { name: '자세히' }).click()
      expect(await turn.locator('.turn-summary').count()).toBe(0)
      // 마지막 텍스트는 답과 같아 블록에서 빠진다 — 같은 답이 두 번 나오지 않는다(FR-8).
      const texts = turn.locator('.tl-text')
      expect(await texts.count()).toBe(1)
      expect(await texts.textContent()).toBe('먼저 인증 모듈을 봅니다.')

      // 묶음은 접힌 채 시작하고, 누르면 도구 한 줄들이다(FR-6·FR-15·FR-16).
      const bundle = turn.getByRole('button', { name: '3 읽기, Grep, 셸 사용됨' })
      expect(await bundle.getAttribute('aria-expanded')).toBe('false')
      await bundle.click()
      const rows = turn.locator('.tl-activity').first().locator('.tl-tool')
      expect(await rows.count()).toBe(3)
      // 경로는 작업 디렉토리 기준이다 — Windows에서는 구분자가 `\`다.
      expect(await rows.nth(0).textContent()).toMatch(/^읽기 src[\\/]auth\.ts$/)
      expect(await rows.nth(1).textContent()).toBe('Grep expiresAt (3개 일치)')
      // 경로는 모노 글꼴로 그려진다 — UI 글꼴(한국어 Windows의 Malgun Gothic)은 `\`를 `₩`로 그렸다
      // (spec §8의 7). jsdom은 글꼴을 모르므로 실제로 그린 글꼴을 CDP로 묻는다(위 코드 블록과 같다).
      const pathFonts = await (async () => {
        const session = await page.context().newCDPSession(page)
        await session.send('DOM.enable')
        await session.send('CSS.enable')
        const doc = await session.send('DOM.getDocument', { depth: -1 })
        const found = await session.send('DOM.querySelector', {
          nodeId: doc.root.nodeId, selector: '.turn .tl-activity .tl-sub.path-text'
        })
        const { fonts: used } = await session.send('CSS.getPlatformFontsForNode', { nodeId: found.nodeId })
        await session.detach()
        return used.map((font) => font.familyName)
      })()
      expect(pathFonts.length).toBeGreaterThan(0)
      expect(pathFonts.join(', ')).not.toMatch(/malgun|gulim/i)

      // 셸 한 줄을 펼치면 명령과 출력 — 출력은 앞부분만 기록된다고 말한다.
      await turn.getByRole('button', { name: '셸 pnpm test' }).click()
      await turn.locator('.tl-command').filter({ hasText: 'pnpm test' }).waitFor({ state: 'visible', timeout: 5_000 })
      await turn.getByText('출력 앞부분만 기록됩니다').waitFor({ state: 'visible', timeout: 5_000 })

      // 실패한 셸은 묶음 밖에 따로 선다(FR-17).
      expect(await turn.locator('.tl-tool-error').textContent()).toBe('셸 pnpm lint 실패')

      // 편집 — 파일 하나, +1 −1, 펼치면 diff (FR-18).
      const edit = turn.locator('.tl-edit')
      expect(await edit.locator('.tl-head').textContent()).toBe('편집 · 파일 1개')
      const file = edit.getByRole('button', { name: /auth\.ts/ })
      expect(await file.textContent()).toContain('+1 −1')
      await file.click()
      expect(await edit.locator('.tl-line').allTextContents()).toEqual(['−a < b', '+a <= b'])

      // MCP 도구는 서버를 떼고 도구 이름만으로 부른다(FR-4) — 백틱도 "호출"도 없고, 이름은 모노
      // 글자다(spec §8의 5).
      const mcpHead = turn.getByRole('button', { name: '1 list_issues 사용됨', exact: true })
      await mcpHead.waitFor({ state: 'visible', timeout: 5_000 })
      expect(await mcpHead.textContent()).toBe('1 list_issues 사용됨')
      expect(await mcpHead.locator('.tool-name').textContent()).toBe('list_issues')
      expect(remote).toEqual([])
    } finally {
      // 사용자의 클립보드를 되돌린다 — 이 테스트가 코드 복사로 덮어썼다.
      await app.electron.evaluate(({ clipboard }, text) => { clipboard.writeText(text) }, savedClipboard)
        .catch(() => {})
    }
  })
})
