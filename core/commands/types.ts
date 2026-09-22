/**
 * `core/commands/`의 내부 타입. 화면과 IPC가 쓰는 공개 타입은 `shared/models.ts`에 둔다.
 */

/** 디스크에서 채우는 커맨드 한 개의 설명 (설계 › 개요의 5개 자리). */
export interface CommandDescription {
  description: string | null
  /** 인자 placeholder를 쓰는가 — 맥락이 인자 자리에 치환된다(FR-9). 파일을 못 찾으면 false. */
  usesArguments: boolean
}

/** init이 알려주는 플러그인 한 개. 그 경로 아래의 커맨드·스킬은 이름에 `<플러그인>:`이 붙는다. */
export interface CommandPlugin {
  name: string
  /** 절대 경로 */
  path: string
}

/**
 * probe가 `system/init`에서 뽑은 것. 못 얻었으면 목록은 전부 비고 `error`에 사유가 담긴다 —
 * 어떤 경우에도 던지지 않는다(NFR-2). init에 없는 필드는 빈 배열로 본다.
 */
export interface ProbeResult {
  slashCommands: string[]
  /** 터미널이 있어야 도는 것(`doctor` 등). 헤드리스에선 무의미하므로 service가 목록에서 뺀다. */
  terminalSlashCommands: string[]
  plugins: CommandPlugin[]
  /**
   * `init`이 해석해 준 모델 이름 (`sonnet` → `claude-sonnet-5`). 없으면 null.
   *
   * **슬래시 커맨드와 같은 한 번의 기동에서 함께 온다** — 이 줄을 이미 손에
   * 들고 있으면서 버리고 있었다(docs/sdlc/agent-setup/ NFR-3). 설정 화면이
   * 이것 때문에 CLI를 또 띄우지 않는다.
   *
   * **"유효하다"는 뜻이 아니다.** init은 모델을 검증하지 않는다 — 없는 이름
   * `gpt-9`도 그대로 되돌려 준다(2026-09-22 실측).
   */
  model: string | null
  /** `claude_code_version`. 없으면 null */
  version: string | null
  /** 목록을 얻지 못한 사유. 성공이면 null. */
  error: string | null
}
