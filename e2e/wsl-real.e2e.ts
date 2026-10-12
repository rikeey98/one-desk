import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright-core'
import { launchApp } from './driver'
import { waitConvStatus } from './dock'

/**
 * WSL repo 실측 (docs/sdlc/wsl-support/ spec §4-B). `wsl.e2e.ts`가 가짜 wsl.exe로 본 것을 **진짜 WSL과 진짜 claude**로 본다 —
 * 등록 · 실행 환경 저장 · CLI 상태 · `@` 목록(WSL 안의 git) · 코드 칸(UNC 읽기) · 터미널(WSL 셸) · MCP 도구와 `@` 멘션 ·
 * 큰 출력 · 취소 뒤 남는 프로세스 · 앱 종료 뒤 남는 프로세스(WSL은 cwd로, Windows는 데이터 폴더를 품은 명령줄로 찾는다).
 *
 * 가짜로는 못 잡는 것을 잡으려고 있다 — v0.24.0·v0.25.0은 wsl.exe를 `--`로 띄워 모든 WSL run이 시작조차 못 했는데, 가짜
 * wsl.exe가 인자를 배열 그대로 띄워 단위·e2e가 전부 초록이었다. 이 테스트의 첫 실행이 그것을 찾았다(2026-10-12).
 *
 * 선택 실행이다: `ONE_DESK_REAL_WSL=1`, 배포판은 `ONE_DESK_REAL_WSL_DISTRO`(기본 Ubuntu-24.04). WSL 안의 claude가 로그인돼
 * 있어야 하고 실제 모델 호출을 세 번 한다. 관찰한 것은 단계마다 기록하고(하나가 실패해도 다음 단계를 본다) 로그와 함께
 * `ONE_DESK_REAL_WSL_OUT`(기본 e2e/artifacts/wsl-real-<시각>)에 남긴다.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const DISTRO = process.env['ONE_DESK_REAL_WSL_DISTRO'] ?? 'Ubuntu-24.04'
const STAMP = Date.now()
const LINUX_REPO = `/tmp/onedesk-real-${STAMP}`
const UNC_REPO = `\\\\wsl$\\${DISTRO}${LINUX_REPO.replaceAll('/', '\\')}`
const OUT = process.env['ONE_DESK_REAL_WSL_OUT'] ?? resolve(HERE, 'artifacts', `wsl-real-${STAMP}`)
const REPO_NAME = '프로브'
/**
 * 취소 단계에서 ps로 찾는 표식. Claude Code는 단독 `sleep N`을 스스로 막는다(`Blocked: standalone sleep`, 2.1.296 실측) —
 * 그래서 python3로 잔다.
 */
const CANCEL_MARK = 'onedesk-cancel-probe'

/** WSL 안에서 bash 한 줄 — 앱과 별개의 관찰 통로다. wsl.exe가 실패하면 던진다(빈 출력을 "남은 것 없음"으로 읽지 않게) */
function wsl(command: string): string {
  const r = spawnSync('wsl.exe', ['-d', DISTRO, '--exec', 'bash', '-c', command], { encoding: 'utf8', timeout: 30_000 })
  if (r.error || r.status !== 0) throw new Error(`관찰용 wsl.exe 실패 (${r.status}): ${r.error?.message ?? r.stderr}`)
  return (r.stdout ?? '').trim()
}

/**
 * 이 테스트가 WSL에 띄운 프로세스 — **cwd가 테스트 repo 아래**이거나(claude · Bash 도구의 셸과 손자 · 터미널 셸) 취소 표식을
 * 품은 것. 그룹·세션으로 고르지 않는다: Bash 도구는 자식을 다른 그룹에 두고(실측) 터미널 셸은 런처가 `exec`로 사라져 명령줄에
 * 아무 표식도 없다. 사용자가 따로 띄운 claude 세션은 cwd가 달라 섞이지 않는다. 찾는 문자열은 쪼개 둔다 — 스캔하는 bash 자신의
 * 명령줄이 그 문자열을 품으면 자기를 찾는다. 한 줄이 `<pid> [<cwd>] <명령줄>`이다.
 */
