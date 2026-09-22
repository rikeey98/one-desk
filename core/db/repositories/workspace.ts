import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import type { Database } from '../open'
import { workspace } from '../schema'
import { NotFoundError } from '../../errors'
import type {
  Workspace, CreateWorkspaceInput,
  UpdateWorkspaceDefaultsInput, UpdateWorkspacePathsInput
} from '@shared/models'

/** 앞뒤 공백을 떼고, 빈 문자열은 null로 — null이 "정하지 않았다"는 뜻이다. */
function blankToNull(value: string | null): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

export function createWorkspaceRepository(db: Database) {
  return {
    list(): Workspace[] {
      return db.select().from(workspace).orderBy(asc(workspace.name)).all()
    },

    create(input: CreateWorkspaceInput): Workspace {
      const now = Date.now()
      const [row] = db
        .insert(workspace)
        .values({
          id: randomUUID(),
          name: input.name,
          description: input.description ?? null,
          createdAt: now,
          updatedAt: now
        })
        .returning()
        .all()
      if (!row) throw new Error('workspace 생성에 실패했습니다')
      return row
    },

    /**
     * 이름만 바꾼다. `update`가 아니라 `rename`인 것은 의도된 것이다 —
     * description·기본 권한까지 열면 호출자마다 다른 부분 갱신을 보내게 되고,
     * 그때 무엇이 덮이는지가 흐려진다. 필요해지면 그때 넓힌다.
     */
    rename(id: string, name: string): Workspace {
      const trimmed = name.trim()
      // 빈 이름을 허용하면 사이드바에 아무것도 안 적힌 줄이 남아 고를 수는 있는데
      // 무엇인지 알 수 없는 workspace가 된다.
      if (trimmed === '') throw new Error('이름은 비울 수 없습니다.')

      const [row] = db.update(workspace)
        .set({ name: trimmed, updatedAt: Date.now() })
        .where(eq(workspace.id, id))
        .returning()
        .all()
      // 조용히 넘어가면 화면이 왜 그대로인지 사용자도 우리도 알 수 없다.
      if (!row) throw new NotFoundError(`workspace를 찾을 수 없습니다: ${id}`)
      return row
    },

    /**
     * 실행 기본값을 한 번에 세운다 (전체 설계 §403) — agent · 모델 둘 ·
     * effort/variant 둘 · 권한.
     *
     * `rename`과 나란히 두고 이름을 `update`로 넓히지 않은 것은 위 주석과 같은
     * 이유다 — **부분 갱신을 받지 않는다.** 값을 전부 받으므로 어느 호출이든
     * 덮는 범위가 같고, 화면 하나가 저장 버튼 하나로 보낸다.
     *
     * 모델과 effort는 앞뒤 공백을 떼고 **빈 문자열이면 null로 저장한다.** null이 "CLI
     * 자신의 기본값에 맡긴다"는 뜻이라, 빈 칸과 같은 자리에 있어야 한다 —
     * `''`를 그대로 두면 RunPanel이 그것을 기본값으로 채우고 어댑터가
     * `-m ''`를 붙인다.
     *
     * **모델·effort 문자열의 형식은 검증하지 않는다.** 어느 별칭이 유효한지는 CLI가
     * 알고, 앱이 목록을 들고 있으면 CLI가 모델을 추가할 때마다 낡는다. 틀린 값은 실행이
     * 실패하며 드러나고 그 메시지가 인박스에 남는다. effort도 마찬가지다 —
     * **CLI가 값을 검증하지 않는다**(`--effort bogus`도 통과한다, 2026-09-22 실측).
     * 화면의 드롭다운이 유일한 가드이고 여기서 그것을 흉내내지 않는다.
     */
    updateDefaults(input: UpdateWorkspaceDefaultsInput): Workspace {
      const [row] = db.update(workspace)
        .set({
          defaultAgentKind: input.defaultAgentKind,
          defaultModelClaude: blankToNull(input.defaultModelClaude),
          defaultModelOpencode: blankToNull(input.defaultModelOpencode),
          defaultEffortClaude: blankToNull(input.defaultEffortClaude),
          defaultVariantOpencode: blankToNull(input.defaultVariantOpencode),
          defaultPermission: input.defaultPermission,
          updatedAt: Date.now()
        })
        .where(eq(workspace.id, input.id))
        .returning()
        .all()
      // rename과 같은 이유다 — 조용히 넘어가면 화면이 왜 그대로인지 알 수 없다.
      if (!row) throw new NotFoundError(`workspace를 찾을 수 없습니다: ${input.id}`)
      return row
    },

    /**
     * CLI 실행 파일 경로를 세운다 (전체 설계 §595).
     *
     * `updateDefaults`와 나란히 두되 **합치지 않는다** — 둘은 고치는 때가 다르다.
     * 경로는 PATH가 깨졌을 때 한 번 고치는 것이고 기본값은 계속 손보는 것이라,
     * 한 메서드로 묶으면 경로를 고치러 온 사람이 모델 기본값까지 함께 덮는다.
     * 부분 갱신을 받지 않는 규칙은 같다 — 두 경로를 전부 받는다.
     *
     * **경로가 실제로 실행 가능한지는 보지 않는다.** 그 판정은 어댑터 preflight의
     * 것이고(플랫폼마다 규칙이 다르다 — Windows의 `PATHEXT`, `.cmd` shim 거부),
     * 여기서 흉내내면 두 벌이 생겨 조용히 어긋난다. 화면은 저장한 뒤 preflight를
     * 다시 물어 결과를 보여준다.
     */
    updatePaths(input: UpdateWorkspacePathsInput): Workspace {
      const [row] = db.update(workspace)
        .set({
          claudePath: blankToNull(input.claudePath),
          opencodePath: blankToNull(input.opencodePath),
          updatedAt: Date.now()
        })
        .where(eq(workspace.id, input.id))
        .returning()
        .all()
      if (!row) throw new NotFoundError(`workspace를 찾을 수 없습니다: ${input.id}`)
      return row
    },

    remove(id: string): void {
      db.delete(workspace).where(eq(workspace.id, id)).run()
    }
  }
}
