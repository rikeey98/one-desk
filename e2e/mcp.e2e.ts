import { describe, it } from 'vitest'
import { resolve } from 'node:path'
import { launchApp } from './driver'

const FAKE_MCP = resolve(process.cwd(), 'core/runner/fixtures/fake-claude-mcp.mjs')

describe('MCP', () => {
  it('agent가 MCP로 이슈를 만들고 앱에 뜬다', async () => {
    // 전달 사슬(core/index → execution → manager → buildCommand)과 설정 파일·토큰·
    // 포트·workspace 범위가 실제로 맞물리는지는 진짜 프로세스를 띄워야만 안다.
    const app = await launchApp({ agentPath: FAKE_MCP })
    const page = app.page

    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-mcp')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const wsButton = page.getByRole('button', { name: /e2e-mcp/ })
    await wsButton.waitFor({ state: 'visible', timeout: 10_000 })
    await wsButton.click()

    await page.getByPlaceholder('repo 이름').fill('샘플')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가' }).click()
    await page.getByRole('button', { name: '샘플 맥락에 담기' })
      .waitFor({ state: 'visible', timeout: 10_000 })

    await page.getByPlaceholder(/무엇을 시킬지/).fill('이슈를 만들어줘')
    await page.getByRole('button', { name: '▶ 실행' }).click()

    // run이 성공했다 — 가짜 CLI는 MCP 호출이 실패하면 is_error로 끝낸다.
    await page.getByRole('button', { name: /succeeded.*이슈를 만들어줘/ })
      .waitFor({ state: 'visible', timeout: 30_000 })

    // IssuePanel은 workspace를 고를 때 한 번만 목록을 불러온다 — run 완료를 구독하지
    // 않는다. 설계 문서(2026-08-12-stage4-mcp-design.md §1 "빠지는 것")가 "UI 변경
    // 없음"을 이 단계의 범위 밖으로 명시했으므로 이건 결함이 아니라 의도된 경계다.
    // agent가 실제로 DB에 썼는지를 화면으로 확인하려면 IssuePanel을 다시 마운트시켜야
    // 하고, 그러려면 이 화면을 완전히 벗어났다 돌아와야 한다 — 인박스로 갔다가
    // workspace를 다시 고르면 그 조건부 블록이 unmount/remount된다(App.tsx의
    // `view === 'workspace' && workspaceId`).
    const inboxLink = page.getByRole('navigation').getByRole('button', { name: /인박스/ })
    await inboxLink.click()
    await wsButton.click()

    // agent가 만든 이슈가 화면에 있다
    await page.getByText('agent가 만든 이슈')
      .waitFor({ state: 'visible', timeout: 10_000 })
  })
})