function wslOurs(): string {
  return wsl([
    `r=/tmp/onedesk-real-; s=${STAMP}; m1=onedesk-cancel; m2=-probe`,
    `for p in /proc/[0-9]*; do n=\${p#/proc/}; [ "$n" = "$$" ] && continue`,
    `c=$(readlink "$p/cwd" 2>/dev/null) || continue; a=$(tr '\\0' ' ' < "$p/cmdline" 2>/dev/null)`,
    `case "$c $a" in *"$r$s"*|*"$m1$m2"*) echo "$n [$c] $a";; esac; done; true`
  ].join('; '))
}
const pidsOf = (scan: string) => new Set(scan.split('\n').filter(Boolean).map((l) => l.split(' ')[0]!))

/**
 * 이 앱이 Windows에 띄운 MCP 브리지 — 명령줄에 데이터 폴더와 `.bridge.`를 같이 품은 것(`cmd.exe /c <dataDir>\mcp\<run>.bridge.cmd`와
 * 그것이 띄운 Electron 브리지의 `<run>.bridge.json`). 데이터 폴더만 보면 앱 자신의 Chromium 자식(`--user-data-dir=…`)이 걸린다.
 * 찾는 문자열은 쪼개 둔다(위와 같은 이유).
 */
function winOurs(dataDir: string): string {
  const name = basename(dataDir)
  const half = Math.floor(name.length / 2)
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    `$n = '${name.slice(0, half)}' + '${name.slice(half)}'; $b = '.bri' + 'dge.'; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($n) -and $_.CommandLine.Contains($b) } | ForEach-Object { "$($_.ProcessId) $($_.Name) $($_.CommandLine)" }`
  ], { encoding: 'utf8', timeout: 30_000 })
  if (r.error || r.status !== 0) throw new Error(`관찰용 powershell 실패 (${r.status}): ${r.error?.message ?? r.stderr}`)
  return (r.stdout ?? '').trim()
}

type Step = { ok: boolean; note?: string; error?: string; [k: string]: unknown }

