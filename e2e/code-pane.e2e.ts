import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { launchApp, type AppSession } from './driver'
import { waitConvStatus } from './dock'

/**
 * 코드 칸 — 틀과 파일 칸 (docs/sdlc/code-editor/ plan 완료 증명). 빌드한 앱에서 IPC(`files:*`) → core의 읽기·쓰기
 * → 디스크 바이트까지 실제로 탄다. 단위 테스트는 CodeMirror를 대신하므로(plan 위험 2) Ctrl+S·바깥 글 교체·처음 갈 줄·
 * 언어 조각 불러오기(위험 3)는 여기서만 본다.
 *
 * repo는 git 저장소여야 한다 — 칸은 `@` 참조와 같은 git 목록만 다룬다(spec §4의 1). 테스트 프로세스의 동기 git은
 * 앱 밖이라 괜찮다(mention.e2e와 같다).
 */

const BOM = Buffer.from([0xef, 0xbb, 0xbf])
/** 가짜 CLI의 events 시나리오가 41번째 줄을 고친다 — 그 줄이 이것이어야 대화록에서 연 줄을 확인할 수 있다 */
const AUTH_LINES = Array.from({ length: 50 }, (_, i) => (i === 40 ? 'export function isExpired(token) {' : `const line${i + 1} = ${i + 1}`))
const AUTH = `${AUTH_LINES.join('\n')}\n`

function prepareRepo(dir: string): void {
  execFileSync('git', ['init', '-q'], { cwd: dir })
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src', 'auth.ts'), AUTH)
  // Windows repo의 흔한 모양 — BOM과 CRLF. 저장 한 번에 이것이 바뀌면 diff 전체가 바뀐 줄이 된다(FR-18)
  writeFileSync(join(dir, 'win.cs'), Buffer.concat([BOM, Buffer.from('class A {\r\n  int x;\r\n}\r\n', 'utf8')]))
}

async function prepareApp(app: AppSession, workspace: string): Promise<void> {
  const { page } = app
  await page.getByPlaceholder('새 workspace 이름…').fill(workspace)
  await page.getByPlaceholder('새 workspace 이름…').press('Enter')
  const ws = page.getByRole('button', { name: workspace, exact: true })
  await ws.waitFor({ state: 'visible', timeout: 10_000 })
  await ws.click()
  await page.getByRole('button', { name: 'repo 등록' }).click()
  await page.getByPlaceholder('repo 이름').fill('api')
  await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
  await page.getByRole('button', { name: '추가', exact: true }).click()
  await page.getByRole('button', { name: 'api repo', exact: true }).waitFor({ timeout: 10_000 })
}

const pane = (page: Page) => page.getByRole('region', { name: '코드 칸' })
const tree = (page: Page) => pane(page).locator('.code-tree')
/** 편집기의 글 — 작은 파일이라 모든 줄이 그려진다(CodeMirror는 보이는 줄만 그린다) */
const editorText = (page: Page) => pane(page).locator('.cm-content').innerText()

async function openFile(page: Page, ...segments: string[]): Promise<void> {
  for (const [i, name] of segments.entries()) {
    const row = tree(page).getByRole('button', { name, exact: true })
    // 폴더가 이미 펼쳐져 있으면 다시 누르지 않는다
    if (i < segments.length - 1 && (await row.getAttribute('aria-expanded')) === 'true') continue
    await row.click()
  }
  await pane(page).locator('.cm-content').waitFor({ timeout: 10_000 })
}

