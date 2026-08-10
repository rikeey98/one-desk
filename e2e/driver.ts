import { _electron, type ElectronApplication, type Page } from 'playwright-core'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { onTestFinished } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Electron에 컴파일된 엔트리 파일(out/main/index.js)을 직접 넘기지 않는다 — 저장소 루트를
 * 넘겨서 package.json의 "main" 필드를 거치게 한다. 실측으로 확인한 사고: 엔트리 파일을
 * 직접 가리키면 Electron의 app.getAppPath()가 그 파일이 있는 out/main으로 잡히고,
 * electron/main.ts의 resolveMigrationsDir()이 drizzle/를 out/main/drizzle에서 찾다가
 * 실패한다. DB 파일은 생기는데 마이그레이션이 안 돌아 테이블이 0개인 채로 앱이
 * 멈춘다(창도 안 뜬다) — 로그도 안 남아 원인을 찾기 어렵다.
 * `electron out/main/index.js` → 테이블 0개, `electron .`(루트, main 필드 경유) → 8개.
 * pnpm dev와 패키징된 앱 둘 다 "main" 필드를 거치므로, 여기서도 같은 경로를 타야
 * e2e가 실제 사용자가 겪는 실행 경로를 검증한다.
 */
const APP_ROOT = resolve(HERE, '..')
const FAKE_AGENT = resolve('core/runner/fixtures/fake-claude.mjs')
const ARTIFACTS = resolve('e2e/artifacts')

/** e2e가 running 상태를 관찰할 수 있을 만큼만 결과를 늦춘다. */
const FAKE_DELAY_MS = '1500'

export interface AppSession {
  page: Page
  /** 이 세션의 임시 데이터 디렉토리 */
  dataDir: string
  /** repo로 등록할 임시 작업 디렉토리 */
  repoDir: string
  close(): Promise<void>
}

export async function launchApp(): Promise<AppSession> {
  const dataDir = mkdtempSync(join(tmpdir(), 'one-desk-e2e-data-'))
  const repoDir = mkdtempSync(join(tmpdir(), 'one-desk-e2e-repo-'))

  const app: ElectronApplication = await _electron.launch({
    args: [APP_ROOT],
    // env는 물려받는 것이 아니라 교체된다. PATH가 사라지면 preflight가 claude를
    // 찾지 못해 모든 run이 프리플라이트 실패로 끝난다.
    env: {
      ...process.env,
      ONE_DESK_USER_DATA: dataDir,
      ONE_DESK_AGENT_PATH: FAKE_AGENT,
      ONE_DESK_FAKE_DELAY_MS: FAKE_DELAY_MS
    } as Record<string, string>
  })

  const page = await app.firstWindow()

  let closed = false

  // 빠뜨리면 Electron 프로세스와 임시 디렉토리가 쌓인다.
  // 고아 프로세스 하나가 다음 실행을 통째로 막은 적이 있다.
  //
  // 여러 번 불려도 안전해야 한다(idempotent) — 아래 onTestFinished가 테스트 종료 시
  // 자동으로 부르고, 테스트가 명시적으로도 close()를 부를 수 있어 겹칠 수 있다.
  async function close(): Promise<void> {
    if (closed) return
    closed = true
    await app.close()
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(repoDir, { recursive: true, force: true })
  }

  // onTestFailed + onTestFinished 조합을 실측했더니 스크린샷이 안 남았다: 이 Vitest
  // 버전(4.1.10)은 onTestFinished 훅을 onTestFailed보다 먼저 돌린다(문서화된 내용이
  // 아니라 @vitest/runner의 runTest() 소스로 직접 확인했다 — test.onFinished를 먼저
  // 비우고 그다음에야 test.result.state === 'fail'일 때 test.onFailed를 비운다).
  // 그래서 onTestFinished로 예약한 close()가 항상 먼저 실행돼 페이지를 닫아버리고,
  // 그 뒤에 도는 onTestFailed의 스크린샷은 닫힌 페이지를 찍으려다 죽는다.
  //
  // 그래서 훅을 하나만 쓴다: onTestFinished 안에서 실패 여부를 먼저 확인해 실패했을
  // 때만 스크린샷을 찍고, 그다음에 닫는다. 이러면 실행 순서에 기대지 않는다.
  onTestFinished(async (context) => {
    if (context.task.result?.state === 'fail') {
      mkdirSync(ARTIFACTS, { recursive: true })
      await page.screenshot({ path: join(ARTIFACTS, `fail-${Date.now()}.png`) })
    }
    await close()
  })

  return {
    page,
    dataDir,
    repoDir,
    close
  }
}