describe.skipIf(process.env['ONE_DESK_REAL_WSL'] !== '1')('WSL 실측 (진짜 wsl.exe · 진짜 claude)', () => {
  it('등록부터 앱 종료까지', async () => {
    mkdirSync(OUT, { recursive: true })
    const steps: Record<string, Step> = {}
    const step = async (name: string, body: () => Promise<Record<string, unknown> | void>) => {
      const started = Date.now()
      try {
        const extra = (await body()) ?? {}
        steps[name] = { ok: true, ms: Date.now() - started, ...extra }
      } catch (err) {
        // 던진 오류에 붙인 관찰값(취소 전후의 프로세스 등)도 남긴다
        const extra = err instanceof Error ? { ...err } : {}
        steps[name] = { ok: false, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err), ...extra }
      }
      console.log(`[wsl-real] ${name}: ${steps[name]!.ok ? 'ok' : 'FAIL'}`)
    }

    // 0. WSL 안에 임시 git repo
    steps['repo-setup'] = {
      ok: true,
      output: wsl([
        `set -e; mkdir -p ${LINUX_REPO}/src; cd ${LINUX_REPO}; git init -q`,
        `echo hello > README.md; echo 'export const x = 1' > src/a.ts`,
        `git add .; git -c user.name=probe -c user.email=probe@example.invalid commit -qm init; git ls-files`
      ].join('; '))
    }

    // 진짜 CLI: ONE_DESK_AGENT_PATH를 비워야 가짜 CLI가 이기지 않는다 (CLAUDE.md)
    const app = await launchApp({ agentPath: '' })
    // 중간에 무엇이 던져도 기록·로그·임시 repo 정리는 남는다
    try {
      const page: Page = app.page
      const shot = (name: string) => page.screenshot({ path: join(OUT, `${name}.png`) }).catch(() => {})
      const ws = page.getByRole('button', { name: 'wsl-real', exact: true })
      const prompt = page.getByRole('textbox', { name: '지시', exact: true })
      const lastAnswer = async () => (await page.locator('.turn-answer').allInnerTexts()).at(-1) ?? null
      /** 터미널을 연 뒤의 WSL 프로세스 — 그 셸은 앱이 끝날 때까지 산다. 취소 단계는 이것을 빼고 본다 */
      let baseline = new Set<string>()

      await step('1-register', async () => {
        await page.getByPlaceholder('새 workspace 이름…').fill('wsl-real')
        await page.getByPlaceholder('새 workspace 이름…').press('Enter')
        await ws.waitFor({ timeout: 10_000 })
        await ws.click()
        await page.getByRole('button', { name: 'repo 등록' }).click()
        await page.getByPlaceholder('repo 이름').fill(REPO_NAME)
        await page.getByPlaceholder('/절대/경로').fill(UNC_REPO)
        await page.getByRole('button', { name: '추가', exact: true }).click()
        await page.getByRole('button', { name: `${REPO_NAME} repo`, exact: true }).waitFor({ timeout: 15_000 })
        return { path: UNC_REPO }
      })

      await step('2-env-wsl', async () => {
        await page.getByRole('button', { name: '설정' }).click()
        await page.getByRole('tab', { name: 'repo' }).click()
        const group = page.getByRole('radiogroup', { name: `${REPO_NAME} claude 실행 환경` })
        await group.waitFor({ timeout: 10_000 })
        await group.getByRole('radio', { name: 'WSL' }).check()
        const parsed = page.getByText(`배포판 ${DISTRO} · ${LINUX_REPO}`)
        await parsed.waitFor({ timeout: 10_000 })
        await page.getByRole('button', { name: `${REPO_NAME} 저장`, exact: true }).click()
        await shot('2-repo-tab')
        return { parsed: await parsed.innerText() }
      })

      await step('3-cli-status', async () => {
        await page.getByRole('tab', { name: '실행' }).click()
        const row = page.getByRole('list', { name: 'CLI 상태' }).locator('li').filter({ hasText: `(WSL · ${DISTRO})` })
        await row.waitFor({ timeout: 30_000 })
        // 실행 파일 → 인증 → 모델 칸이 다 찰 때까지. 저장이 판정을 다시 돌리므로(SettingsPanel의 saveRepo) 몇 초면 된다 —
        // 그 배선이 없던 v0.25.0은 27초·62초·90초 넘게 "확인 중"이었다
        await expect.poll(async () => (await row.getAttribute('class')) !== 'settings-status-wait', { timeout: 30_000 }).toBe(true)
        await page.waitForTimeout(3_000)
        await shot('3-cli-status')
        const list = await page.getByRole('list', { name: 'CLI 상태' }).innerText()
        const cls = await row.getAttribute('class')
        if (cls !== 'settings-status-ok') throw new Error(`WSL 줄이 준비되지 않았다 (${cls}): ${await row.innerText()}`)
        return { rowClass: cls, list }
      })

      await ws.click()

      await step('4-mention-list', async () => {
        await prompt.fill('@READ')
        await page.getByRole('option', { name: 'README.md', exact: true }).waitFor({ timeout: 30_000 })
        await prompt.fill('@src')
        await page.getByRole('option', { name: 'src/a.ts', exact: true }).waitFor({ timeout: 15_000 })
        await prompt.fill('')
      })

      // 코드 칸 — 트리는 WSL 안의 git, 파일 읽기는 Windows가 UNC로 (FR-25·26)
      await step('4b-code-pane', async () => {
        await page.getByRole('button', { name: '파일', exact: true }).click()
        const pane = page.getByRole('region', { name: '코드 칸' })
        await pane.locator('.code-tree').getByRole('button', { name: 'README.md', exact: true }).click({ timeout: 30_000 })
        await expect.poll(async () => (await pane.locator('.cm-content').innerText()).includes('hello'), { timeout: 15_000 }).toBe(true)
        await shot('4b-code-pane')
        await page.getByRole('button', { name: '파일', exact: true }).click()
      })

      const terminal = page.getByRole('region', { name: '터미널 칸' })
      await step('5-terminal', async () => {
        await page.getByRole('button', { name: '터미널', exact: true }).click()
        const rows = terminal.locator('.xterm-rows')
        await rows.waitFor({ timeout: 30_000 })
        // 셸이 조용해질 때까지 (terminal.e2e의 waitShellIdle과 같은 판정)
        let last = ''
        let since = Date.now()
        await expect.poll(async () => {
          const now = await rows.innerText()
          if (now !== last) { last = now; since = Date.now() }
          return now.trim() !== '' && Date.now() - since >= 1500
        }, { timeout: 30_000, interval: 250 }).toBe(true)
        await terminal.locator('.xterm').click()
        await page.keyboard.type('echo "wsl-$((40+2))"; uname -r; pwd')
        await page.keyboard.press('Enter')
        await expect.poll(async () => (await rows.innerText()).includes('wsl-42'), { timeout: 20_000 }).toBe(true)
        await page.waitForTimeout(1_000)
        await shot('5-terminal')
        const text = await terminal.innerText()
        if (!text.includes('microsoft-standard-WSL2')) throw new Error('uname이 WSL2 커널이 아니다')
        if (!text.includes(LINUX_REPO)) throw new Error('셸의 작업 디렉토리가 repo가 아니다')
        // 셸이 보여야 이 통로가 터미널을 본다는 증거다 — 9단계의 "앱을 끄면 셸도 없다"가 빈 스캔으로 거저 통과하지 않게
        const scan = wslOurs()
        baseline = pidsOf(scan)
        if (baseline.size === 0) throw new Error('터미널 셸이 WSL 스캔에 보이지 않는다')
        return { text, scan }
      })
      // 코드 칸을 닫아 대화창을 넓힌다 (셸은 core에서 계속 돈다)
      await page.getByRole('button', { name: '터미널', exact: true }).click().catch(() => {})

      await step('6-turn-mcp', async () => {
        await page.getByLabel('권한').selectOption('read_only')
        // `@README.md` — 보낼 때 core가 멘션을 해석해 그 파일을 UNC로 읽어 싣는다(realpath의 UNC 형태 접기, FR-26)
        await prompt.fill('@README.md Call the list_issues tool of the "one-desk" MCP server exactly once with no arguments. Do not use any other tool. Then reply with exactly one line: MCP_OK count=<number of issues returned> readme=<the single word inside the attached README.md>')
        await page.getByRole('button', { name: '실행', exact: true }).click()
        await waitConvStatus(page, REPO_NAME, ['succeeded', 'failed', 'canceled', 'interrupted'], 240_000)
        await page.locator('.turn-user').first().waitFor()
        await shot('6-turn-mcp')
        const answer = await lastAnswer()
        const ok = await page.locator('.dock-conv .status-dot.status-succeeded').count()
        if (!ok) throw new Error(`턴이 성공하지 못했다: ${answer}`)
        if (!answer?.includes('MCP_OK')) throw new Error(`MCP 답이 아니다: ${answer}`)
        if (!answer.includes('readme=hello')) throw new Error(`멘션한 파일이 실리지 않았다: ${answer}`)
        const chip = await page.locator('.applied-chip', { hasText: '파일 · README.md' }).count()
        if (!chip) throw new Error('대화 헤더의 담긴 것에 README.md가 없다')
        return { answer }
      })

      await step('7-turn-big-output', async () => {
        await page.getByLabel('권한').selectOption('full')
        await prompt.fill('Use the Bash tool to run exactly this command and nothing else: seq 1 60000\nThen reply with exactly one line: BIG_OK')
        await page.getByRole('button', { name: '실행', exact: true }).click()
        await waitConvStatus(page, REPO_NAME, 'running', 60_000)
        await waitConvStatus(page, REPO_NAME, ['succeeded', 'failed', 'canceled', 'interrupted'], 240_000)
        await shot('7-turn-big')
        const answer = await lastAnswer()
        if (!answer?.includes('BIG_OK')) throw new Error(`답이 BIG_OK가 아니다: ${answer}`)
        return { answer }
      })

      await step('8-cancel', async () => {
        await prompt.fill(`Use the Bash tool to run exactly this command and nothing else, in the foreground (it is a deliberate long-running test process): python3 -c "import time; time.sleep(300)" ${CANCEL_MARK}`)
        await page.getByRole('button', { name: '실행', exact: true }).click()
        await waitConvStatus(page, REPO_NAME, 'running', 60_000)
        let seen = ''
        await expect.poll(() => { seen = wslOurs(); return seen.includes('time.sleep(300)') }, { timeout: 180_000, interval: 2_000 }).toBe(true)
        const before = seen
        // 이 run이 새로 띄운 것 — 터미널 셸(기준선)을 뺀 claude · Bash 도구의 셸 · python
        const spawned = [...pidsOf(before)].filter((pid) => !baseline.has(pid))
        // 브리지가 Windows 쪽에 보여야 "취소 뒤 없다"가 의미 있다
        const winBefore = winOurs(app.dataDir)
        const pidfilesBefore = existsSync(join(app.dataDir, 'wsl')) ? readdirSync(join(app.dataDir, 'wsl')) : []
        await page.getByRole('button', { name: '중지', exact: true }).click()
        const clicked = Date.now()
        await waitConvStatus(page, REPO_NAME, 'canceled', 60_000)
        const canceledMs = Date.now() - clicked
        let left: string[] = spawned
        let winAfter = winBefore
        let clearedMs: number | null = null
        try {
          await expect.poll(() => {
            const now = pidsOf(wslOurs())
            left = spawned.filter((pid) => now.has(pid))
            winAfter = winOurs(app.dataDir)
            return left.length === 0 && winAfter === ''
          }, { timeout: 20_000, interval: 1_000 }).toBe(true)
          clearedMs = Date.now() - clicked
        } catch { /* 남은 것을 그대로 기록한다 */ }
        const pidfilesAfter = existsSync(join(app.dataDir, 'wsl')) ? readdirSync(join(app.dataDir, 'wsl')) : []
        await shot('8-cancel')
        const result = { before, spawned, winBefore, left, winAfter, canceledMs, clearedMs, pidfilesBefore, pidfilesAfter }
        if (spawned.length === 0) throw Object.assign(new Error('이 run의 프로세스가 WSL 스캔에 보이지 않는다'), result)
        if (winBefore === '') throw Object.assign(new Error('MCP 브리지가 Windows 쪽에 보이지 않는다 — 감지 통로를 믿을 수 없다'), result)
        if (left.length > 0 || winAfter !== '') throw Object.assign(new Error('취소 뒤 프로세스가 남았다'), result)
        return result
      })
    } finally {
      // 로그를 남긴다 — close가 dataDir을 지운다
      try { cpSync(join(app.dataDir, 'logs'), join(OUT, 'logs'), { recursive: true }) } catch { /* 없으면 없다 */ }
      const pidfilesAtClose = existsSync(join(app.dataDir, 'wsl')) ? readdirSync(join(app.dataDir, 'wsl')) : []
      await app.close()
      // 앱 종료(cancelAll·터미널의 동기 그룹 KILL) 뒤 — 터미널 셸까지 WSL에, 브리지가 Windows에 남지 않는다
      let wslLeft = ''
      let winLeft = ''
      try {
        await expect.poll(() => {
          wslLeft = wslOurs()
          winLeft = winOurs(app.dataDir)
          return wslLeft === '' && winLeft === ''
        }, { timeout: 15_000, interval: 1_000 }).toBe(true)
      } catch { /* 남은 것을 기록한다 */ }
      steps['9-after-app-close'] = { ok: wslLeft === '' && winLeft === '', pidfilesAtClose, wslLeft, winLeft }
      let cleanup = ''
      try { cleanup = wsl(`rm -rf ${LINUX_REPO} && echo removed`) } catch (err) { cleanup = String(err) }
      steps['cleanup'] = { ok: cleanup === 'removed', output: cleanup }
      writeFileSync(join(OUT, 'observations.json'), JSON.stringify({ distro: DISTRO, repo: UNC_REPO, steps }, null, 2))
      console.log(`[wsl-real] 기록: ${OUT}`)
    }
    expect(Object.entries(steps).filter(([, s]) => !s.ok).map(([k]) => k)).toEqual([])
  }, 1_200_000)
})