/** 편집기 맨 앞에 한 줄을 넣는다 */
async function typeAtTop(page: Page, text: string): Promise<void> {
  await pane(page).locator('.cm-content').click()
  await page.keyboard.press('Control+Home')
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

describe('코드 칸 (docs/sdlc/code-editor/)', () => {
  it('파일을 열어 고치고 Ctrl+S로 저장한다 — 디스크 바이트는 고친 줄만 다르고 CRLF·BOM이 그대로다', async () => {
    const app = await launchApp({ env: { ONE_DESK_FAKE_SCRIPT: 'events', ONE_DESK_FAKE_STEP_MS: '50' } })
    const { page } = app
    prepareRepo(app.repoDir)
    await prepareApp(app, 'code-ws')

    // 대화를 하나 돌린다 — 이어 가는 대화의 칸은 그 대화의 repo를 연다(FR-6)
    await page.getByRole('textbox', { name: '지시', exact: true }).fill('만료 경계를 고쳐줘')
    await page.getByRole('button', { name: '실행', exact: true }).click()
    await waitConvStatus(page, null, 'succeeded', 30_000)

    // 버튼은 앱 제목 줄 오른쪽 끝, OS 창 단추 바로 왼쪽에 선다(FR-1, 2026-10-10). Windows·Linux는 OS가 창 단추를 겹쳐
    // 그리고(Window Controls Overlay) 그 자리를 뺀 것이 titlebar area다 — 버튼의 오른쪽 끝이 그 영역 끝에 붙어 있어야 한다.
    // OS 제목 표시줄로 되돌아가면(main의 titleBarStyle을 지우면) overlay가 보이지 않는다.
    const fileButton = page.getByRole('button', { name: '파일', exact: true })
    if (process.platform !== 'darwin') {
      // e2e는 DOM 타입이 없는 설정이라 문자열로 넘긴다(composer.e2e와 같다)
      const placement = await page.evaluate<{ visible: boolean; gap: number | null; below: number | null }>(`(() => {
        const overlay = navigator.windowControlsOverlay
        const area = overlay ? overlay.getTitlebarAreaRect() : null
        const box = document.querySelector('.titlebar [aria-label="파일"]').getBoundingClientRect()
        return {
          visible: overlay ? overlay.visible : false,
          gap: area ? area.x + area.width - box.right : null,
          below: area ? box.bottom - (area.y + area.height) : null
        }
      })()`)
      expect(placement.visible).toBe(true)
      expect(placement.gap).toBeGreaterThanOrEqual(0)
      expect(placement.gap).toBeLessThan(16)
      expect(placement.below).toBeLessThanOrEqual(0)
    }

    await fileButton.click()
    await pane(page).waitFor({ timeout: 10_000 })
    await tree(page).getByRole('button', { name: 'win.cs', exact: true }).waitFor({ timeout: 10_000 })

    // LF 파일 — 맨 앞에 한 줄을 넣고 저장
    await openFile(page, 'src', 'auth.ts')
    expect(await editorText(page)).toContain('const line1 = 1')
    // 언어 조각이 file://에서 불렸다 — 강조된 토큰은 클래스가 붙은 span이다(plan 위험 3)
    await expect.poll(() => pane(page).locator('.cm-line span[class]').count(), { timeout: 10_000 }).toBeGreaterThan(0)
    await typeAtTop(page, '// 사람이 고침')
    await pane(page).getByRole('img', { name: '저장하지 않음' }).waitFor()
    await page.keyboard.press('Control+S')
    await pane(page).getByText('저장됨', { exact: true }).waitFor({ timeout: 10_000 })
    expect(readFileSync(join(app.repoDir, 'src', 'auth.ts'), 'utf8')).toBe(`// 사람이 고침\n${AUTH}`)

    // CRLF + BOM 파일
    await openFile(page, 'win.cs')
    await typeAtTop(page, '// x')
    await page.keyboard.press('Control+S')
    await pane(page).getByText('저장됨', { exact: true }).waitFor({ timeout: 10_000 })
    expect(readFileSync(join(app.repoDir, 'win.cs')).equals(
      Buffer.concat([BOM, Buffer.from('// x\r\nclass A {\r\n  int x;\r\n}\r\n', 'utf8')])
    )).toBe(true)

    // 고친 것이 없을 때 디스크가 바뀌면 편집기가 따라간다 (FR-22)
    writeFileSync(join(app.repoDir, 'win.cs'), Buffer.concat([BOM, Buffer.from('// agent\r\n', 'utf8')]))
    await expect.poll(() => editorText(page), { timeout: 10_000 }).toContain('// agent')

    // 고친 채 디스크가 바뀌면 알리고, 저장하면 충돌 → 덮어쓰기 (FR-19·FR-22)
    await typeAtTop(page, '// mine')
    writeFileSync(join(app.repoDir, 'win.cs'), Buffer.concat([BOM, Buffer.from('// agent again\r\n', 'utf8')]))
    await pane(page).getByText('디스크에서 바뀜 — 저장하면 충돌합니다').waitFor({ timeout: 10_000 })
    await page.keyboard.press('Control+S')
    const banner = pane(page).getByRole('alert').filter({ hasText: '이 파일이 디스크에서 바뀌었습니다' })
    await banner.waitFor({ timeout: 10_000 })
    await banner.getByRole('button', { name: '내 것으로 덮어쓰기' }).click()
    await pane(page).getByText('저장됨', { exact: true }).waitFor({ timeout: 10_000 })
    expect(readFileSync(join(app.repoDir, 'win.cs')).equals(
      Buffer.concat([BOM, Buffer.from('// mine\r\n// agent\r\n', 'utf8')])
    )).toBe(true)

    // 대화록 편집 줄에서 열기 — 그 파일의 그 편집 줄로 간다 (FR-23)
    await page.locator('.turn').getByRole('button', { name: '자세히' }).click()
    // 이름에는 경로가 없다 — 그 파일의 줄로 좁혀 잡는다(표시 경로는 Windows에서 역슬래시다)
    await page.locator('.tl-file-row').filter({ hasText: 'auth.ts' })
      .getByRole('button', { name: '코드 칸에서 열기', exact: true }).click()
    await expect.poll(() => pane(page).locator('.code-pane-path').innerText()).toBe('src/auth.ts')
    // 앞에서 한 줄을 넣었으므로 41번째 줄은 원래의 40번째 줄이다 — 편집기가 41번째 줄에 커서를 둔다
    await expect.poll(() => pane(page).locator('.cm-activeLine').innerText(), { timeout: 10_000 })
      .toBe(AUTH_LINES[39])

    await app.close()
  }, 120_000)

  it('고친 것은 인박스에 다녀와도 남고, 저장하지 않은 채 창을 닫으면 앱 안에서 묻는다 (FR-20·FR-21)', async () => {
    const app = await launchApp()
    const { page } = app
    prepareRepo(app.repoDir)
    await prepareApp(app, 'close-ws')

    // 새 대화 칸 — 대상은 작업 디렉토리 알약의 repo다(FR-6)
    await page.getByRole('button', { name: '파일', exact: true }).click()
    await openFile(page, 'src', 'auth.ts')
    await typeAtTop(page, '// 닫기 전에 고침')
    await pane(page).getByRole('img', { name: '저장하지 않음' }).waitFor()

    // 인박스 왕복 — 도크가 다시 마운트돼도 칸이 열려 있고 고친 것이 남는다
    await page.getByRole('navigation').getByRole('button', { name: /인박스/ }).click()
    await page.getByRole('button', { name: 'close-ws', exact: true }).click()
    await pane(page).getByRole('img', { name: '저장하지 않음' }).waitFor({ timeout: 10_000 })
    expect(await editorText(page)).toContain('// 닫기 전에 고침')

    // 사용자가 X를 누른 것처럼 닫는다 — beforeunload를 탄다(page.close()는 건너뛴다)
    await app.electron.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close() })
    const dialog = page.getByRole('alertdialog', { name: '저장하지 않은 파일 1개가 있습니다' })
    await dialog.waitFor({ timeout: 10_000 })
    const closed = app.electron.waitForEvent('close')
    await dialog.getByRole('button', { name: '모두 저장하고 닫기' }).click()
    await closed

    expect(readFileSync(join(app.repoDir, 'src', 'auth.ts'), 'utf8')).toBe(`// 닫기 전에 고침\n${AUTH}`)
    await app.close()
  }, 120_000)
})
