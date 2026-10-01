import { describe, it, expect } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp } from './driver'
import { waitConvStatus } from './dock'

describe('asset 스캔', () => {
  it('repo를 등록하면 발견되고, 담아서 실행하면 한 바퀴가 돈다', async () => {
    const app = await launchApp()
    const page = app.page

    // repo를 등록하기 **전에** 스캔 대상을 만들어 둔다 — 등록이 스캔을 촉발한다.
    const skillDir = join(app.repoDir, '.claude', 'skills', '알파')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: 알파\ndescription: e2e가 심은 스킬\n---\n# 알파 스킬\n'
    )

    // repo 루트의 지시 파일도 등록 스캔이 발견한다 (docs/sdlc/repo-instructions/).
    writeFileSync(join(app.repoDir, 'CLAUDE.md'), '# e2e가 심은 규칙')

    await page.getByPlaceholder('새 workspace 이름…').fill('asset-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: 'asset-ws', exact: true })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    await page.getByRole('button', { name: 'repo 등록' }).click()
    await page.getByPlaceholder('repo 이름').fill('샘플')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가' }).click()

    // 등록이 촉발한 스캔의 결과가 목록에 뜬다.
    const pick = page.getByRole('button', { name: '알파 맥락에 담기' })
    await pick.waitFor({ state: 'visible', timeout: 10_000 })

    // 지시 파일: INSTRUCTIONS 절에 보이고, 담기 버튼은 없고, 이름을 누르면 파일의
    // 지금 내용이 읽기 전용으로 보인다 (FR-7·FR-8·FR-1). 스캔 → 목록 → readBody IPC →
    // 화면까지가 여기 걸려 있다.
    const instruction = page.getByRole('button', { name: 'CLAUDE.md', exact: true })
    await instruction.waitFor({ state: 'visible', timeout: 10_000 })
    expect(await page.getByRole('button', { name: 'CLAUDE.md 맥락에 담기' }).count()).toBe(0)
    await instruction.click()
    // discovered는 읽기(마크다운)로 시작한다 — 원문은 고칠 수 없는 편집칸이다 (item-windows FR-20).
    await page.getByRole('button', { name: '원문 보기', exact: true }).click()
    const body = page.getByRole('textbox', { name: '본문' })
    await expect.poll(() => body.inputValue(), { timeout: 10_000 }).toContain('e2e가 심은 규칙')
    expect(await body.getAttribute('readonly')).not.toBeNull()
    await page.getByRole('button', { name: '축소' }).click()

    await pick.waitFor({ state: 'visible', timeout: 10_000 })
    await pick.click()

    // 담기면 실행 패널의 칩이 된다.
    await page.getByRole('button', { name: '알파 맥락에서 빼기' })
      .waitFor({ state: 'visible', timeout: 5_000 })

    await page.getByPlaceholder(/무엇을 시킬지/).fill('스킬을 읽어라')
    await page.getByRole('button', { name: '실행', exact: true }).click()

    // 담긴 asset 때문에 조립이나 실행이 깨지지 않는다.
    await waitConvStatus(page, null, 'succeeded', 30_000)

    // 새로고침이 실제로 다시 훑는다 — 등록 뒤에 생긴 파일이 뜬다.
    const secondDir = join(app.repoDir, '.claude', 'skills', '베타')
    mkdirSync(secondDir, { recursive: true })
    writeFileSync(join(secondDir, 'SKILL.md'), '---\nname: 베타\n---\n')

    await page.getByRole('button', { name: '새로고침' }).click()
    await expect.poll(
      () => page.getByRole('button', { name: '베타 맥락에 담기' }).count(),
      { timeout: 10_000 }
    ).toBe(1)
  })
})

