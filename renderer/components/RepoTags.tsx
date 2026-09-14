import type { Repo } from '@shared/models'

/**
 * 이슈·메모에 repo를 붙이는 토글 줄. 훑기 카드와 두 상세가 같은 것을 쓴다.
 *
 * **축과 달리 다중 선택이다.** `issue_repo`는 N:M이고, 하나의 이슈가 여러 repo에
 * 걸치는 일이 실제로 잦다 (asset 범위 intent). 태그가 하나도 없으면 그것이 곧
 * "workspace 공통"이며, 그것도 정상적인 상태다 — 비우는 것을 막지 않는다.
 *
 * **스스로 state를 들지 않는다.** 켜고 끌 때마다 부모가 저장하고 그 결과를 다시
 * 내려주므로, 여기서 별도 버퍼를 두면 저장이 실패했을 때 화면만 켜진 채로 남는다.
 *
 * `issue.ts`↔`memo.ts`의 「의도된 중복」과 부딪히지 않는다. 그쪽은 이슈에만 붙을
 * 기능(축·훑기)을 위한 규칙이고, `repoIds`는 설계 §9가 **공통 필드로 대칭 유지**라고
 * 명시한 쪽이다.
 */
export function RepoTags({ repos, picked, onChange, label = 'repo' }: {
  repos: Repo[]
  picked: string[]
  onChange: (next: string[]) => void
  label?: string
}) {
  // 등록된 repo가 없으면 고를 것도 없다. 빈 줄은 화면에 상주하는 잡음이다.
  if (repos.length === 0) return null

  const set = new Set(picked)

  return (
    <div className="repo-tags" role="group" aria-label={label}>
      <span className="repo-tags-label">{label}</span>
      {repos.map((r) => {
        const on = set.has(r.id)
        return (
          <button
            key={r.id}
            type="button"
            className={on ? 'repo-tag repo-tag-picked' : 'repo-tag'}
            aria-pressed={on}
            // 끌 때는 원래 순서를 보존해야 저장할 때마다 배열이 흔들리지 않는다.
            onClick={() => onChange(on ? picked.filter((id) => id !== r.id) : [...picked, r.id])}
          >
            {r.name}
          </button>
        )
      })}
    </div>
  )
}
