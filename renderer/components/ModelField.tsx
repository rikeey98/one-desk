import { useId } from 'react'
import { modelPlaceholderOf, modelSuggestionsOf } from '../models'
import type { AgentKind, AgentModel } from '@shared/models'

/**
 * 모델 입력 칸 (docs/sdlc/agent-setup/ FR-8·9·10).
 *
 * **`<select>`가 아니라 `<input>` + `<datalist>`다.** 제안은 보여주되 자유 입력을
 *막지 않는다 — claude에는 모델 목록을 조회할 수단이 없어 앱이 별칭 표를 들고
 * 있어야 하는데, 드롭다운으로 강제하면 그 표가 낡은 날 **새 모델을 아예 못 쓰게
 * 된다.** 목록에 없는 이름도 그대로 저장돼 실행에 쓰이는 것이 이 선택의 핵심이다.
 *
 * **설정 화면과 실행 패널이 같이 쓴다**(FR-11). 두 화면이 같은 값을 다른 말로
 * 부르면, 기본값을 정해 둔 사람이 실행 패널에서 다른 안내를 보게 된다.
 */
export function ModelField({
  agentKind, value, onChange, label, probed = [], resolved = null, disabled = false
}: {
  agentKind: AgentKind
  value: string
  onChange: (next: string) => void
  /** 접근성 이름. 화면마다 다르다 — 설정 화면은 agent 이름을 붙여 둘을 가른다 */
  label: string
  /** `opencode models`가 준 목록. claude는 조회 수단이 없어 늘 비어 있다 */
  probed?: readonly string[]
  /** probe가 해석한 이름. 없으면 줄을 그리지 않는다 */
  resolved?: AgentModel | null
  disabled?: boolean
}) {
  const listId = useId()
  const suggestions = modelSuggestionsOf(agentKind, probed)

  return (
    <label className="settings-field">
      {label}
      <input
        aria-label={label}
        value={value}
        list={suggestions.length > 0 ? listId : undefined}
        placeholder={modelPlaceholderOf(agentKind)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((m) => <option key={m} value={m} />)}
        </datalist>
      )}
      {resolved && <ResolvedLine resolved={resolved} />}
    </label>
  )
}

/**
 * probe가 무엇을 봤는지 한 줄.
 *
 * **문구가 "이 모델로 돕니다"까지 가면 거짓말이다.** claude의 `init`은 모델을
 * 검증하지 않는다 — 없는 이름 `gpt-9`도 그대로 되돌려 준다(2026-09-22 실측).
 * 그래서 "이 이름으로 넘어갑니다"에서 멈춘다(spec FR-10의 제약).
 */
function ResolvedLine({ resolved }: { resolved: AgentModel }) {
  if (resolved.state === 'resolved') {
    return (
      <span className="field-note">
        → <code>{resolved.model}</code> 이름으로 넘어갑니다
      </span>
    )
  }
  // 안 돌린 것과 돌렸는데 못 얻은 것을 가른다(FR-3). 둘 다 "모른다"이지만
  // 사용자가 할 일이 다르다 — 앞은 로그인·repo 등록, 뒤는 재시도다.
  return <span className="field-note">{resolved.reason}</span>
}
