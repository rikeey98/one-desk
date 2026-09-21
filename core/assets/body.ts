import { readFile } from 'node:fs/promises'
import type { Asset, AssetBody } from '@shared/models'

/**
 * asset의 본문 (`docs/sdlc/repo-instructions/` spec §3-1).
 *
 * authored는 DB의 본문이고 discovered는 **그 파일의 지금 내용**이다 — 저장하지
 * 않으므로(asset 스캔 설계 §2-2) 파일을 고치면 다음에 읽을 때 반영된다.
 *
 * **행을 받는다, 경로를 받지 않는다.** 경로는 DB에서만 온다 — 렌더러가 임의 파일을
 * 읽는 통로가 되면 안 된다(spec NFR-2). 상세 보기와 실행 서비스가 이 함수 하나를
 * 쓴다. 두 자리가 따로 읽으면 인코딩·오류 처리가 갈린다.
 *
 * 못 읽으면 던지지 않고 실패로 돌려준다. preload가 IPC 오류의 클래스를 벗겨내므로
 * 예외로는 가려낼 수 없고, 빈 본문으로 돌려주면 화면이 "파일이 비었다"로 읽는다.
 */
export async function readAssetBody(row: Asset): Promise<AssetBody> {
  if (row.source === 'authored') return { ok: true, content: row.content ?? '' }

  const path = row.filePath
  if (!path) return { ok: false, reason: '이 asset에는 파일 경로가 없습니다.' }
  try {
    return { ok: true, content: await readFile(path, 'utf8') }
  } catch {
    return { ok: false, reason: `파일을 읽을 수 없습니다: ${path}` }
  }
}
