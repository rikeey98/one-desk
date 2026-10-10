import { eq } from 'drizzle-orm'
import type { Database } from '../open'
import { appSetting } from '../schema'
import type { AgentPaths } from '@shared/models'

/** 동시 실행 상한을 담는 키 */
export const CONCURRENCY_LIMIT_KEY = 'run.concurrencyLimit'

/** 설계 §6이 정한 기본 상한 */
export const DEFAULT_CONCURRENCY_LIMIT = 3

/** 1 이상의 정수만 상한으로 받는다. */
function isValidLimit(n: number): boolean {
  return Number.isInteger(n) && n >= 1
}

/** claude용 글로벌 asset 경로를 담는 키 */
export const GLOBAL_ROOTS_CLAUDE_KEY = 'assets.globalRoots.claude'
/** opencode용 글로벌 asset 경로를 담는 키 */
export const GLOBAL_ROOTS_OPENCODE_KEY = 'assets.globalRoots.opencode'

/** claude CLI 기본 경로를 담는 키 (agent-path-default FR-2) */
export const AGENT_PATH_CLAUDE_KEY = 'agents.path.claude'
/** opencode CLI 기본 경로를 담는 키 */
export const AGENT_PATH_OPENCODE_KEY = 'agents.path.opencode'

/** 코드 칸 터미널의 셸 경로를 담는 키 (docs/sdlc/code-editor/terminal-spec.md FR-11) */
export const TERMINAL_SHELL_KEY = 'terminal.shell'

/** agent 종류별 글로벌 asset 경로 */
export interface GlobalRoots {
  claude: string[]
  opencode: string[]
}

/**
 * 앱 설정 저장소.
 *
 * `homeDir`를 인자로 받는 이유: 글로벌 경로의 기본값이 홈 기준인데 **`core/`가 홈을
 * 스스로 알면 테스트가 개발자의 실제 홈을 훑게 되어** 사람마다 결과가 달라진다.
 * 선택 인자로 두지 않는다 — 빠뜨리면 글로벌 경로가 조용히 비고, 그것이 정확히
 * 이번에 고치려던 증상이다.
 */
export function createSettingRepository(db: Database, homeDir: string) {
  function defaults(): GlobalRoots {
    return {
      claude: [`${homeDir}/.claude/skills`, `${homeDir}/.claude/agents`],
      opencode: [`${homeDir}/.config/opencode/agent`]
    }
  }

  /** 저장된 목록을 읽는다. 비어 있으면 기본값으로 떨어진다. */
  function readRoots(key: string, fallback: string[]): string[] {
    const row = db.select().from(appSetting).where(eq(appSetting.key, key)).get()
    const parsed = (row?.value ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
    return parsed.length > 0 ? parsed : fallback
  }

  function readPath(key: string): string | null {
    const row = db.select().from(appSetting).where(eq(appSetting.key, key)).get()
    const v = (row?.value ?? '').trim()
    return v === '' ? null : v
  }

  function writeRoots(key: string, roots: string[]): void {
    const value = roots.map((r) => r.trim()).filter(Boolean).join('\n')
    db.insert(appSetting).values({ key, value })
      .onConflictDoUpdate({ target: appSetting.key, set: { value } }).run()
  }

  return {
    /**
     * 저장된 동시 실행 상한.
     * 값이 없거나 망가졌으면 기본값으로 떨어진다 — 상한이 0이나 NaN이 되면
     * 큐가 아무것도 시작하지 않고 조용히 멈춘다.
     */
    concurrencyLimit(): number {
      const row = db.select().from(appSetting)
        .where(eq(appSetting.key, CONCURRENCY_LIMIT_KEY)).get()
      if (!row) return DEFAULT_CONCURRENCY_LIMIT
      const n = Number(row.value)
      return isValidLimit(n) ? n : DEFAULT_CONCURRENCY_LIMIT
    },

    setConcurrencyLimit(n: number): number {
      if (!isValidLimit(n)) {
        throw new Error(`동시 실행 상한은 1 이상의 정수여야 합니다: ${n}`)
      }
      const value = String(n)
      db.insert(appSetting).values({ key: CONCURRENCY_LIMIT_KEY, value })
        .onConflictDoUpdate({ target: appSetting.key, set: { value } }).run()
      return n
    },

    /**
     * 훑을 글로벌 경로. 저장된 값이 없거나 다 지워졌으면 기본값으로 돌아간다 —
     * 실수로 비운 사람이 앱을 못 쓰게 되지 않는다.
     */
    globalRoots(): GlobalRoots {
      const d = defaults()
      return {
        claude: readRoots(GLOBAL_ROOTS_CLAUDE_KEY, d.claude),
        opencode: readRoots(GLOBAL_ROOTS_OPENCODE_KEY, d.opencode)
      }
    },

    setGlobalRoots(roots: GlobalRoots): GlobalRoots {
      writeRoots(GLOBAL_ROOTS_CLAUDE_KEY, roots.claude)
      writeRoots(GLOBAL_ROOTS_OPENCODE_KEY, roots.opencode)
      return this.globalRoots()
    },

    /**
     * CLI 기본 경로. 비었으면(공백뿐 포함) null — 어댑터가 PATH에서 찾는다. 쓸 만한 경로인지는
     * 보지 않는다 — 판정은 preflight의 몫이다(workspace의 `updatePaths`와 같다).
     */
    agentPaths(): AgentPaths {
      return { claude: readPath(AGENT_PATH_CLAUDE_KEY), opencode: readPath(AGENT_PATH_OPENCODE_KEY) }
    },

    /** 둘을 함께 받는다 — 부분 갱신을 받지 않는다(`updatePaths`와 같은 규칙). */
    setAgentPaths(paths: AgentPaths): AgentPaths {
      db.transaction((tx) => {
        for (const [key, value] of [
          [AGENT_PATH_CLAUDE_KEY, paths.claude], [AGENT_PATH_OPENCODE_KEY, paths.opencode]
        ] as const) {
          const v = (value ?? '').trim()
          tx.insert(appSetting).values({ key, value: v })
            .onConflictDoUpdate({ target: appSetting.key, set: { value: v } }).run()
        }
      })
      return this.agentPaths()
    },

    /** 터미널 셸 경로(FR-11). 비었으면 null — 기본 셸을 쓴다. 파일이 있는지는 core가 본다(저장소는 파일시스템을 모른다) */
    terminalShell(): string | null {
      return readPath(TERMINAL_SHELL_KEY)
    },

    setTerminalShell(path: string | null): string | null {
      const value = (path ?? '').trim()
      db.insert(appSetting).values({ key: TERMINAL_SHELL_KEY, value })
        .onConflictDoUpdate({ target: appSetting.key, set: { value } }).run()
      return this.terminalShell()
    }
  }
}

export type SettingRepository = ReturnType<typeof createSettingRepository>
