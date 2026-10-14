import { ORIGINAL_LD_LIBRARY_PATH } from '../userEnv'

/** 앱 자신이 뜬 값 — AppImage가 넣어 둔 usr/lib (테스트용 가짜 경로) */
export const APP_LD_LIBRARY_PATH = '/tmp/.mount_one-dAbC/usr/lib'
/** 사용자가 앱을 실행한 값 — 설계 도구의 라이브러리 폴더 (테스트용 가짜 경로) */
export const USER_LD_LIBRARY_PATH = '/opt/eda/lib'

/**
 * 리눅스 패키지의 실행 껍데기(`build/linux/launcher.sh`)가 띄운 앱의 환경을 흉내낸다 — 앱 자신은 AppImage의 usr/lib만 보고, 사용자의
 * 값은 표식에 있다(`docs/sdlc/linux-launch-env/`). 끝나면 되돌린다. 없는 폴더라 리눅스에서 자식이 물려받아도 로더가 건너뛴다.
 */
export async function asLinuxPackage<T>(fn: () => T | Promise<T>): Promise<T> {
  const keys = ['LD_LIBRARY_PATH', ORIGINAL_LD_LIBRARY_PATH] as const
  const saved = keys.map((k) => process.env[k])
  process.env['LD_LIBRARY_PATH'] = APP_LD_LIBRARY_PATH
  process.env[ORIGINAL_LD_LIBRARY_PATH] = USER_LD_LIBRARY_PATH
  try {
    return await fn()
  } finally {
    keys.forEach((k, i) => {
      const v = saved[i]
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    })
  }
}

/** 자식이 받은 두 값을 JSON 한 줄로 찍는 node 스크립트 본문 — `node -e`나 가짜 CLI에 넣는다 */
export const PRINT_LOADER_ENV =
  `process.stdout.write(JSON.stringify({ ld: process.env.LD_LIBRARY_PATH ?? null, marker: process.env.${ORIGINAL_LD_LIBRARY_PATH} ?? null }))`

/** `PRINT_LOADER_ENV`가 찍어야 하는 것 — 사용자의 값이 돌아오고 표식은 넘어가지 않는다 */
export const RESTORED = { ld: USER_LD_LIBRARY_PATH, marker: null }
