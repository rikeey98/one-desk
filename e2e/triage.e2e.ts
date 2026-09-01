import { describe, it, expect } from 'vitest'
import { launchApp } from './driver'

const ISSUE = '회원 탈퇴 플로우 문의'
// repo 축 회귀를 잡기 위한 두 번째 이슈와 repo. 축 라벨(회의·조사·이번주 등)이나
// 위 이슈 제목과 겹치면 규칙 매칭이 strict mode 위반으로 깨지므로 겹치지 않는
// 단어를 고른다.
const ISSUE2 = '결제 실패 로그 확인'
const REPO_NAME = '물류허브'

describe('이슈 훑기', () => {
  it('던지고 훑으면 해당 그룹에 나타난다', async () => {
    // 여기서 try/finally { await app.close() }로 직접 닫지 않는다. smoke.e2e.ts와
    // 같은 이유다 — launchApp()이 onTestFinished로 정리를 스스로 예약하므로
    // 테스트는 아무것도 닫지 않는다.
    const app = await launchApp()
    const page = app.page

    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-triage')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: /^e2e-triage$/ })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    // 던질 땐 제목만이다
    await page.getByPlaceholder('새 이슈 제목…').fill(ISSUE)
    await page.getByPlaceholder('새 이슈 제목…').press('Enter')

    const banner = page.getByText('⚠ 정리 안 됨 (1)')
    await banner.waitFor({ state: 'visible', timeout: 10_000 })

    // 훑기는 상세 자리를 빌려 쓴다 — 패널이 확장되면서 카드가 뜬다
    await page.getByRole('button', { name: '훑어보기', exact: true }).click()
    const next = page.getByRole('button', { name: '다음', exact: true })
    await next.waitFor({ state: 'visible', timeout: 5_000 })

    // 축이 덜 찍힌 동안은 막혀 있다
    expect(await next.isDisabled()).toBe(true)

    await page.getByRole('button', { name: '회의', exact: true }).click()
    await page.getByRole('button', { name: '조사', exact: true }).click()
    await page.getByRole('button', { name: '이번주', exact: true }).click()
    expect(await next.isDisabled()).toBe(false)
    await next.click()

    // 대기열이 비면 배너가 사라진다 — 0건을 그리지 않는다
    await banner.waitFor({ state: 'detached', timeout: 5_000 })

    // 그리고 그 이슈가 '이번주' 그룹 안에 있다
    const group = page.getByRole('button', { name: /이번주 \(1\)/ })
    await group.waitFor({ state: 'visible', timeout: 5_000 })

    // 축을 바꾸면 다시 묶인다 — App.tsx가 repos를 안 내려보내면 여기서 깨진다.
    // 하지만 'kind' 축은 groupIssues()가 repos 배열을 아예 읽지 않는 경로라
    // repos가 빈 배열이어도 이 단언은 통과해버린다(실측 확인). repos 배열의
    // 내용이 실제로 쓰이는 것은 axis === 'repo'일 때뿐이므로, repos prop 자체를
    // 지키는 가드는 아래 repo 축 단언이다.
    await page.getByLabel('묶기').selectOption('kind')
    await page.getByRole('button', { name: /조사 \(1\)/ })
      .waitFor({ state: 'visible', timeout: 5_000 })

    // repo 축은 groupIssues()가 repos 배열의 이름·순서를 직접 읽는 유일한 경로다
    // — repo를 등록하고 태그된 이슈로 그 경로를 실제로 태운다.
    // repo 등록은 core-loop.e2e.ts와 같은 관용구를 그대로 쓴다: 작업 디렉토리는
    // launchApp()이 만들어준 실제 임시 디렉토리(app.repoDir)여야 한다 — repo의
    // path가 cwd로 쓰이므로 존재하지 않는 경로를 넣으면 등록 자체가 의미 없다.
    await page.getByPlaceholder('repo 이름').fill(REPO_NAME)
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가' }).click()
    // repo 이름은 카드와 "맥락에 담기" 버튼 양쪽에 나온다. 카드에만 있는
    // aria-label로 기다려 등록이 반영됐음을 확인한다(core-loop.e2e.ts와 동일).
    await page.getByRole('button', { name: `${REPO_NAME} 맥락에 담기` })
      .waitFor({ state: 'visible', timeout: 10_000 })

    // repo 카드를 눌러 작업 디렉토리로 고른다. 카드 버튼의 접근성 이름은
    // "{이름}{경로}"로 이어져 있어(공백 없이 붙는다) getByRole로 이름만 잡으면
    // "맥락에 담기" 버튼과도 겹쳐 strict mode 위반이 난다. RepoStrip.test.tsx의
    // 단위 테스트가 쓰는 것과 같은 방법 — repo-name span의 텍스트 노드를 정확히
    // 짚어 클릭한다. 클릭은 버블링으로 감싸는 button의 onSelect까지 닿는다.
    await page.getByText(REPO_NAME, { exact: true }).click()

    // repo가 선택된 채로 이슈를 던지면 IssuePanel.addIssue가 그 repoId를
    // repoIds에 실어 보낸다 — 이것이 "repo가 선택된 채로 이슈를 만든다"는
    // 자연스러운 사용자 흐름이다.
    await page.getByPlaceholder('새 이슈 제목…').fill(ISSUE2)
    await page.getByPlaceholder('새 이슈 제목…').press('Enter')
    const issue2 = page.getByRole('button', { name: ISSUE2, exact: true })
    await issue2.waitFor({ state: 'visible', timeout: 10_000 })

    // repo 축으로 묶으면 repo의 "이름"이 그룹 헤더로 보인다 — 이 이름은
    // App.tsx가 IssuePanel에 내려보내는 repos 배열에서만 올 수 있다.
    await page.getByLabel('묶기').selectOption('repo')
    await page.getByRole('button', { name: new RegExp(`${REPO_NAME} \\(1\\)`) })
      .waitFor({ state: 'visible', timeout: 5_000 })
  })
})
