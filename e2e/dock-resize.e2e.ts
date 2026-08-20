import { describe, it, expect } from 'vitest'
import { launchApp } from './driver'

// **jsdom은 레이아웃을 계산하지 않는다.** 단위 테스트(`renderer/dockHeight.test.ts`,
// `Dock.test.tsx`)는 클램프와 상태 변화까지만 답할 수 있고, "그래서 도크가 실제로
// 커지는가"는 진짜 브라우저 레이아웃에서만 드러난다 — 특히 `.dock-open`의
// flex-basis가 되살아나면 인라인 height가 무시돼 드래그가 아무 효과도 내지 않는데,
// 그 회귀를 잡는 것은 이 파일뿐이다.
describe('도크 크기 조절 (실측)', () => {
  it('핸들을 위로 끌면 도크가 실제로 커지고 더블클릭하면 돌아온다', async () => {
    const app = await launchApp()
    const page = app.page

    await page.getByPlaceholder('새 workspace 이름…').fill('resize-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    await page.getByRole('button', { name: 'resize-ws' }).click()

    const dock = page.locator('.dock')
    const handle = page.getByRole('separator', { name: '대화창 크기 조절' })
    await handle.waitFor({ state: 'visible', timeout: 10_000 })

    const before = (await dock.boundingBox())!.height
    const box = (await handle.boundingBox())!

    // 위로 200px 끈다
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y - 200, { steps: 10 })
    await page.mouse.up()

    const after = (await dock.boundingBox())!.height
    expect(after).toBeGreaterThan(before + 150)

    // 위 영역이 완전히 사라지지 않았는가 (상한이 하는 일)
    const columns = (await page.locator('.columns').boundingBox())!
    expect(columns.height).toBeGreaterThan(0)

    await handle.dblclick()
    const reset = (await dock.boundingBox())!.height
    expect(Math.abs(reset - before)).toBeLessThan(2)
  })
})