describe('글로벌 asset', () => {
  it('설정에서 경로를 넣으면 그 skill이 목록에 뜬다', async () => {
    const app = await launchApp()
    const page = app.page

    // repo 밖에 글로벌 skill을 심는다. repoDir와 별개 위치다.
    const globalRoot = join(app.dataDir, 'global-skills')
    mkdirSync(join(globalRoot, '글로벌알파'), { recursive: true })
    writeFileSync(
      join(globalRoot, '글로벌알파', 'SKILL.md'),
      '---\nname: 글로벌알파\ndescription: repo 밖에 있다\n---\n# 본문\n'
    )

    await page.getByPlaceholder('새 workspace 이름…').fill('g-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: 'g-ws', exact: true })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    // repo를 하나도 등록하지 않았다 — 글로벌은 repo와 무관하게 보여야 한다.
    await page.getByRole('button', { name: '설정' }).click()
    // 글로벌 경로는 앱 탭에 있다 — 설정은 실행 탭으로 열린다.
    await page.getByRole('tab', { name: '앱' }).click()
    const claudeBox = page.getByLabel('Claude Code 글로벌 경로')
    await claudeBox.waitFor({ state: 'visible', timeout: 10_000 })
    await claudeBox.fill(globalRoot)
    // exact가 없으면 substring 매칭이라 같은 화면의 "기본값 저장"까지 걸려
    // strict mode 위반이 된다 — 실행 버튼과 도크 토글이 부딪혔던 것과 같은 함정이다.
    await page.getByRole('button', { name: '저장', exact: true }).click()

    // 저장이 스스로 다시 훑는다. workspace로 돌아가면 새로고침 없이 보인다.
    await ws.click()
    await page.getByRole('button', { name: '글로벌알파 맥락에 담기' })
      .waitFor({ state: 'visible', timeout: 15_000 })

    // 출처가 글로벌로 표시된다.
    await expect.poll(
      () => page.getByRole('listitem', { name: '글로벌알파' }).innerText(),
      { timeout: 5_000 }
    ).toContain('글로벌')
  })

  /**
   * **패널이 짧아도 상세가 패널 밖으로 새지 않는다.**
   *
   * `.detail`이 `height: 100%`이던 동안은 칸 높이를 그대로 주장하는데 자식
   * (`.detail-body`의 `min-height: 160px`)은 그 아래로 줄어들 수 없어, 넘치는 만큼이
   * **바깥으로 그려졌다** — 부모는 넘쳤다는 사실을 모르니 스크롤도 안 생긴다.
   * 도크를 높이 끌어 패널이 짧아진 상태에서 사용자가 실제로 보고한 증상이다
   * (칸 143px에 내용 283px).
   *
   * jsdom은 레이아웃을 계산하지 않아 단위 테스트로는 잡을 수 없다.
   */
  it('도크를 높이 끌어 패널이 짧아져도 asset 본문이 패널 밖으로 나가지 않는다', async () => {
    const app = await launchApp()
    const page = app.page

    const skillDir = join(app.repoDir, '.claude', 'skills', '긴것')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: 긴것
description: 본문이 길다
---
${'아주 긴 본문 한 줄. '.repeat(200)}`
    )

    await page.getByPlaceholder('새 workspace 이름…').fill('tall-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: 'tall-ws', exact: true })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    await page.getByRole('button', { name: 'repo 등록' }).click()
    await page.getByPlaceholder('repo 이름').fill('샘플')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가' }).click()

    // 도크를 창의 66%까지 끌어 올린 상태로 다시 연다 — 패널에 200px쯤만 남는다.
    await page.evaluate(
      `localStorage.setItem('one-desk.dockHeight', String(window.innerHeight * 0.66))`
    )
    await page.reload()
    await page.getByRole('button', { name: 'tall-ws', exact: true }).click()

    const opener = page.getByRole('button', { name: '긴것', exact: true })
    await opener.waitFor({ state: 'visible', timeout: 15_000 })
    await opener.click()
    await page.locator('.detail-body').waitFor({ timeout: 10_000 })

    const m = await page.evaluate(`(() => {
      const q = (s) => document.querySelector(s)
      const scroller = q('.panel-expanded .panel-body')
      const detail = q('.detail')
      return {
        // 상세가 칸보다 크다 — 이 조건이 아니면 아래 단언이 아무것도 말하지 않는다.
        detailTaller: detail.getBoundingClientRect().height > scroller.clientHeight + 1,
        // **부모가 넘쳤다는 것을 안다.** height: 100%면 둘이 같아져 false가 된다.
        scrollerKnows: scroller.scrollHeight > scroller.clientHeight + 1,
        // 상세의 바닥이 스크롤 칸의 바닥을 넘지 않는다(잘릴 뿐 밖으로 새지 않는다).
        overflowsBox:
          detail.getBoundingClientRect().bottom
            > scroller.getBoundingClientRect().bottom + scroller.scrollHeight
      }
    })()`) as { detailTaller: boolean; scrollerKnows: boolean; overflowsBox: boolean }

    expect(m.detailTaller).toBe(true)
    expect(m.scrollerKnows).toBe(true)
    expect(m.overflowsBox).toBe(false)
  })
})
