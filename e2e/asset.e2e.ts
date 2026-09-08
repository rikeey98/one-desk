import { describe, it, expect } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp } from './driver'

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

    await page.getByPlaceholder('새 workspace 이름…').fill('asset-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: 'asset-ws', exact: true })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    await page.getByPlaceholder('repo 이름').fill('샘플')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가' }).click()

    // 등록이 촉발한 스캔의 결과가 목록에 뜬다.
    const pick = page.getByRole('button', { name: '알파 맥락에 담기' })
    await pick.waitFor({ state: 'visible', timeout: 10_000 })
    await pick.click()

    // 담기면 실행 패널의 칩이 된다.
    await page.getByRole('button', { name: '알파 ✕' })
      .waitFor({ state: 'visible', timeout: 5_000 })

    await page.getByPlaceholder(/무엇을 시킬지/).fill('스킬을 읽어라')
    await page.getByRole('button', { name: '실행', exact: true }).click()

    // 담긴 asset 때문에 조립이나 실행이 깨지지 않는다.
    await page.getByRole('button', { name: /succeeded/ })
      .waitFor({ state: 'visible', timeout: 30_000 })

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
