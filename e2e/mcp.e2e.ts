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
    const wsButton = page.getByRole('button', { name: /^e2e-mcp$/ })
    await wsButton.waitFor({ state: 'visible', timeout: 10_000 })
    await wsButton.click()

    await page.getByPlaceholder('repo 이름').fill('샘플')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가' }).click()
    await page.getByRole('button', { name: '샘플 맥락에 담기' })
      .waitFor({ state: 'visible', timeout: 10_000 })

    // run-start 버튼의 접근성 이름은 정확히 "실행"뿐이다. exact 없이 substring으로
    // 잡으면 도크 토글("▾ 실행")과 슬롯 표시기("실행 슬롯" aria-label)까지 걸려
    // strict mode 위반이 된다(실측).
    await page.getByPlaceholder(/무엇을 시킬지/).fill('이슈를 만들어줘')
    await page.getByRole('button', { name: '실행', exact: true }).click()

    // run이 성공했다 — 가짜 CLI는 MCP 호출이 실패하면 is_error로 끝낸다.
    await page.getByRole('button', { name: /succeeded.*이슈를 만들어줘/ })
      .waitFor({ state: 'visible', timeout: 30_000 })

    // **화면을 벗어나지 않는다.** 예전에는 IssuePanel이 workspace를 고를 때 한 번만
    // 목록을 읽어서, agent가 만든 이슈를 보려면 인박스에 갔다 돌아와 패널을 다시
    // 마운트시켜야 했다(4단계 설계 §1이 "UI 변경 없음"으로 미뤄둔 경계). 이제
    // useIssues/useMemos가 run 완료를 구독하므로 그 자리에서 나타나야 한다 —
    // 여기서 다시 마운트시키면 구독이 죽어도 테스트가 통과해 버린다.
    await page.getByText('agent가 만든 이슈')
      .waitFor({ state: 'visible', timeout: 10_000 })
  })
})
