/**
 * 리눅스 패키지의 실행 껍데기(`build/linux/launcher.sh`)가 남기는 표식 — 사용자가 앱을 실행한 그대로의 `LD_LIBRARY_PATH`다
 * (`docs/sdlc/linux-launch-env/`).
 *
 * 껍데기는 Electron을 그 값 없이 띄운다. 그 값이 가리키는 폴더에 오래된 라이브러리가 있으면(설계 도구가 `libexpat` 2.0을
 * 들고 오는 식) Electron이 시작조차 못 하기 때문이다 — `symbol lookup error: … undefined symbol: XML_SetHashSalt`(RHEL에서 받은
 * 보고, 2026-10-14). **표식이 있으면 빈 값도 뜻이 있다** — 사용자가 그 변수를 두지 않았다.
 */
export const ORIGINAL_LD_LIBRARY_PATH = 'ONE_DESK_ORIG_LD_LIBRARY_PATH'

/**
 * 앱이 사용자 대신 띄우는 프로세스(agent CLI·git·터미널 셸)의 환경 — 껍데기가 앱을 띄우려고 걷어 낸 `LD_LIBRARY_PATH`를 사용자가
 * 실행한 값으로 되돌리고 표식을 지운다. 그 프로세스들은 사용자의 셸에서 띄운 것처럼 돌아야 한다 — 설계 도구의 라이브러리
 * 폴더가 빠지면 agent가 Bash로 부르는 도구가 깨진다. 표식이 없으면(Windows·macOS·`pnpm dev`) 복사본만 돌려준다.
 *
 * **받은 환경을 바꾸지 않는다.** `process.env`를 고치면 그 뒤에 뜨는 Electron 자신의 자식(GPU 프로세스)이 사용자의 값을
 * 물려받아 앱이 시작하지 못한 것과 같은 이유로 죽는다 — 그래서 띄우는 자리마다 이것을 거친다.
 */
export function userProcessEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) if (value !== undefined) out[key] = value
  const original = env[ORIGINAL_LD_LIBRARY_PATH]
  if (original === undefined) return out
  delete out[ORIGINAL_LD_LIBRARY_PATH]
  if (original === '') delete out['LD_LIBRARY_PATH']
  else out['LD_LIBRARY_PATH'] = original
  return out
}

/**
 * 앱 자신의 실행 파일(Electron)을 다시 띄울 때 그 환경 위에 얹을 것 — MCP 브리지다. 브리지는 agent가 띄우므로 agent의 환경
 * (`userProcessEnv` — 사용자의 `LD_LIBRARY_PATH`)을 물려받는데, 그 값으로는 앱이 시작하지 못한 것과 똑같이 브리지도 뜨지 못한다.
 * 그러면 agent는 MCP를 failed로 두고 도구 없이 "성공"한다. 그래서 앱이 뜬 값을 그대로 준다 — 비었으면 빈 값이고, glibc는 빈
 * `LD_LIBRARY_PATH`를 없는 것으로 본다(서버 env는 변수를 지우지 못하고 덮기만 한다).
 */
export function appLoaderEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  if (env[ORIGINAL_LD_LIBRARY_PATH] === undefined) return {}
  return { LD_LIBRARY_PATH: env['LD_LIBRARY_PATH'] ?? '' }
}
