import { describe, it, expect } from 'vitest'
import type { Page } from 'playwright-core'
import { launchApp } from './driver'
import { waitConvStatus } from './dock'

/** 리포트의 `agent에게 다듬기`가 채우는 지시 — `renderer/components/ReportPanel.tsx`의 POLISH_PROMPT (e2e는 renderer를 import하지 않는다) */
const POLISH_PROMPT = '담은 리포트 메모를 바탕으로 팀에 공유할 주간 보고를 써 줘. 완료한 일, 진행 중인 일, 막힌 것 순서로.'

async function makeWorkspace(page: Page, name: string) {
  await page.getByPlaceholder('새 workspace 이름…').fill(name)
  await page.getByPlaceholder('새 workspace 이름…').press('Enter')
  const ws = page.getByRole('button', { name, exact: true })
  await ws.waitFor({ state: 'visible', timeout: 10_000 })
  await ws.click()
  return ws
}

async function addIssue(page: Page, title: string) {
  const input = page.getByPlaceholder('새 이슈 (첫 줄이 제목)')
  await input.fill(title)
  await input.press('Enter')
  await page.getByRole('region', { name: 'Issues' }).getByText(title).waitFor({ state: 'visible', timeout: 10_000 })
}

/**
 * 기간 리포트 (`docs/sdlc/period-report/`). 단위 테스트는 가짜 client로 돌아 채널·preload·핸들러가 어긋나도 초록이다 —
 * 여기서 `client.reports.build` → preload → `ipcMain.handle` → core가 실제 DB에서 **workspace 둘을 넘어** 읽는지,
 * 그리고 내보내기 셋(복사·메모·다듬기)이 실제 앱에서 이어지는지 본다.
 */
describe('기간 리포트', () => {
  it('workspace 둘을 넘어 모으고, 세 보기·복사·메모 저장·다듬기·이슈 열기가 이어진다', async () => {
    const app = await launchApp()
    const page = app.page
    const savedClipboard = await app.electron.evaluate(({ clipboard }) => clipboard.readText())

    try {
      // workspace A — 이슈 하나와 대화 하나(가짜 CLI)
      await makeWorkspace(page, 'rep-a')
      await page.getByRole('button', { name: 'repo 등록' }).click()
      await page.getByPlaceholder('repo 이름').fill('샘플')
      await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
      await page.getByRole('button', { name: '추가' }).click()
      await page.getByRole('button', { name: '샘플 맥락에 담기' }).waitFor({ state: 'visible', timeout: 10_000 })
      await addIssue(page, '리포트 이슈 A')
      await page.getByRole('textbox', { name: '지시' }).fill('리포트에 나올 대화')
      await page.getByRole('button', { name: '실행', exact: true }).click()
      await waitConvStatus(page, null, ['succeeded', 'failed'])

      // workspace B — 이슈 하나. 마지막으로 고른 workspace라 메모가 여기로 간다
      await makeWorkspace(page, 'rep-b')
      await addIssue(page, '리포트 이슈 B')

      // 리포트 — 기본은 "지난주"라 방금 만든 것이 없을 수 있다. 이번 주로 고른다
      await page.getByRole('button', { name: '리포트', exact: true }).click()
      await page.getByRole('button', { name: '이번 주', exact: true }).click()
      const doc = page.getByRole('article', { name: '리포트 문서' })
      const sectionA = doc.getByRole('region', { name: 'rep-a 리포트' })
      await sectionA.waitFor({ state: 'visible', timeout: 10_000 })
      expect(await sectionA.textContent()).toContain('리포트 이슈 A')
      expect(await sectionA.textContent()).toContain('이슈 없는 대화')
      expect(await doc.getByRole('region', { name: 'rep-b 리포트' }).textContent()).toContain('리포트 이슈 B')

      // 요일 — 오늘 칸에 두 workspace의 만듦 사건
      await page.getByRole('tab', { name: '요일' }).click()
      const board = page.getByRole('table', { name: '요일 보드' })
      await board.waitFor({ state: 'visible', timeout: 5_000 })
      await board.getByRole('button', { name: '만듦 · 리포트 이슈 B' }).click()
      expect(await page.getByRole('complementary', { name: '고른 사건' }).textContent()).toContain('rep-b')

      // 이슈 흐름 — workspace마다 절
      await page.getByRole('tab', { name: '이슈 흐름' }).click()
      await page.getByRole('region', { name: 'rep-a 흐름' }).waitFor({ state: 'visible', timeout: 5_000 })
      await page.getByRole('region', { name: 'rep-b 흐름' }).waitFor({ state: 'visible', timeout: 5_000 })

      // 복사 — 어느 보기에서든 문서 순서의 마크다운이다(FR-12)
      await page.getByRole('button', { name: '마크다운 복사' }).click()
      await page.getByRole('button', { name: '복사함' }).waitFor({ state: 'visible', timeout: 5_000 })
      const copied = await app.electron.evaluate(({ clipboard }) => clipboard.readText())
      expect(copied).toMatch(/^# 리포트 /)
      expect(copied).toContain('## rep-a')
      expect(copied).toContain('## rep-b')
      expect(copied).toContain('- 리포트 이슈 A')

      // 메모로 저장 — 버튼 글자가 대상을 말한다
      await page.getByRole('button', { name: 'rep-b에 메모로 저장' }).click()
      await page.getByRole('button', { name: '메모 열기' }).click()
      const memos = page.getByRole('region', { name: 'Memos' })
      await expect.poll(async () => (await memos.getAttribute('class')) ?? '', { timeout: 5_000 }).toContain('panel-expanded')
      expect(await page.getByRole('button', { name: 'rep-b', exact: true }).getAttribute('class')).toContain('ws-selected')

      // agent에게 다듬기 — 새 대화 칸에 메모 칩과 초안, 보내지는 않는다
      await page.getByRole('button', { name: '리포트', exact: true }).click()
      await page.getByRole('button', { name: 'agent에게 다듬기' }).click()
      const prompt = page.getByRole('textbox', { name: '지시' })
      await prompt.waitFor({ state: 'visible', timeout: 10_000 })
      await expect.poll(() => prompt.inputValue(), { timeout: 5_000 }).toBe(POLISH_PROMPT)
      await page.locator('.composer-card .run-chips').getByRole('button', { name: /^리포트 .* 맥락에서 빼기$/ })
        .waitFor({ state: 'visible', timeout: 5_000 })
      expect(await page.locator('.dock-conv').count()).toBe(0)

      // 리포트에서 다른 workspace의 이슈를 열면 그 workspace에서 열린다 — 목록이 오기 전에 닫히지 않는다(FR-19)
      await page.getByRole('button', { name: '리포트', exact: true }).click()
      await page.getByRole('tab', { name: '문서' }).click()
      await page.getByRole('article', { name: '리포트 문서' }).getByRole('button', { name: /리포트 이슈 A/ }).click()
      const issues = page.getByRole('region', { name: 'Issues' })
      await expect.poll(async () => (await issues.getAttribute('class')) ?? '', { timeout: 5_000 }).toContain('panel-expanded')
      await page.waitForTimeout(300)
      expect(await issues.getAttribute('class')).toContain('panel-expanded')
      expect(await page.getByRole('button', { name: 'rep-a', exact: true }).getAttribute('class')).toContain('ws-selected')
    } finally {
      await app.electron.evaluate(({ clipboard }, text) => { clipboard.writeText(text) }, savedClipboard).catch(() => {})
    }
  })
})
