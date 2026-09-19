import { describe, it, expect } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp } from './driver'

/**
 * 탭 기반 설정 화면의 IPC 왕복 (docs/sdlc/settings-screen, 수용 기준 5·7·8).
 *
 * 실행 기본값·CLI 경로는 `workspace-defaults.e2e.ts`가 이미 덮는다. 여기는 그 뒤에
 * 붙은 것 — repo 경로 편집이 asset을 데리고 가는지, 앱 탭의 상한이 도크와 같은 값인지,
 * 탭을 옮겨도 입력이 남는지 — 를 실제 앱에서 확인한다.
 */
describe('설정 화면 탭', () => {
  it('repo 경로를 바꾸면 그 repo의 asset이 두 벌로 늘지 않는다', async () => {
    // spec FR-9 / 수용 기준 5. 치환 없이 재스캔만 하면 옛 행이 "없음"으로 남고 새 행이
    // 쌓여 목록이 두 벌이 된다.
    const app = await launchApp()
    const page = app.page

    const skillDir = join(app.repoDir, '.claude', 'skills', '알파')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: 알파\ndescription: e2e\n---\n')

    await page.getByPlaceholder('새 workspace 이름…').fill('settings-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: 'settings-ws', exact: true })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    await page.getByPlaceholder('repo 이름').fill('샘플')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가' }).click()
    await page.getByRole('button', { name: '알파 맥락에 담기' })
      .waitFor({ state: 'visible', timeout: 10_000 })

    // "옮긴 자리"를 새 디렉토리로 만든다 — 설정에서 경로를 고치는 상황이 이것이다.
    // renameSync로 진짜 옮기면 Windows에서 EBUSY가 난다(앱이 그 디렉토리에 핸들을 쥔다,
    // CLAUDE.md의 "열린 핸들이 있는 파일을 지우지 못한다"와 같은 함정). dataDir 아래에
    // 두어야 세션 정리가 함께 지운다.
    const movedDir = join(app.dataDir, 'repo-moved')
    mkdirSync(join(movedDir, '.claude', 'skills', '알파'), { recursive: true })
    writeFileSync(join(movedDir, '.claude', 'skills', '알파', 'SKILL.md'), '---\nname: 알파\ndescription: e2e\n---\n')

    await page.getByRole('button', { name: '설정' }).click()
    await page.getByRole('tab', { name: 'repo' }).click()
    const pathBox = page.getByLabel('샘플 경로')
    await pathBox.waitFor({ state: 'visible', timeout: 10_000 })
    await pathBox.fill(movedDir)
    // 경로가 바뀌는 중이면 옛 대화 경고가 먼저 뜬다.
    await page.getByText(/이어가던 대화/).waitFor({ state: 'visible', timeout: 5_000 })
    await page.getByRole('button', { name: '샘플 저장', exact: true }).click()
    // 저장이 끝나면 App이 목록을 다시 읽어 실행 패널의 작업 디렉토리가 새 경로다.
    await ws.click()
    await expect.poll(
      () => page.getByRole('option', { name: `샘플 — ${movedDir}` }).count(),
      { timeout: 10_000 }
    ).toBe(1)

    // 새로고침으로 다시 훑어도 한 벌이다 — 옛 경로의 행이 옮겨졌지 새 행이 생긴 것이 아니다.
    await page.getByRole('button', { name: '새로고침' }).click()
    await expect.poll(
      () => page.getByRole('button', { name: '알파 맥락에 담기' }).count(),
      { timeout: 10_000 }
    ).toBe(1)
    // "없음" 배지까지는 여기서 단언하지 않는다. 화면의 없음 판정은 workspace에서 가장
    // 최근에 본 시각과의 비교인데, e2e 앱은 진짜 홈을 훑으므로 이 장비의 글로벌 skill이
    // repo보다 몇 ms 뒤에 스캔돼 repo asset이 "없음"으로 칠해진다 — 이 기능과 무관한
    // 판정 문제다. 옮긴 자리에서 실제로 다시 봤다는 것(lastSeenAt 상승)은
    // core/index.test.ts의 "경로를 바꾸면 … 한 벌만 남는다"가 잡는다.
  })

  it('앱 탭에서 바꾼 상한을 도크의 슬롯 표시기가 같은 값으로 보여준다', async () => {
    // spec FR-7 / 수용 기준 8. 둘이 같은 스냅샷과 같은 IPC를 타므로 한쪽의 저장이
    // event:queueUpdate로 다른 쪽에 돌아온다.
    const app = await launchApp()
    const page = app.page

    await page.getByPlaceholder('새 workspace 이름…').fill('limit-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: 'limit-ws', exact: true })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    const slots = page.getByRole('button', { name: '실행 슬롯' })
    await slots.waitFor({ state: 'visible', timeout: 10_000 })
    await expect.poll(() => slots.innerText(), { timeout: 5_000 }).toContain('/3')

    await page.getByRole('button', { name: '설정' }).click()
    await page.getByRole('tab', { name: '앱' }).click()
    const limitBox = page.getByLabel('동시 실행 상한')
    await limitBox.waitFor({ state: 'visible', timeout: 10_000 })
    await limitBox.fill('5')
    await page.getByRole('button', { name: '상한 저장', exact: true }).click()

    await ws.click()
    await slots.waitFor({ state: 'visible', timeout: 10_000 })
    await expect.poll(() => slots.innerText(), { timeout: 5_000 }).toContain('/5')
  })

  it('탭을 옮겼다 돌아와도 고치던 입력이 그대로다', async () => {
    // spec FR-11 / 수용 기준 7. 초안 state가 탭이 아니라 설정 화면에 있어야 성립한다.
    const app = await launchApp()
    const page = app.page

    await page.getByPlaceholder('새 workspace 이름…').fill('tabs-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: 'tabs-ws', exact: true })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    await page.getByRole('button', { name: '설정' }).click()
    const model = page.getByLabel('Claude Code 기본 모델')
    await model.waitFor({ state: 'visible', timeout: 10_000 })
    await model.fill('opus')

    await page.getByRole('tab', { name: '정보' }).click()
    await page.getByRole('list', { name: '앱 정보' }).waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByRole('tab', { name: '실행' }).click()

    await expect.poll(() => page.getByLabel('Claude Code 기본 모델').inputValue(), { timeout: 5_000 })
      .toBe('opus')
  })
})
