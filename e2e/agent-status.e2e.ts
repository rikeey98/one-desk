import { describe, it, expect } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchApp } from './driver'

/**
 * 에이전트 현황 (`docs/sdlc/agent-status/`). 사이드바 하단 줄 → 패널 → 설정 파일 열기의 IPC 왕복(`app.configFiles` →
 * preload → core의 판정 → `shell.openPath`)을 빌드된 앱으로 본다. `shell.openPath`만 main에서 기록하게 바꿔 세운다 —
 * e2e가 사용자의 편집기를 열면 안 된다.
 */
describe('에이전트 현황', () => {
  it('하단 줄이 쓸 수 있는 agent와 MCP를 보이고, 누르면 패널이 뜨며, repo의 설정 파일을 (종류, repo id)로 연다', async () => {
    const app = await launchApp()
    const { page } = app
    const artifacts = resolve('e2e/artifacts')
    mkdirSync(artifacts, { recursive: true })
    mkdirSync(join(app.repoDir, '.claude'), { recursive: true })
    writeFileSync(join(app.repoDir, '.mcp.json'), '{"mcpServers":{}}')
    writeFileSync(join(app.repoDir, '.claude', 'settings.json'), '{}')

    await app.electron.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as Record<string, unknown>).__opened = opened
      shell.openPath = (async (path: string) => { opened.push(path); return '' }) as typeof shell.openPath
    })

    await page.getByPlaceholder('새 workspace 이름…').fill('status-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: 'status-ws', exact: true })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()
    await page.getByRole('button', { name: 'repo 등록' }).click()
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByPlaceholder('repo 이름').fill('api')
    await page.getByRole('button', { name: '추가' }).click()
    await page.getByRole('button', { name: 'api repo' }).waitFor({ state: 'visible', timeout: 10_000 })

    // 하단 줄은 쓸 수 있는 agent와 MCP만 — 가짜 CLI가 두 agent 모두에 물려 있다. 포트·실행 수는 풍선에 있다(FR-1 개정)
    const row = page.getByRole('button', { name: '에이전트 현황' })
    await expect.poll(() => row.textContent(), { timeout: 10_000 }).toBe('Claude CodeOpenCodeMCP')
    expect(await row.getAttribute('title')).toMatch(/^Claude Code · OpenCode · MCP :\d+ · 실행 0\/\d+ — /)
    await page.locator('nav.sidebar').screenshot({ path: join(artifacts, 'agent-status-sidebar.png') })

    await row.click()
    const dialog = page.getByRole('dialog', { name: '에이전트 현황' })
    await dialog.waitFor({ state: 'visible', timeout: 5_000 })
    await dialog.getByText(/포트 \d+에서 받는 중/).waitFor({ state: 'visible', timeout: 5_000 })
    // 설치 판정은 가짜 CLI로 — 실행 탭과 같은 줄이 선다
    const install = dialog.getByRole('list', { name: '에이전트 설치 판정' })
    await install.waitFor({ state: 'visible', timeout: 10_000 })
    await expect.poll(() => install.textContent(), { timeout: 20_000 }).not.toContain('확인 중')
    await page.screenshot({ path: join(artifacts, 'agent-status-panel.png') })

    await dialog.getByRole('button', { name: 'api · 프로젝트 MCP 서버 파일 열기' }).click()
    await expect.poll(() => app.electron.evaluate(() => (globalThis as Record<string, unknown>).__opened as string[]))
      .toEqual([join(app.repoDir, '.mcp.json')])

    // 다크 스킴도 한 장 — 토큰만 쓰는지 눈으로 본다
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.waitForTimeout(200)
    await page.screenshot({ path: join(artifacts, 'agent-status-panel-dark.png') })
    await page.emulateMedia({ colorScheme: 'light' })

    // Esc는 패널만 닫는다
    await dialog.press('Escape')
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 })
  })
})
