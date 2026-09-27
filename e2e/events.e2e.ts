import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from 'playwright-core'
import { launchApp, type AppSession } from './driver'
import { waitConvStatus } from './dock'

/**
 * 대화가 버리던 데이터 (docs/sdlc/conversation-events/ spec §8 e2e).
 *
 * 가짜 CLI의 `events` 시나리오(`core/runner/fixtures/fake-claude.mjs`·`fake-opencode.mjs`)가 어댑터가 새로
 * 싣는 것 — 생각·원문 출력·구조화된 세부·하위 에이전트·공지 — 을 흘리고, 이 파일은 빌드된 앱에서 그것이
 * 화면에 서는지 본다. **턴을 펼친 뒤** 단언한다 — 접힌 턴에는 블록이 없다(timeline FR-12).
 *
 * claude 쪽은 로그도 본다 — `raw.jsonl`이 가짜 CLI가 낸 줄을 **줄마다 그대로**(깨진 줄까지) 담고, 서명은
 * 거기에만 있고 정규화 로그(`stream.jsonl`)에는 없다(E1·E3). 가짜 CLI의 출력은 결정적이라 같은 작업
 * 디렉토리에서 한 번 더 돌려 기대값을 만든다.
 *
 * opencode 쪽은 `--thinking` 배선을 잡는다 — 가짜 opencode는 그 플래그가 있을 때만 생각 줄을 낸다(실제
 * run 루프처럼, plan 다듬은 것 6). 어댑터가 플래그를 빼면 `생각 · 2초`가 없다.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const FAKE_CLAUDE = resolve(HERE, '../core/runner/fixtures/fake-claude.mjs')
const FAKE_OPENCODE = resolve(HERE, '../core/runner/fixtures/fake-opencode.mjs')

/** 줄 사이 쉼 — 스물몇 줄이 2~3초 안에 끝난다 */
const STEP_MS = '100'
const PROMPT = '만료 경계를 고쳐줘'

/** workspace와 repo 준비 — timeline.e2e.ts와 같다. repo가 곧 작업 디렉토리다. */
async function prepare(app: AppSession, workspace: string): Promise<void> {
  const { page } = app
  await page.getByPlaceholder('새 workspace 이름…').fill(workspace)
  await page.getByPlaceholder('새 workspace 이름…').press('Enter')
  const ws = page.getByRole('button', { name: workspace, exact: true })
  await ws.waitFor({ state: 'visible', timeout: 10_000 })
  await ws.click()
  await page.getByRole('button', { name: 'repo 등록' }).click()
  await page.getByPlaceholder('repo 이름').fill('샘플')
  await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
  await page.getByRole('button', { name: '추가', exact: true }).click()
  await page.getByRole('button', { name: '샘플 맥락에 담기' }).waitFor({ state: 'visible', timeout: 10_000 })
}

/** 한 턴을 보내고 끝날 때까지 기다린다. 그 턴을 돌려준다(아직 접힌 채다). */
async function runTurn(page: Page): Promise<Locator> {
  await page.getByRole('textbox', { name: '지시' }).fill(PROMPT)
  await page.getByRole('button', { name: '실행', exact: true }).click()
  await waitConvStatus(page, null, 'succeeded', 30_000)
  return page.locator('.turn').filter({ has: page.locator('.turn-user', { hasText: PROMPT }) })
}

/** 그 상자가 바닥까지 내려가 있나 — 출력 블록은 열 때 바닥이다(FR-43) */
async function scrolledToBottom(box: Locator): Promise<boolean> {
  return box.evaluate((el) => el.scrollHeight > el.clientHeight && el.scrollHeight - el.scrollTop - el.clientHeight < 2)
}

