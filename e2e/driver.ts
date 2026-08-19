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
 * `electron out/main/index.js` → 테이블 0개, `electron .`(루트, main 필드 경유) → 10개.
 * pnpm dev와 패키징된 앱 둘 다 "main" 필드를 거치므로, 여기서도 같은 경로를 타야
 * e2e가 실제 사용자가 겪는 실행 경로를 검증한다.
 */
const APP_ROOT = resolve(HERE, '..')
// 나머지 경로도 APP_ROOT처럼 이 파일 위치에서 뽑는다. process.cwd() 기준으로 잡으면
// 저장소 루트에서 부를 때만 맞고, 다른 디렉토리에서 vitest를 돌리면 조용히 어긋난다.
const FAKE_AGENT = resolve(APP_ROOT, 'core/runner/fixtures/fake-claude.mjs')
const ARTIFACTS = resolve(HERE, 'artifacts')

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

/**
 * 앱 종료와 임시 디렉토리 삭제. 세 단계(앱 종료, dataDir 삭제, repoDir 삭제)는 서로의
 * 성공에 기대지 않는다 — 하나가 던져도 나머지가 반드시 실행된다. 예전엔 app.close()가
 * 던지면 그 아래 rmSync 두 줄이 통째로 스킵됐는데, 호출자의 closed 플래그는 이미 true라
 * 이후 재호출도 조용히 빠져나가 버렸다. 즉 "정리를 시도했다"가 "정리에 성공했다"로
 * 둔갑해 Electron 프로세스와 임시 디렉토리가 고아로 남았다 — 실제로 겪은 경로다.
 *
 * app이 undefined면(=아직 뜨지 않았다) 디렉토리만 지운다.
 */
async function cleanup(app: ElectronApplication | undefined, dirs: string[]): Promise<void> {
  if (app) {
    try {
      await app.close()
    } catch (error) {
      // 조용히 삼키지 않는다 — 앱이 이미 죽어 있었거나 IPC가 끊긴 경우 등 원인 파악용.
      console.error('one-desk e2e: Electron 앱 종료 실패 (임시 디렉토리 정리는 계속한다)', error)
    }
  }

  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch (error) {
      console.error(`one-desk e2e: 임시 디렉토리 삭제 실패: ${dir}`, error)
    }
  }
}

/**
 * 앱을 띄우고 첫 창을 잡는다. 둘 중 어느 쪽이 던지든 그 전에 만든 것을 스스로 치운다.
 *
 * 이 방어가 없으면 아래 launchApp()의 onTestFinished 등록에 닿지 못한 채 빠져나가,
 * 임시 디렉토리 두 개가 남고 launch()까지 성공했다면 아무도 참조하지 않는 Electron
 * 프로세스가 살아남는다. 고아 하나가 다음 실행을 통째로 막은 적이 있다 — 하필 앱이
 * 깨져서(창이 안 뜨는 회귀 → firstWindow() 타임아웃) 깨끗한 재시도가 가장 급할 때 터진다.
 * 오류는 그대로 다시 던진다 — 호출자는 진짜 원인을 봐야 한다.
 */
async function launchElectron(
  dataDir: string,
  repoDir: string,
  agentPath: string,
  extraEnv?: Record<string, string>
): Promise<{ app: ElectronApplication, page: Page }> {
  let app: ElectronApplication | undefined
  try {
    app = await _electron.launch({
      args: [APP_ROOT],
      // env는 물려받는 것이 아니라 교체된다. PATH가 사라지면 preflight가 claude를
      // 찾지 못해 모든 run이 프리플라이트 실패로 끝난다.
      // extraEnv는 기본값(특히 ONE_DESK_FAKE_DELAY_MS) 뒤에 얹혀 그것을 덮어쓸 수
      // 있다 — 여러 턴을 칠 시간을 벌어야 하는 시나리오(conversation.e2e.ts)가 쓴다.
      env: {
        ...process.env,
        ONE_DESK_USER_DATA: dataDir,
        ONE_DESK_AGENT_PATH: agentPath,
        ONE_DESK_FAKE_DELAY_MS: FAKE_DELAY_MS,
        ...extraEnv
      } as Record<string, string>
    })
    return { app, page: await app.firstWindow() }
  } catch (error) {
    await cleanup(app, [dataDir, repoDir])
    throw error
  }
}

export interface LaunchOptions {
  /** 앱이 spawn할 가짜 CLI. 기본은 stream-json만 흉내내는 fake-claude.mjs */
  agentPath?: string
  /** Electron 프로세스에 추가로 얹을 환경변수. ONE_DESK_FAKE_DELAY_MS 같은 기본값을 덮어쓸 수 있다. */
  env?: Record<string, string>
}

export async function launchApp(options: LaunchOptions = {}): Promise<AppSession> {
  const dataDir = mkdtempSync(join(tmpdir(), 'one-desk-e2e-data-'))
  const repoDir = mkdtempSync(join(tmpdir(), 'one-desk-e2e-repo-'))

  const { app, page } = await launchElectron(dataDir, repoDir, options.agentPath ?? FAKE_AGENT, options.env)

  let closed = false

  // 빠뜨리면 Electron 프로세스와 임시 디렉토리가 쌓인다.
  // 고아 프로세스 하나가 다음 실행을 통째로 막은 적이 있다.
  //
  // 여러 번 불려도 안전해야 한다(idempotent) — 아래 onTestFinished가 테스트 종료 시
  // 자동으로 부르고, 테스트가 명시적으로도 close()를 부를 수 있어 겹칠 수 있다.
  // 단계별 실패 격리는 cleanup()이 맡는다.
  async function close(): Promise<void> {
    if (closed) return
    closed = true
    await cleanup(app, [dataDir, repoDir])
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
      try {
        mkdirSync(ARTIFACTS, { recursive: true })
        await page.screenshot({ path: join(ARTIFACTS, `fail-${Date.now()}.png`) })
      } catch (error) {
        // 스크린샷이 타임아웃/창 굳음 등으로 던지더라도 아래 close()는 반드시 돌아야
        // 한다 — 안 그러면 디버깅용 스크린샷 하나 놓치는 대가로 Electron 프로세스와
        // 임시 디렉토리가 고아로 남는다. 여기서도 조용히 삼키지 않는다.
        console.error('one-desk e2e: 실패 스크린샷 찍기 실패 (정리는 계속 진행한다)', error)
      }
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
