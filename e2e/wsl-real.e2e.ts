import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright-core'
import { launchApp } from './driver'
import { waitConvStatus } from './dock'

/**
 * WSL repo 실측 (docs/sdlc/wsl-support/ spec §4-B·§4-C). `wsl.e2e.ts`가 가짜 wsl.exe로 본 것을 **진짜 WSL과 진짜 claude**로 본다 —
 * 등록 · 실행 환경 저장 · CLI 상태 · `@` 목록(WSL 안의 git) · 코드 칸(UNC 읽기) · 터미널(WSL 셸) · MCP 도구와 `@` 멘션 ·
 * 큰 출력 · 취소 뒤 남는 프로세스 · 터미널 백그라운드 작업(다시 시작·앱 종료 뒤) · 앱 종료 뒤 남는 프로세스(WSL은 cwd로, Windows는
 * 데이터 폴더를 품은 명령줄로 찾는다). 데이터 폴더 이름은 적대적이다(한글·공백·`&^%!()` — §4-C).
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
 * 터미널에서 띄우는 백그라운드 작업 다섯 모양 — `&` · `nohup` · `( … &)` · `sh -c` 안의 자식 · `disown`. 전부 셸과 **같은 세션**이고
 * 각자 다른 그룹이라 그룹 KILL은 하나도 못 맞혔다(§4-C 실측). `setsid`는 넣지 않는다 — 세션을 떠난 것은 남는 것이 설계다(FR-30).
 * 수가 작아(1201초 남짓) 실패한 실행이 남긴 것도 저절로 끝난다.
 */
const bgLine = (n: number) => `sleep ${n}1 & nohup sleep ${n}2 >/dev/null 2>&1 & (sleep ${n}3 &); sh -c 'sleep ${n}4; true' & sleep ${n}5 & disown`
const bgMarks = (n: number) => [1, 2, 3, 4, 5].map((k) => `sleep ${n}${k}`)
const jobPids = (scan: string, n: number) =>
  scan.split('\n').filter((l) => bgMarks(n).some((m) => l.includes(m))).map((l) => l.split(' ')[0]!)

/** 사용자 폴더 이름에 올 수 있는 글자를 섞은 데이터 폴더 — cmd.exe를 거치던 v0.25.0까지의 브리지가 여기서 쪼개졌다(§4-C) */
const HOSTILE_DATA_DIR = 'one-desk-e2e-data-홍 a&b^c%PATH%!(x)-'

/**
 * 이 앱이 Windows에 띄운 MCP 브리지 — 명령줄에 데이터 폴더와 `.bridge.`를 같이 품은 것(claude가 interop으로 띄운
 * `"<electron>" "<bridge.mjs>" "<dataDir>\mcp\<run>.bridge.json"` — v0.25.0까지는 그 앞에 `cmd.exe /c …bridge.cmd`가 있었다). 데이터
 * 폴더만 보면 앱 자신의 Chromium 자식(`--user-data-dir=…`)이 걸린다. 찾는 문자열은 쪼개 둔다(위와 같은 이유). 출력은 UTF-8로 받는다 —
 * PowerShell 5.1은 파이프에 OEM 코드 페이지로 써 데이터 폴더의 한글이 깨진다.
 */
function winOurs(dataDir: string): string {
  const name = basename(dataDir)
  const half = Math.floor(name.length / 2)
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    `[Console]::OutputEncoding = [Text.Encoding]::UTF8; $n = '${name.slice(0, half)}' + '${name.slice(half)}'; $b = '.bri' + 'dge.'; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($n) -and $_.CommandLine.Contains($b) } | ForEach-Object { "$($_.ProcessId) $($_.Name) $($_.CommandLine)" }`
  ], { encoding: 'utf8', timeout: 30_000 })
  if (r.error || r.status !== 0) throw new Error(`관찰용 powershell 실패 (${r.status}): ${r.error?.message ?? r.stderr}`)
  return (r.stdout ?? '').trim()
}

/**
 * 디렉토리를 통째로 복사한다. **`fs.cpSync`를 쓰지 않는다** — Node 22(22.23.2 실측)의 `cpSync`는 Windows에서 원본 경로에 한글이
 * 있으면 접근 위반(0xC0000005)으로 프로세스째 죽는다. 이 테스트의 데이터 폴더가 일부러 한글 이름이라 vitest 워커가 아무 말 없이
 * 죽고 앱·터미널이 고아로 남았다. `copyFileSync`(libuv)는 괜찮다.
 */