describe('대화가 버리던 데이터', () => {
  it('claude — 생각·셸 출력·파일 개수·줄 번호·이전 내용·재시도·하위 에이전트·권한 거부·압축이 보이고, 원본 줄이 raw.jsonl에 남는다', async () => {
    const app = await launchApp({ env: { ONE_DESK_FAKE_SCRIPT: 'events', ONE_DESK_FAKE_STEP_MS: STEP_MS } })
    const { page } = app
    await prepare(app, 'ev-claude')
    const turn = await runTurn(page)

    // 접힌 턴 — 활동 요약에 권한 거부와 압축이 더해진다(FR-51). 하위 에이전트 카드는 하나로 센다.
    const summary = turn.locator('.turn-summary')
    await summary.waitFor({ state: 'visible', timeout: 5_000 })
    expect(await summary.textContent()).toBe('도구 6회 · 권한 거부 1 · 대화 압축됨')

    await turn.getByRole('button', { name: '자세히' }).click()

    // 생각 — 접힌 한 줄은 앞 이벤트부터 잰 추정이고, 펼치면 본문이 글자 그대로다(FR-48).
    await turn.getByRole('button', { name: /^생각 · 약 / }).click()
    const thought = turn.locator('.tl-reasoning-body')
    expect(await thought.textContent()).toBe('테스트가 왜 깨지는지 먼저 본다.\n만료 경계가 **의심스럽다**.')
    expect(await thought.locator('strong').count()).toBe(0)

    // 검색 — claude Grep의 기본 출력이 센 것은 파일이다(FR-44).
    await turn.getByRole('button', { name: '2 셸, Grep 사용됨' }).click()
    const rows = turn.locator('.tl-activity .tl-tool')
    expect(await rows.nth(1).textContent()).toBe('Grep expiresAt (파일 3개)')

    // 셸 — 7만 자 출력의 끝부분이다. 열 때 바닥이라 PASS가 보이고, 버린 앞부분을 위에서 말한다(FR-43).
    await turn.getByRole('button', { name: '셸 pnpm test' }).click()
    const output = turn.locator('.tl-activity .tl-detail .tl-output')
    expect(await output.textContent()).toMatch(/\nPASS$/)
    await expect.poll(() => scrolledToBottom(output)).toBe(true)
    expect(await turn.locator('.tl-activity .tl-output-note').textContent())
      .toMatch(/^앞부분 [\d,]+자는 기록하지 않았습니다$/)

    // 편집 — 세부의 hunk로 줄 번호가 붙고(41줄), 첫 hunk 위에 건너뛴 줄 수가 선다(FR-47).
    const edit = turn.locator('.tl-edit')
    expect(await edit.locator('.tl-head').textContent()).toBe('편집 · 파일 2개')
    await edit.getByRole('button', { name: /auth\.ts/ }).click()
    expect((await edit.locator('.tl-diff-no').allTextContents()).slice(0, 2)).toEqual(['41', '41'])
    expect(await edit.locator('.tl-diff-gap').first().textContent()).toBe('⋯ 40줄')
    // 번호 칸은 복사에서 빠진다 — jsdom은 CSS를 계산하지 않아 여기서 본다.
    expect(await edit.locator('.tl-diff-no').first().evaluate((el) => {
      const style = el.ownerDocument.defaultView!.getComputedStyle(el)
      return style.userSelect || style.getPropertyValue('-webkit-user-select')
    })).toBe('none')

    // 덮어쓰기 — 이전 내용을 따로 펼친다(FR-47).
    await edit.getByRole('button', { name: /README\.md/ }).click()
    await edit.getByRole('button', { name: '이전 내용 보기' }).click()
    expect(await edit.locator('.tl-before .tl-output').textContent()).toBe('# 인증 모듈\n\n만료 경계는 `>`다.\n')
    await edit.getByRole('button', { name: '이전 내용 숨기기' }).waitFor({ state: 'visible', timeout: 5_000 })

    // 공지선 — 재시도 · 권한 거부 · 압축(FR-50). 권한 거부는 로그에 두 번 오지만(system + result) 한 번이다.
    expect(await turn.locator('.tl-notice-line').allTextContents()).toEqual([
      'API 재시도 중 · 2/10번째 · 5초 뒤 · 529',
      '권한 때문에 막힘: Bash',
      '대화가 압축됨 · 자동 · 153,214 → 12,400 토큰'
    ])
    await expect.poll(() => turn.getByText('권한 때문에 막힘: Bash').count()).toBe(1)
    // 막힌 도구는 "실패"가 아니라 "권한 거부"이고, 공지선이 바로 아래다(FR-46).
    const denied = turn.locator('.tl-tool-error')
    expect(await denied.textContent()).toBe('셸 rm -rf build 권한 거부')
    expect(await denied.evaluate((el) => el.nextElementSibling?.textContent)).toBe('권한 때문에 막힘: Bash')

    // 하위 에이전트 — 카드 하나이고, 펼치면 자식 읽기가 카드 안에 있다(FR-49). 메인에는 없다.
    const card = turn.getByRole('button', { name: '하위 에이전트 로그인 흐름 조사' })
    expect(await card.textContent()).toContain('도구 1회 · 3초 · claude-fake-sonnet')
    expect(await turn.getByRole('button', { name: '1 읽기 사용됨' }).count()).toBe(0)
    await card.click()
    const children = turn.locator('.tl-subagent-children')
    await children.getByRole('button', { name: '1 읽기 사용됨' }).click()
    expect(await children.locator('.tl-tool').first().textContent()).toMatch(/^읽기 src[\\/]login\.ts$/)
    expect(await turn.locator('.tl-subagent').getByText('login은 세션 쿠키를 쓴다.').count()).toBe(1)

    // JSON이 아닌 줄은 원문 줄 공지다(TL).
    expect(await turn.getByRole('button', { name: '해석하지 못한 출력 1줄' }).count()).toBe(1)

    // 로그 — run 디렉토리는 하나다(슬래시 커맨드 probe는 run이 아니다).
    const logs = join(app.dataDir, 'logs')
    const runs = readdirSync(logs).filter((name) => existsSync(join(logs, name, 'raw.jsonl')))
    expect(runs).toHaveLength(1)
    const raw = readFileSync(join(logs, runs[0]!, 'raw.jsonl'), 'utf8')
    const stream = readFileSync(join(logs, runs[0]!, 'stream.jsonl'), 'utf8')
    // 가짜 CLI가 낸 줄 전부가 순서대로 — 어댑터가 버리는 줄과 깨진 줄까지(FR-1). 가짜 CLI는 결정적이다.
    const emitted = execFileSync(process.execPath, [FAKE_CLAUDE], {
      cwd: app.repoDir, input: '', encoding: 'utf8',
      env: { ...process.env, ONE_DESK_FAKE_SCRIPT: 'events', ONE_DESK_FAKE_STEP_MS: '0' }
    })
    const lines = (text: string) => text.split('\n').filter((line) => line !== '')
    expect(lines(raw)).toEqual(lines(emitted))
    // 서명은 원본 줄에만 있다 — 정규화 로그에는 생각의 본문만이다(E3).
    expect(raw).toContain('"signature"')
    expect(stream).toContain('"type":"reasoning"')
    expect(stream).not.toContain('signature')
  })

  it('opencode — 정확한 생각 시간·줄 번호·일치 개수·종료 코드·권한 거부 공지·카드 안내가 보인다', async () => {
    const app = await launchApp({
      agentPath: FAKE_OPENCODE,
      env: { ONE_DESK_FAKE_SCRIPT: 'events', ONE_DESK_FAKE_STEP_MS: STEP_MS }
    })
    const { page } = app
    await prepare(app, 'ev-opencode')
    // 입력부의 칸은 알약이고 이름은 aria-label이다 — 'Skills / Agents' 패널과 갈리게 exact로 잡는다.
    await page.getByLabel('agent', { exact: true }).selectOption('opencode')
    const turn = await runTurn(page)

    const summary = turn.locator('.turn-summary')
    await summary.waitFor({ state: 'visible', timeout: 5_000 })
    expect(await summary.textContent()).toBe('도구 5회 · 권한 거부 1')

    await turn.getByRole('button', { name: '자세히' }).click()

    // 생각 — opencode는 시각을 준다: CLI가 잰 정확한 시간이라 "약"이 없다(FR-40·48). 어댑터가
    // `--thinking`을 빼면 가짜 opencode가 생각 줄을 내지 않아 이 줄이 없다(FR-21).
    await turn.getByRole('button', { name: '생각 · 2초', exact: true }).click()
    expect(await turn.locator('.tl-reasoning-body').textContent())
      .toBe('만료 경계가 의심스럽다. **테스트부터** 돌려 본다.')

    // 셸과 검색 — 끝난 셸이 1로 끝났으면 종료 코드, opencode grep이 센 것은 일치한 줄이다(FR-43·44).
    await turn.getByRole('button', { name: '2 셸, Grep 사용됨' }).click()
    const rows = turn.locator('.tl-activity .tl-tool')
    expect(await rows.nth(0).textContent()).toBe('셸 pnpm test 종료 코드 1')
    expect(await rows.nth(1).textContent()).toBe('Grep expiresAt (12개 일치)')

    // 편집 — filediff의 unified diff에서 줄 번호가 붙는다(FR-24·47).
    const edit = turn.locator('.tl-edit')
    const file = edit.getByRole('button', { name: /auth\.ts/ })
    expect(await file.textContent()).toContain('+1 −1')
    await file.click()
    expect((await edit.locator('.tl-diff-no').allTextContents()).slice(0, 2)).toEqual(['41', '41'])

    // 권한 거부 — 오류 문구에서 만든 공지가 막힌 도구 바로 아래에 선다(FR-26·41).
    expect(await turn.locator('.tl-notice-line').allTextContents()).toEqual([
      '권한 때문에 막힘: bash (묻는 권한은 헤드리스에서 자동으로 거부됩니다)'
    ])
    expect(await turn.locator('.tl-tool-error').textContent()).toBe('셸 rm -rf build 권한 거부')

    // 하위 에이전트 — OpenCode는 하위 세션의 활동을 내보내지 않는다. 카드는 그렇다고 말한다(FR-49).
    const card = turn.getByRole('button', { name: '하위 에이전트 로그인 흐름 조사' })
    expect(await card.textContent()).toContain('34초 · claude-fake-5')
    await card.click()
    await turn.getByText('OpenCode는 하위 에이전트의 활동을 보내지 않습니다')
      .waitFor({ state: 'visible', timeout: 5_000 })
    expect(await turn.locator('.tl-subagent-children').count()).toBe(0)
  })
})
