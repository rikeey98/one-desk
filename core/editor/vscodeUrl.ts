/**
 * 디렉토리 경로를 VS Code가 여는 URL로 만든다.
 *
 * `code` CLI를 spawn하지 않는 이유: macOS에서 "Install 'code' command in PATH"를
 * 누른 적 없는 사람에게는 조용히 실패한다. URL 스킴은 VS Code 설치가 등록하므로
 * 별도 설정이 필요 없다.
 */
export function vscodeFolderUrl(path: string): string {
  const trimmed = path.trim()
  if (trimmed === '') throw new Error('경로가 비어 있습니다.')

  // Windows 경로(`C:\repo`)도 URL에서는 슬래시이고, 드라이브 문자 앞에 루트
  // 슬래시가 있어야 `vscode://file/C:/repo`가 된다.
  const slashed = trimmed.replace(/\\/g, '/')
  const rooted = slashed.startsWith('/') ? slashed : `/${slashed}`
  // 끝의 구분자는 빈 세그먼트가 되어 URL에 `//`를 남긴다. 루트(`/`)는 남긴다.
  const normalized = rooted.length > 1 ? rooted.replace(/\/+$/, '') : rooted

  // encodeURI로는 부족하다 — `#`과 `?`를 남겨둬 경로가 프래그먼트·쿼리로 잘린다.
  // 세그먼트마다 encodeURIComponent를 쓰되 콜론만 되돌린다: `C%3A`는 VS Code가
  // 드라이브 문자로 읽지 못한다.
  const encoded = normalized
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/%3A/g, ':'))
    .join('/')

  return `vscode://file${encoded}`
}