function copyDir(from: string, to: string): void {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name)
    const dst = join(to, entry.name)
    if (entry.isDirectory()) copyDir(src, dst)
    else copyFileSync(src, dst)
  }
}

type Step = { ok: boolean; note?: string; error?: string; [k: string]: unknown }

describe.skipIf(process.env['ONE_DESK_REAL_WSL'] !== '1')('WSL 실측 (진짜 wsl.exe · 진짜 claude)', () => {
  it('등록부터 앱 종료까지', async () => {
    mkdirSync(OUT, { recursive: true })
    const steps: Record<string, Step> = {}
    // 진행 기록은 파일에 곧바로 쓴다 — 테스트 워커가 죽으면 콘솔 출력은 함께 사라진다
    const progress = (line: string) => { try { appendFileSync(join(OUT, 'progress.log'), `${new Date().toISOString()} ${line}\n`) } catch { /* 기록일 뿐 */ } }
    const step = async (name: string, body: () => Promise<Record<string, unknown> | void>) => {
      const started = Date.now()
      progress(`start ${name}`)
      try {
        const extra = (await body()) ?? {}
        steps[name] = { ok: true, ms: Date.now() - started, ...extra }
      } catch (err) {
        // 던진 오류에 붙인 관찰값(취소 전후의 프로세스 등)도 남긴다
        const extra = err instanceof Error ? { ...err } : {}
        steps[name] = { ok: false, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err), ...extra }
      }
      console.log(`[wsl-real] ${name}: ${steps[name]!.ok ? 'ok' : 'FAIL'}`)
      progress(`end ${name} ${steps[name]!.ok ? 'ok' : `FAIL ${steps[name]!.error ?? ''}`}`)
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

    // 진짜 CLI: ONE_DESK_AGENT_PATH를 비워야 가짜 CLI가 이기지 않는다 (CLAUDE.md). 데이터 폴더는 적대적인 이름이다 — MCP 설정·인자
    // 파일·pidfile·wslpath의 userData 접두사가 전부 그 아래다
    const app = await launchApp({ agentPath: '', dataDirPrefix: HOSTILE_DATA_DIR })
    steps['data-dir'] = { ok: true, dataDir: app.dataDir }
    /** 앱을 끌 때 셸과 함께 끝나야 하는 백그라운드 작업 (5c) — finally가 본다 */
    let bgAtClose: string[] = []
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
        // 진짜 배포판 목록을 받은 폼만 WSL 버튼을 세운다 — 대화상자는 누를 수 없어 경로는 친다(wsl-repo-setup FR-1·3)
        await page.getByRole('button', { name: 'WSL 폴더 고르기' }).waitFor({ timeout: 15_000 })
        await page.getByPlaceholder('/절대/경로').fill(UNC_REPO)
        // WSL 폴더면 체크가 켜진 채 온다 — 설정에 가서 바꾸지 않아도 WSL repo로 등록된다
        const check = page.getByRole('checkbox', { name: 'WSL 안의 claude로 실행' })
        if (!(await check.isChecked())) throw new Error('WSL 폴더인데 체크가 꺼져 있다')
        await shot('1-register-form')
        await page.getByRole('button', { name: '추가', exact: true }).click()
        await page.getByRole('button', { name: `${REPO_NAME} repo`, exact: true }).waitFor({ timeout: 15_000 })
        return { path: UNC_REPO }
      })

      await step('2-env-wsl', async () => {
        await page.getByRole('button', { name: '설정' }).click()
        await page.getByRole('tab', { name: 'repo' }).click()
        const group = page.getByRole('radiogroup', { name: `${REPO_NAME} claude 실행 환경` })
        await group.waitFor({ timeout: 10_000 })
        if (!(await group.getByRole('radio', { name: 'WSL' }).isChecked())) throw new Error('등록했는데 repo 탭의 실행 환경이 WSL이 아니다')
        const parsed = page.getByText(`배포판 ${DISTRO} · ${LINUX_REPO}`)
        await parsed.waitFor({ timeout: 10_000 })
        await shot('2-repo-tab')
        return { parsed: await parsed.innerText() }
      })

      // WSL 탭 — 진짜 배포판 목록과 진짜 WSL claude 상태가 한곳에 (wsl-repo-setup FR-8)
      await step('2b-wsl-tab', async () => {
        await page.getByRole('tab', { name: 'WSL', exact: true }).click()
        await page.getByRole('list', { name: 'WSL 배포판' }).getByText(DISTRO, { exact: true }).waitFor({ timeout: 15_000 })
        const row = page.getByRole('list', { name: 'WSL claude 상태' }).locator('li')
        await expect.poll(async () => (await row.getAttribute('class')) !== 'settings-status-wait', { timeout: 30_000 }).toBe(true)
        await page.getByRole('list', { name: 'WSL repo' }).getByText(REPO_NAME, { exact: true }).waitFor({ timeout: 10_000 })
        await shot('2b-wsl-tab')
        return { rowClass: await row.getAttribute('class') }
      })

      await step('3-cli-status', async () => {
        await page.getByRole('tab', { name: '실행' }).click()
        const row = page.getByRole('list', { name: 'CLI 상태' }).locator('li').filter({ hasText: `(WSL · ${DISTRO})` })
        await row.waitFor({ timeout: 30_000 })
        // 실행 파일 → 인증 → 모델 칸이 다 찰 때까지. 등록이 WSL repo를 곧바로 만들므로 설정을 여는 순간 판정이 돈다 — 2b가 이미
        // 기다렸다. (repo 탭에서 바꾸던 v0.25.0은 저장이 판정을 다시 돌리는 배선이 없어 27초·62초·90초 넘게 "확인 중"이었다)
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
      const rows = terminal.locator('.xterm-rows')
      /** 셸이 조용해질 때까지 (terminal.e2e의 waitShellIdle과 같은 판정) */
      const waitShellIdle = async () => {
        let last = ''
        let since = Date.now()
        await expect.poll(async () => {
          const now = await rows.innerText()
          if (now !== last) { last = now; since = Date.now() }
          return now.trim() !== '' && Date.now() - since >= 1500
        }, { timeout: 30_000, interval: 250 }).toBe(true)
      }
      const typeLine = async (line: string) => {
        await terminal.locator('.xterm').click()
        await page.keyboard.type(line)
        await page.keyboard.press('Enter')
      }

      await step('5-terminal', async () => {
        await page.getByRole('button', { name: '터미널', exact: true }).click()
        await rows.waitFor({ timeout: 30_000 })
        await waitShellIdle()
        await typeLine('echo "wsl-$((40+2))"; uname -r; pwd')
        await expect.poll(async () => (await rows.innerText()).includes('wsl-42'), { timeout: 20_000 }).toBe(true)
        await page.waitForTimeout(1_000)
        await shot('5-terminal')
        const text = await terminal.innerText()
        if (!text.includes('microsoft-standard-WSL2')) throw new Error('uname이 WSL2 커널이 아니다')
        if (!text.includes(LINUX_REPO)) throw new Error('셸의 작업 디렉토리가 repo가 아니다')
        // 셸이 보여야 이 통로가 터미널을 본다는 증거다 — 9단계의 "앱을 끄면 셸도 없다"가 빈 스캔으로 거저 통과하지 않게
        const scan = wslOurs()
        if (pidsOf(scan).size === 0) throw new Error('터미널 셸이 WSL 스캔에 보이지 않는다')
        return { text, scan }
      })

      // 셸 다시 시작(비동기 세션 KILL)이 셸의 백그라운드 작업까지 끝낸다 (FR-30, §4-C — 그룹 KILL이던 v0.25.0까지는 남았다)
      await step('5b-terminal-restart-bg', async () => {
        await waitShellIdle()
        await typeLine(bgLine(121))
        let before = ''
        await expect.poll(() => { before = wslOurs(); return bgMarks(121).every((m) => before.includes(m)) }, { timeout: 20_000, interval: 1_000 }).toBe(true)
        const jobs = jobPids(before, 121)
        await terminal.getByRole('button', { name: '셸 다시 시작', exact: true }).click()
        await terminal.getByRole('button', { name: '정말 다시 시작' }).click()
        let left = jobs
        try {
          await expect.poll(() => { const now = pidsOf(wslOurs()); left = jobs.filter((p) => now.has(p)); return left.length === 0 }, { timeout: 15_000, interval: 1_000 }).toBe(true)
        } catch { /* 남은 것을 기록한다 */ }
        if (left.length > 0) throw Object.assign(new Error('셸을 다시 시작해도 백그라운드 작업이 남았다'), { before, jobs, left })
        return { jobs }
      })

      // 탭 (docs/sdlc/terminal-tabs/ FR-9·18·21) — WSL repo의 셸 메뉴는 그 distro 하나이고, 둘째 탭을 닫으면 그 탭의 세션만 끝난다.
      // pidfile은 탭마다다(`term-<tabId>.pid`) — 한 repo의 두 탭이 같은 파일을 쓰면 하나를 닫을 때 다른 탭의 세션을 겨눈다
      await step('5d-terminal-tabs', async () => {
        const firstTab = (await terminal.getByRole('tab', { selected: true }).textContent())!
        const firstShell = pidsOf(wslOurs())
        await terminal.getByRole('button', { name: '셸 고르기' }).click()
        const menu = page.getByRole('menu', { name: '셸 고르기' })
        await menu.waitFor({ timeout: 10_000 })
        const items = await menu.getByRole('menuitem').allTextContents()
        await page.keyboard.press('Escape')
        if (items.length !== 1 || !items[0]!.startsWith(`WSL · ${DISTRO}`)) throw Object.assign(new Error('WSL repo의 셸 메뉴가 그 distro 하나가 아니다'), { items })

        await terminal.getByRole('button', { name: '새 터미널', exact: true }).click()
        await expect.poll(() => terminal.getByRole('tab').count(), { timeout: 20_000 }).toBe(2)
        const secondTab = (await terminal.getByRole('tab', { selected: true }).textContent())!
        await waitShellIdle()
        await typeLine(`python3 -c 'import time; time.sleep(13013)' &`)
        let scan = ''
        await expect.poll(() => { scan = wslOurs(); return scan.includes('time.sleep(13013)') }, { timeout: 20_000, interval: 1_000 }).toBe(true)
        const job = scan.split('\n').filter((l) => l.includes('time.sleep(13013)')).map((l) => l.split(' ')[0]!)
        const wslDir = join(app.dataDir, 'wsl')
        const pidfiles = readdirSync(wslDir).filter((f) => f.startsWith('term-'))
        const sessions = pidfiles.map((f) => readFileSync(join(wslDir, f), 'utf8').trim())
        await shot('5d-terminal-tabs')
        if (pidfiles.length !== 2 || new Set(sessions).size !== 2) throw Object.assign(new Error('WSL 탭 둘의 pidfile이 각자의 것이 아니다'), { pidfiles, sessions })

        await terminal.getByRole('button', { name: `${secondTab} 터미널 닫기`, exact: true }).click()
        await terminal.getByRole('button', { name: '정말 닫기', exact: true }).click()
        let left = job
        try {
          await expect.poll(() => { const now = pidsOf(wslOurs()); left = job.filter((p) => now.has(p)); return left.length === 0 }, { timeout: 15_000, interval: 1_000 }).toBe(true)
        } catch { /* 남은 것을 기록한다 */ }
        const after = pidsOf(wslOurs())
        const firstAlive = [...firstShell].every((p) => after.has(p))
        const result = { items, firstTab, secondTab, pidfiles, sessions, job, left, firstAlive }
        if (left.length > 0) throw Object.assign(new Error('둘째 탭을 닫아도 그 탭의 작업이 남았다'), result)
        if (!firstAlive) throw Object.assign(new Error('둘째 탭을 닫았는데 첫 탭의 셸이 끝났다'), result)
        await expect.poll(() => terminal.getByRole('tab', { selected: true }).textContent(), { timeout: 10_000 }).toBe(firstTab)
        return result
      })

      // 앱 종료(동기 세션 KILL)가 끝내야 할 백그라운드 작업 — 9단계가 본다. 그 뒤의 기준선(취소 단계가 빼고 볼 것)도 여기서 잡는다
      await step('5c-terminal-bg-for-close', async () => {
        await waitShellIdle()
        await typeLine(bgLine(120))
        let scan = ''
        await expect.poll(() => { scan = wslOurs(); return bgMarks(120).every((m) => scan.includes(m)) }, { timeout: 20_000, interval: 1_000 }).toBe(true)
        bgAtClose = jobPids(scan, 120)
        baseline = pidsOf(scan)
        await shot('5c-terminal-bg')
        return { bgAtClose }
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
        // 답 문구가 아니라 기록으로 본다 — MCP가 안 붙어도 모델이 "MCP_OK count=0"을 지어낼 수 있다. init의 mcp_servers가 connected이고
        // list_issues 호출이 오류 없이 돌아왔어야 한다 (§4-C — 적대적인 데이터 폴더에서도)
        const runDirs = readdirSync(join(app.dataDir, 'logs'))
        if (runDirs.length !== 1) throw new Error(`run 로그가 하나가 아니다: ${runDirs.join(', ')}`)
        const lines = (file: string) => readFileSync(join(app.dataDir, 'logs', runDirs[0]!, file), 'utf8').split('\n').filter(Boolean)
          .map((l) => { try { return JSON.parse(l) as Record<string, unknown> } catch { return {} } })
        const init = lines('raw.jsonl').find((l) => l['type'] === 'system' && l['subtype'] === 'init')
        const servers = (init?.['mcp_servers'] ?? []) as { name: string; status: string }[]
        const events = lines('stream.jsonl')
        const use = events.find((e) => e['type'] === 'tool_use' && e['name'] === 'mcp__one-desk__list_issues')
        const result = use && events.find((e) => e['type'] === 'tool_result' && e['toolUseId'] === use['toolUseId'])
        const mcp = { servers, used: Boolean(use), resultOk: result?.['ok'] ?? null }
        if (!servers.some((s) => s.name === 'one-desk' && s.status === 'connected')) throw Object.assign(new Error('MCP 서버가 connected가 아니다'), mcp)
        if (!use || result?.['ok'] !== true) throw Object.assign(new Error('list_issues 호출이 오류 없이 돌아오지 않았다'), mcp)
        return { answer, mcp }
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
        // 브리지는 claude가 interop으로 띄운 Electron 자신이다 — cmd.exe를 거치지 않는다 (FR-23 개정, §4-C)
        const bridgeLines = winBefore.split('\n')
        if (bridgeLines.some((l) => /^\d+ cmd\.exe /i.test(l))) throw Object.assign(new Error('브리지가 cmd.exe를 거쳐 떴다'), result)
        if (!bridgeLines.some((l) => /^\d+ (electron|one-desk)\.exe /i.test(l) && l.includes('.bridge.json'))) {
          throw Object.assign(new Error('Electron 브리지가 인자 파일을 받아 뜨지 않았다'), result)
        }
        if (left.length > 0 || winAfter !== '') throw Object.assign(new Error('취소 뒤 프로세스가 남았다'), result)
        return result
      })
    } finally {
      // 로그를 남긴다 — close가 dataDir을 지운다
      try { copyDir(join(app.dataDir, 'logs'), join(OUT, 'logs')) } catch { /* 없으면 없다 */ }
      const pidfilesAtClose = existsSync(join(app.dataDir, 'wsl')) ? readdirSync(join(app.dataDir, 'wsl')) : []
      await app.close()
      // 앱 종료(cancelAll·터미널의 동기 세션 KILL) 뒤 — 터미널 셸과 그 백그라운드 작업(5c)까지 WSL에, 브리지가 Windows에 남지 않는다
      let wslLeft = ''
      let winLeft = ''
      try {
        await expect.poll(() => {
          wslLeft = wslOurs()
          winLeft = winOurs(app.dataDir)
          return wslLeft === '' && winLeft === ''
        }, { timeout: 15_000, interval: 1_000 }).toBe(true)
      } catch { /* 남은 것을 기록한다 */ }
      const bgLeft = bgAtClose.filter((p) => pidsOf(wslLeft).has(p))
      steps['9-after-app-close'] = { ok: wslLeft === '' && winLeft === '', pidfilesAtClose, wslLeft, winLeft, bgAtClose, bgLeft }
      // 남은 것은 치운다 — 전부 cwd가 이 테스트의 repo 아래인 것이라 우리 것이다(repo를 지우기 전에)
      const ours = [...pidsOf(wslLeft)]
      if (ours.length > 0) { try { wsl(`kill -KILL ${ours.join(' ')} 2>/dev/null; true`) } catch { /* 기록은 위에 있다 */ } }
      let cleanup = ''
      try { cleanup = wsl(`rm -rf ${LINUX_REPO} && echo removed`) } catch (err) { cleanup = String(err) }
      steps['cleanup'] = { ok: cleanup === 'removed', output: cleanup }
      writeFileSync(join(OUT, 'observations.json'), JSON.stringify({ distro: DISTRO, repo: UNC_REPO, steps }, null, 2))
      console.log(`[wsl-real] 기록: ${OUT}`)
    }
    expect(Object.entries(steps).filter(([, s]) => !s.ok).map(([k]) => k)).toEqual([])
  }, 1_200_000)
})
