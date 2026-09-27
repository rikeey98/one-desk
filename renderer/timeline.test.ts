import { describe, it, expect } from 'vitest'
import {
  TOOL_LABELS, toolLabelOf, toolSubtitleOf, projectTurn, switchNotice,
  formatDuration, metaPieces, toolDetailOf, MAX_INPUT_JSON, type TimelineBlock, type ToolItem
} from './timeline'
import type { NoticeKind, RunEvent, RunUsage, ToolDetail as ResultDetail } from '@shared/events'
import type { Run } from '@shared/models'

const R = 'r1'

type ResultEvent = Extract<RunEvent, { type: 'tool_result' }>

/** 새 필드를 얹은 결과 (`docs/sdlc/conversation-events/` spec §3) — 옛 `done`과 같은 기본값이다. */
function res(
  seq: number, id: string, over: Partial<Pick<ResultEvent, 'ok' | 'summary' | 'output' | 'outputTruncated' | 'detail'>> = {}
): RunEvent {
  return { type: 'tool_result', runId: R, seq, at: 0, toolUseId: id, ok: true, summary: 'ok', ...over }
}

function think(
  seq: number, body: string, over: Partial<Extract<RunEvent, { type: 'reasoning' }>> = {}
): RunEvent {
  return { type: 'reasoning', runId: R, seq, at: 0, text: body, startedAt: null, endedAt: null, ...over }
}

function notice(seq: number, kind: NoticeKind, body: string, toolUseId?: string): RunEvent {
  return {
    type: 'notice', runId: R, seq, at: 0, kind, text: body,
    ...(toolUseId === undefined ? {} : { toolUseId })
  }
}

/** 하위 에이전트 호출 P가 낳은 이벤트 — 어댑터가 실어 준 `parentToolUseId` */
function under(parent: string, event: RunEvent): RunEvent {
  return { ...event, parentToolUseId: parent } as RunEvent
}

function timed(at: number, event: RunEvent): RunEvent {
  return { ...event, at }
}

const shell = (over: Partial<Extract<ResultDetail, { kind: 'shell' }>> = {}): ResultDetail =>
  ({ kind: 'shell', exitCode: null, interrupted: false, timedOut: false, ...over })

function text(seq: number, body: string): RunEvent {
  return { type: 'text', runId: R, seq, at: 0, text: body }
}

function use(seq: number, id: string, name: string, input: unknown = {}): RunEvent {
  return {
    type: 'tool_use', runId: R, seq, at: 0, toolUseId: id, name,
    effect: 'other', targetPaths: [], input
  }
}

function done(seq: number, id: string, summary = 'ok', ok = true): RunEvent {
  return { type: 'tool_result', runId: R, seq, at: 0, toolUseId: id, ok, summary }
}

function fail(seq: number, id: string, summary = '오류'): RunEvent {
  return done(seq, id, summary, false)
}

function error(seq: number, message: string): RunEvent {
  return { type: 'error', runId: R, seq, at: 0, message }
}

function raw(seq: number, line: string): RunEvent {
  return { type: 'raw', runId: R, seq, at: 0, line }
}

type TurnRun = Parameters<typeof projectTurn>[0]

function turn(over: Partial<TurnRun> = {}): TurnRun {
  return { status: 'succeeded', resultText: null, errorMessage: null, cwd: '/repo', startedAt: null, ...over }
}

const kinds = (blocks: TimelineBlock[]) => blocks.map((b) => b.kind)

function only<K extends TimelineBlock['kind']>(
  blocks: TimelineBlock[], kind: K
): Extract<TimelineBlock, { kind: K }> {
  const found = blocks.filter((b) => b.kind === kind)
  expect(found).toHaveLength(1)
  return found[0] as Extract<TimelineBlock, { kind: K }>
}

describe('toolLabelOf', () => {
  it('claude와 opencode의 대소문자 두 벌이 같은 칸을 쓴다', () => {
    expect(toolLabelOf('Read')).toEqual({ label: '읽기', category: 'read' })
    expect(toolLabelOf('read')).toEqual(toolLabelOf('Read'))
    expect(toolLabelOf('Bash')).toEqual(toolLabelOf('bash'))
    expect(toolLabelOf('WebFetch')).toEqual(toolLabelOf('webfetch'))
  })

  it('표의 행마다 라벨과 종류를 얻는다 (spec FR-4)', () => {
    const table: Array<[string, string, string]> = [
      ['read', '읽기', 'read'],
      ['edit', '편집', 'edit'], ['multiedit', '편집', 'edit'], ['write', '작성', 'edit'],
      ['notebookedit', '노트북 편집', 'edit'], ['patch', '패치', 'edit'],
      ['bash', '셸', 'shell'], ['bashoutput', '셸', 'shell'],
      ['killshell', '셸', 'shell'], ['killbash', '셸', 'shell'],
      ['grep', 'Grep', 'search'], ['glob', 'Glob', 'search'],
      ['ls', '목록', 'search'], ['list', '목록', 'search'],
      ['webfetch', '웹 가져오기', 'web'], ['websearch', '웹 검색', 'web'],
      ['todowrite', '할 일', 'todo'], ['todoread', '할 일', 'todo'],
      ['taskcreate', '할 일', 'todo'], ['taskupdate', '할 일', 'todo'],
      ['taskget', '할 일', 'todo'], ['tasklist', '할 일', 'todo'],
      ['task', '하위 에이전트', 'subagent'], ['agent', '하위 에이전트', 'subagent'],
      ['skill', '스킬', 'other'],
      // conversation-events FR-42 — Windows의 claude 셸, opencode의 패치
      ['powershell', '셸', 'shell'], ['apply_patch', '패치', 'edit']
    ]
    for (const [name, label, category] of table) {
      expect(toolLabelOf(name), name).toEqual({ label, category })
    }
  })

  it('표의 키는 전부 소문자다 — 소문자로 바꿔 찾으므로 대문자 키는 영영 안 걸린다', () => {
    for (const key of Object.keys(TOOL_LABELS)) expect(key).toBe(key.toLowerCase())
  })

  it('MCP 도구는 서버를 떼고 도구 이름만으로 부른다 — 백틱도 "호출"도 붙이지 않는다', () => {
    // 이름을 모노로 그리는 것은 화면이다(spec §8의 5, 결정 2026-09-27). 라벨에 백틱을 담으면
    // 렌더되지 않은 마크다운처럼 글자로 보이고, "호출 사용됨"은 어색하게 읽혔다.
    expect(toolLabelOf('mcp__onedesk__list_issues'))
      .toEqual({ label: 'list_issues', category: 'mcp' })
    // 서버 이름 안의 밑줄 하나는 구분자가 아니다.
    expect(toolLabelOf('mcp__claude_ai_Gmail__search_threads'))
      .toEqual({ label: 'search_threads', category: 'mcp' })
  })

  it('표에 없는 이름은 버리지 않고 그대로 보인다', () => {
    expect(toolLabelOf('FancyNewTool')).toEqual({ label: 'FancyNewTool', category: 'other' })
    // 프로토타입의 속성을 표의 칸으로 집지 않는다.
    expect(toolLabelOf('constructor')).toEqual({ label: 'constructor', category: 'other' })
  })

  it('이름을 못 읽은 도구도 라벨이 빈 채로 남지 않는다', () => {
    expect(toolLabelOf('')).toEqual({ label: '도구', category: 'other' })
  })
})

describe('toolSubtitleOf', () => {
  it('셸 명령은 첫 줄만 쓴다', () => {
    expect(toolSubtitleOf({ command: 'pnpm test\necho done', description: '테스트' }, '/repo'))
      .toBe('pnpm test')
  })

  it('파일 경로는 작업 디렉토리 기준 상대 경로다', () => {
    expect(toolSubtitleOf({ file_path: '/repo/src/auth.ts' }, '/repo')).toBe('src/auth.ts')
    expect(toolSubtitleOf({ filePath: '/repo/src/auth.ts' }, '/repo/')).toBe('src/auth.ts')
    expect(toolSubtitleOf({ notebook_path: '/repo/a.ipynb' }, '/repo')).toBe('a.ipynb')
  })

  it('Windows 경로 — 구분자와 드라이브 글자의 대소문자를 같게 본다', () => {
    expect(toolSubtitleOf({ file_path: 'c:\\repo\\src\\auth.ts' }, 'C:\\repo')).toBe('src\\auth.ts')
    expect(toolSubtitleOf({ file_path: 'C:\\repo\\src\\a.ts' }, 'C:/repo')).toBe('src\\a.ts')
    expect(toolSubtitleOf({ filePath: 'D:/repo/x.ts' }, 'D:\\repo\\')).toBe('x.ts')
  })

  it('작업 디렉토리 밖이면 전체 경로다 — 경로 경계에서만 자른다', () => {
    expect(toolSubtitleOf({ file_path: '/other/a.ts' }, '/repo')).toBe('/other/a.ts')
    expect(toolSubtitleOf({ file_path: '/repo2/a.ts' }, '/repo')).toBe('/repo2/a.ts')
  })

  it('우선순위는 command → 경로 → pattern → url → query → description → subject다', () => {
    expect(toolSubtitleOf({ file_path: '/repo/a.ts', command: 'ls' }, '/repo')).toBe('ls')
    expect(toolSubtitleOf({ pattern: 'expiresAt', file_path: '/repo/a.ts' }, '/repo')).toBe('a.ts')
    expect(toolSubtitleOf({ url: 'https://e.x', pattern: 'p' }, '/repo')).toBe('p')
    expect(toolSubtitleOf({ query: 'q', url: 'https://e.x' }, '/repo')).toBe('https://e.x')
    expect(toolSubtitleOf({ description: 'd', query: 'q' }, '/repo')).toBe('q')
    expect(toolSubtitleOf({ subject: 's', description: 'd' }, '/repo')).toBe('d')
    expect(toolSubtitleOf({ subject: 's' }, '/repo')).toBe('s')
  })

  it('문자열이 아닌 값은 쓰지 않는다 — 객체를 늘어놓으면 한 줄이 읽히지 않는다', () => {
    expect(toolSubtitleOf({ command: 42, pattern: 'x' }, '/repo')).toBe('x')
    expect(toolSubtitleOf({ file_path: { a: 1 } }, '/repo')).toBe('')
  })

  it('할 일 목록은 몇 개 중 몇 개를 끝냈는지다', () => {
    expect(toolSubtitleOf({
      todos: [{ status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }]
    }, '/repo')).toBe('3개 중 1개 완료')
  })

  it('찾을 것이 없으면 빈 문자열이다', () => {
    expect(toolSubtitleOf({}, '/repo')).toBe('')
    expect(toolSubtitleOf(null, '/repo')).toBe('')
    expect(toolSubtitleOf('문자열', '/repo')).toBe('')
    expect(toolSubtitleOf(['x'], '/repo')).toBe('')
  })
})

describe('projectTurn — 이벤트에서 블록으로 (FR-2)', () => {
  it('text는 text 블록이고, 공백뿐이면 버린다', () => {
    const { blocks } = projectTurn(turn(), [text(0, '먼저 봅니다.'), text(1, '  \n ')])
    expect(blocks).toEqual([{ kind: 'text', key: 'text:0', text: '먼저 봅니다.' }])
  })

  it('편집이 아닌 도구는 활동 묶음이고, 연속되면 한 묶음에 붙는다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Read', { file_path: '/repo/a.ts' }), done(1, 'a'),
      use(2, 'b', 'Grep', { pattern: 'x' }), done(3, 'b')
    ])
    const activity = only(blocks, 'activity')
    expect(activity.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(activity.items[0]!.subtitle).toBe('a.ts')
    expect(activity.items[0]!.subtitlePath).toBe(true)
    // 검색어는 경로가 아니다 — 화면은 경로만 모노로 그린다(spec §8의 7).
    expect(activity.items[1]!.subtitlePath).toBe(false)
    expect(activity.items[0]!.state).toBe('done')
    expect(activity.items[0]!.output).toBe('ok')
  })

  it('편집 계열은 edit 블록이고, 연속되면 한 블록에 붙는다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Edit', { file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' }),
      done(1, 'a'),
      use(2, 'b', 'Write', { file_path: '/repo/b.ts', content: 'z' }),
      done(3, 'b')
    ])
    expect(kinds(blocks)).toEqual(['edit'])
    expect(only(blocks, 'edit').files.map((f) => f.displayPath)).toEqual(['a.ts', 'b.ts'])
  })

  it('실패한 도구는 묶음을 끊고 제자리에 따로 선다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Read'), done(1, 'a'),
      use(2, 'b', 'Bash', { command: 'pnpm lint' }), fail(3, 'b', 'lint 오류'),
      use(4, 'c', 'Grep'), done(5, 'c')
    ])
    expect(kinds(blocks)).toEqual(['activity', 'tool-error', 'activity'])
    const failed = only(blocks, 'tool-error')
    expect(failed.item.state).toBe('failed')
    expect(failed.item.output).toBe('lint 오류')
    expect(failed.item.subtitle).toBe('pnpm lint')
    expect(failed.item.subtitlePath).toBe(false)
  })

  it('실패한 편집도 edit 블록이 아니라 실패 줄이다 — 일어나지 않은 변경이다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Edit', { file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' }),
      fail(1, 'a', 'old_string을 찾지 못했습니다')
    ])
    expect(kinds(blocks)).toEqual(['tool-error'])
  })

  it('error는 error 블록이다', () => {
    const { blocks } = projectTurn(turn(), [error(0, '연결이 끊겼습니다')])
    expect(blocks).toEqual([{ kind: 'error', key: 'error:0', message: '연결이 끊겼습니다' }])
  })

  it('연속된 raw는 공지 하나로 합친다', () => {
    const { blocks } = projectTurn(turn(), [raw(0, '{깨짐'), raw(1, '또 깨짐'), text(2, '계속'), raw(3, 'x')])
    expect(kinds(blocks)).toEqual(['notice', 'text', 'notice'])
    expect(blocks[0]).toEqual({
      kind: 'notice', key: 'notice:0', text: '해석하지 못한 출력 2줄', lines: ['{깨짐', '또 깨짐'],
      // conversation-events FR-41 — 새 공지와 같은 종류다
      noticeKind: 'raw', count: 2
    })
    expect(blocks[2]).toMatchObject({ text: '해석하지 못한 출력 1줄', lines: ['x'] })
  })

  it('session·usage·result는 그리지 않는다', () => {
    const usage: RunUsage = {
      model: 'm', inputTokens: 1, outputTokens: 1, cacheReadTokens: null,
      cacheWriteTokens: null, reasoningTokens: null, costUsd: null,
      contextTokens: null, contextWindow: null
    }
    const { blocks } = projectTurn(turn(), [
      { type: 'session', runId: R, seq: 0, at: 0, sessionId: 's' },
      { type: 'usage', runId: R, seq: 1, at: 0, usage },
      {
        type: 'result', runId: R, seq: 2, at: 0, status: 'succeeded',
        resultText: '같은 글이 두 번 나오면 안 된다', sessionId: 's', needsAnswer: false
      }
    ])
    expect(blocks).toEqual([])
  })

  it('text·edit·실패·error·공지가 활동 묶음을 끊는다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Read'), done(1, 'a'),
      text(2, '중간'),
      use(3, 'b', 'Read'), done(4, 'b'),
      use(5, 'c', 'Edit', { file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' }), done(6, 'c'),
      use(7, 'd', 'Read'), done(8, 'd'),
      error(9, '경고'),
      use(10, 'e', 'Read'), done(11, 'e'),
      raw(12, '?'),
      use(13, 'f', 'Read'), done(14, 'f')
    ])
    expect(kinds(blocks)).toEqual([
      'activity', 'text', 'activity', 'edit', 'activity', 'error', 'activity', 'notice', 'activity'
    ])
  })

  it('블록 key는 첫 이벤트의 seq로 만든다 — 이벤트가 붙어도 key가 그대로다 (FR-15)', () => {
    const first = projectTurn(turn({ status: 'running' }), [use(4, 'a', 'Read')])
    const later = projectTurn(turn({ status: 'running' }), [
      use(4, 'a', 'Read'), done(5, 'a'), use(6, 'b', 'Grep')
    ])
    expect(first.blocks[0]!.key).toBe('activity:4')
    expect(later.blocks[0]!.key).toBe('activity:4')
  })
})

describe('projectTurn — 짝짓기 (FR-3)', () => {
  it('결과가 use보다 먼저 와도 id로 짝짓는다', () => {
    const { blocks } = projectTurn(turn(), [done(0, 'a', '먼저 온 결과'), use(1, 'a', 'Read')])
    expect(only(blocks, 'activity').items[0]).toMatchObject({ state: 'done', output: '먼저 온 결과' })
  })

  it('id가 비면 짝짓지 않는다 — seq로 id를 만든다', () => {
    const { blocks } = projectTurn(turn(), [use(3, '', 'Read'), done(4, '')])
    expect(only(blocks, 'activity').items[0]).toMatchObject({
      id: 'seq:3', state: 'unknown', output: null
    })
  })

  it('use가 없는 결과는 버린다 — 스토어 상한에 앞이 잘렸을 수 있다', () => {
    expect(projectTurn(turn(), [done(0, 'ghost', '고아'), text(1, '끝')]).blocks)
      .toEqual([{ kind: 'text', key: 'text:1', text: '끝' }])
  })

  it('결과 없는 use는 도는 중이면 running, 끝났으면 unknown이다', () => {
    const running = projectTurn(turn({ status: 'running' }), [use(0, 'a', 'Bash')])
    expect(only(running.blocks, 'activity')).toMatchObject({ running: true })
    expect(only(running.blocks, 'activity').items[0]!.state).toBe('running')

    const ended = projectTurn(turn({ status: 'interrupted' }), [use(0, 'a', 'Bash')])
    expect(only(ended.blocks, 'activity')).toMatchObject({ running: false })
    expect(only(ended.blocks, 'activity').items[0]!.state).toBe('unknown')
  })

  it('도는 편집이 있으면 edit 블록도 running이다', () => {
    const { blocks } = projectTurn(turn({ status: 'running' }), [
      use(0, 'a', 'Edit', { file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' })
    ])
    expect(only(blocks, 'edit').running).toBe(true)
  })
})

describe('projectTurn — 검색 결과 개수 (FR-5)', () => {
  // 이 장비의 실제 run 로그로 확인한 형식이다 (claude Grep의 files_with_matches, 2026-09-27).
  it('검색 도구의 결과가 "Found N "으로 시작하면 N개 일치다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Grep', { pattern: 'WATERSIDE' }),
      done(1, 'a', 'Found 7 files\napp\\src\\main\\SoundCatalog.kt\napp\\src\\main\\Habitat…'),
      use(2, 'b', 'Grep', { pattern: 'enum class' }),
      done(3, 'b', 'Found 1 file\napp\\src\\main\\BirdBehavior.kt')
    ])
    expect(only(blocks, 'activity').items.map((i) => i.matches)).toEqual([7, 1])
  })

  it('형식이 다르면 null이다 — 200자 요약에서 줄을 세지 않는다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Grep', { pattern: 'x', output_mode: 'content' }),
      done(1, 'a', 'src\\a.ts:3:x\nsrc\\b.ts:9:x'),
      use(2, 'b', 'Glob', { pattern: '**/*.ts' }),
      done(3, 'b', 'No files found')
    ])
    expect(only(blocks, 'activity').items.map((i) => i.matches)).toEqual([null, null])
  })

  it('검색 종류가 아니면 같은 글자라도 개수를 읽지 않는다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Bash', { command: 'grep -c x' }), done(1, 'a', 'Found 3 files')
    ])
    expect(only(blocks, 'activity').items[0]!.matches).toBeNull()
  })
})

describe('projectTurn — 활동 묶음 라벨 (FR-6)', () => {
  it('개수와 처음 나온 순서의 고유 라벨이다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Read'), done(1, 'a'),
      use(2, 'b', 'Read'), done(3, 'b'),
      use(4, 'c', 'Grep'), done(5, 'c'),
      use(6, 'd', 'Bash'), done(7, 'd'),
      use(8, 'e', 'read'), done(9, 'e')
    ])
    expect(only(blocks, 'activity').label).toBe('5 읽기, Grep, 셸 사용됨')
  })

  it('라벨 조각도 종류와 함께 준다 — 화면이 mcp 이름만 모노로 그린다 (spec §8의 5)', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Read'), done(1, 'a'),
      use(2, 'b', 'mcp__onedesk__list_issues'), done(3, 'b'),
      use(4, 'c', 'mcp__onedesk__list_issues'), done(5, 'c')
    ])
    const activity = only(blocks, 'activity')
    expect(activity.label).toBe('3 읽기, list_issues 사용됨')
    expect(activity.labels).toEqual([
      { label: '읽기', category: 'read' },
      { label: 'list_issues', category: 'mcp' }
    ])
  })

  it('도는 항목이 하나라도 있으면 묶음도 running이다', () => {
    const { blocks } = projectTurn(turn({ status: 'running' }), [
      use(0, 'a', 'Read'), done(1, 'a'), use(2, 'b', 'Grep')
    ])
    expect(only(blocks, 'activity').running).toBe(true)
  })
})

describe('projectTurn — 편집 블록 (FR-7)', () => {
  it('claude Edit은 old → new 한 hunk다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Edit', { file_path: '/repo/src/auth.ts', old_string: 'a < b', new_string: 'a <= b' }),
      done(1, 'a')
    ])
    const [file] = only(blocks, 'edit').files
    expect(file).toMatchObject({
      path: '/repo/src/auth.ts', displayPath: 'src/auth.ts', created: false,
      added: 1, removed: 1, truncated: 0
    })
    expect(file!.hunks).toHaveLength(1)
    expect(file!.hunks[0]!.lines).toEqual([
      { sign: '-', text: 'a < b' }, { sign: '+', text: 'a <= b' }
    ])
  })

  it('opencode edit도 같은 모양이 된다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'edit', { filePath: '/repo/x.ts', oldString: 'old', newString: 'new' }),
      done(1, 'a')
    ])
    expect(only(blocks, 'edit').files[0]).toMatchObject({ displayPath: 'x.ts', added: 1, removed: 1 })
  })

  it('MultiEdit은 edit마다 hunk 하나다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'MultiEdit', {
        file_path: '/repo/a.ts',
        edits: [{ old_string: 'x', new_string: 'y' }, { old_string: 'p\nq', new_string: 'p' }]
      }),
      done(1, 'a')
    ])
    const [file] = only(blocks, 'edit').files
    expect(file!.hunks).toHaveLength(2)
    expect(file).toMatchObject({ added: 1, removed: 2 })
  })

  it('Write는 전부 추가이고 새로 쓴 것으로 표시한다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Write', { file_path: '/repo/new.ts', content: 'one\ntwo\n' }), done(1, 'a'),
      use(2, 'b', 'write', { filePath: '/repo/oc.ts', content: 'OK' }), done(3, 'b')
    ])
    const files = only(blocks, 'edit').files
    expect(files[0]).toMatchObject({ created: true, added: 2, removed: 0 })
    expect(files[1]).toMatchObject({ created: true, added: 1, displayPath: 'oc.ts' })
  })

  it('모양을 모르는 편집은 diff 없이 경로만이다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'NotebookEdit', { notebook_path: '/repo/n.ipynb', new_source: 'x' }), done(1, 'a')
    ])
    expect(only(blocks, 'edit').files[0]).toMatchObject({
      displayPath: 'n.ipynb', hunks: [], added: 0, removed: 0, created: false
    })
  })

  it('경로를 모르는 편집은 도구 이름으로 보이고, 서로 합치지 않는다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'patch', { patchText: '*** Begin Patch' }), done(1, 'a'),
      use(2, 'b', 'patch', { patchText: '*** Begin Patch' }), done(3, 'b')
    ])
    const files = only(blocks, 'edit').files
    expect(files).toHaveLength(2)
    expect(files[0]).toMatchObject({ path: '', displayPath: '패치', hunks: [] })
  })

  it('같은 파일은 한 줄로 합친다 — hunk가 여럿이 된다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Edit', { file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' }), done(1, 'a'),
      use(2, 'b', 'Edit', { file_path: '/repo/b.ts', old_string: 'm', new_string: 'n' }), done(3, 'b'),
      use(4, 'c', 'Edit', { file_path: '/repo/a.ts', old_string: 'p', new_string: 'q\nr' }), done(5, 'c')
    ])
    const files = only(blocks, 'edit').files
    expect(files.map((f) => f.displayPath)).toEqual(['a.ts', 'b.ts'])
    expect(files[0]!.hunks).toHaveLength(2)
    expect(files[0]).toMatchObject({ added: 3, removed: 2 })
    // 파일 줄의 열림은 자리 순번이 아니라 이 id들에 매단다(FR-15 다듬음) — 앞 파일이 실패로 빠져
    // 순번이 밀려도 열어 둔 줄이 닫히거나 남의 열림을 이어받지 않는다.
    expect(files.map((f) => f.ids)).toEqual([['a', 'c'], ['b']])
  })

  it('id 없는 편집은 seq로 가른다 — 도구 한 줄과 같은 규칙이다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, '', 'Write', { file_path: '/repo/n.ts', content: 'x' })
    ])
    expect(only(blocks, 'edit').files[0]!.ids).toEqual(['seq:0'])
  })

  it('한 파일은 400줄까지 그리고 +N −M은 자르기 전에서 센다', () => {
    const content = Array.from({ length: 450 }, (_, i) => `line ${i}`).join('\n')
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Write', { file_path: '/repo/big.ts', content }), done(1, 'a')
    ])
    const [file] = only(blocks, 'edit').files
    expect(file).toMatchObject({ added: 450, removed: 0, truncated: 50 })
    expect(file!.hunks.flatMap((h) => h.lines)).toHaveLength(400)
  })
})

describe('projectTurn — 답과 중복 방지 (FR-8)', () => {
  it('도는 중이면 답은 지금까지의 마지막 text이고, 블록에도 제자리로 남는다', () => {
    const { answer, blocks } = projectTurn(turn({ status: 'running' }), [
      text(0, '먼저 봅니다.'), use(1, 'a', 'Read'), done(2, 'a'), text(3, '이제 고칩니다.')
    ])
    expect(answer).toEqual({ text: '이제 고칩니다.', final: false })
    expect(kinds(blocks)).toEqual(['text', 'activity', 'text'])
  })

  it('도는 중인데 text가 없으면 답이 없다', () => {
    expect(projectTurn(turn({ status: 'running' }), [use(0, 'a', 'Read')]).answer).toBeNull()
  })

  it('끝났으면 답은 resultText다', () => {
    const { answer } = projectTurn(turn({ resultText: '고쳤습니다.' }), [text(0, '중간')])
    expect(answer).toEqual({ text: '고쳤습니다.', final: true })
  })

  it('끝났는데 resultText가 없으면 스토어에 text가 있어도 답이 없다', () => {
    // 앱을 다시 켜면 스토어가 빈다 — 스토어에 기대면 같은 턴이 재시작 전후로 다르게 보인다.
    const { answer, blocks } = projectTurn(turn({ status: 'failed', resultText: null }), [text(0, '중간')])
    expect(answer).toBeNull()
    expect(kinds(blocks)).toEqual(['text'])
    expect(projectTurn(turn({ resultText: '  \n' }), []).answer).toBeNull()
  })

  it('대기 중이면 답이 없다', () => {
    expect(projectTurn(turn({ status: 'pending', resultText: '?' }), []).answer).toBeNull()
  })

  // 아래 셋은 옛 로그 뷰의 테스트에서 옮겨 왔다(그 뷰는 plan 4단계에서 블록으로 바뀌며
  // 지워졌다) — claude는 마지막 assistant 텍스트를 흘린 뒤 result에 같은 내용을 다시 담는다.
  it('마지막 text가 답과 같으면 블록에서 빠진다 — 같은 답이 두 번 나오지 않는다', () => {
    const { answer, blocks } = projectTurn(
      turn({ resultText: '작업을 마쳤습니다.' }), [text(0, '작업을 마쳤습니다.')]
    )
    expect(answer).toEqual({ text: '작업을 마쳤습니다.', final: true })
    expect(blocks).toEqual([])
  })

  it('답과 다른 text는 둘 다 남는다', () => {
    const { answer, blocks } = projectTurn(
      turn({ resultText: '최종 결과는 다릅니다' }), [text(0, '중간 보고')]
    )
    expect(answer!.text).toBe('최종 결과는 다릅니다')
    expect(blocks).toEqual([{ kind: 'text', key: 'text:0', text: '중간 보고' }])
  })

  it('공백 차이만 있어도 같은 내용으로 본다', () => {
    const { blocks } = projectTurn(turn({ resultText: '같은 말' }), [text(0, '  같은 말  ')])
    expect(blocks).toEqual([])
  })

  it('비교하는 것은 마지막 text 블록 하나뿐이다', () => {
    const { blocks } = projectTurn(turn({ resultText: 'A' }), [text(0, 'A'), text(1, 'B')])
    expect(blocks.map((b) => (b.kind === 'text' ? b.text : b.kind))).toEqual(['A', 'B'])
  })

  it('실패의 errorMessage가 마지막 error 블록과 같으면 그 블록을 뺀다 — 오류 카드와 겹친다', () => {
    const same = projectTurn(
      turn({ status: 'failed', errorMessage: '인증 실패' }),
      [error(0, '먼저 난 경고'), error(1, '인증 실패')]
    )
    expect(same.blocks).toEqual([{ kind: 'error', key: 'error:0', message: '먼저 난 경고' }])

    const other = projectTurn(
      turn({ status: 'failed', errorMessage: '종료 코드 1' }), [error(0, '인증 실패')]
    )
    expect(kinds(other.blocks)).toEqual(['error'])
  })
})

describe('projectTurn — 접힌 턴의 두 값 (FR-9)', () => {
  it('요약은 도구 수와 실패 수다', () => {
    const { summary } = projectTurn(turn(), [
      use(0, 'a', 'Read'), done(1, 'a'),
      use(2, 'b', 'Bash'), fail(3, 'b'),
      use(4, 'c', 'Edit', { file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' }), done(5, 'c')
    ])
    // conversation-events FR-39가 거부·압축 두 칸을 더했다 — 옛 로그에는 둘 다 없다
    expect(summary).toEqual({ tools: 3, failed: 1, denied: 0, compacted: false })
  })

  it('도구가 없으면 요약이 없다', () => {
    expect(projectTurn(turn(), [text(0, '말만 했다')]).summary).toBeNull()
  })

  it('claude 모양 — 도는 중이면 결과가 아직 없는 마지막 도구가 지금 도는 도구다', () => {
    const { current } = projectTurn(turn({ status: 'running' }), [
      use(0, 'a', 'Read'), done(1, 'a'),
      use(2, 'b', 'Grep', { pattern: 'x' }),
      use(3, 'c', 'Bash', { command: 'pnpm test' })
    ])
    expect(current).toMatchObject({ id: 'c', label: '셸', subtitle: 'pnpm test', state: 'running' })
  })

  it('opencode 모양 — 도구가 결과와 함께 오므로 지금 도는 도구가 없다', () => {
    const { current } = projectTurn(turn({ status: 'running' }), [
      use(0, 'call-1', 'bash', { command: 'ls' }), done(1, 'call-1')
    ])
    expect(current).toBeNull()
  })

  it('끝난 턴에는 지금 도는 도구가 없다', () => {
    expect(projectTurn(turn({ status: 'interrupted' }), [use(0, 'a', 'Bash')]).current).toBeNull()
  })
})

/*
 * 아래는 `docs/sdlc/conversation-events/` spec FR-35~42 — 어댑터가 버리던 것(원문 출력·구조화된
 * 세부·생각·하위 에이전트·공지)을 투영에 채우는 규칙이다. **새 필드가 없으면 위 TL 규칙 그대로다** —
 * 위의 테스트가 고치지 않고 초록인 것이 옛 로그 호환의 증명이다(요약 모양이 넓어진 단언만 고쳤다).
 */

const itemOf = (blocks: TimelineBlock[], id: string): ToolItem => {
  const found: ToolItem[] = []
  const walk = (list: TimelineBlock[]) => {
    for (const block of list) {
      if (block.kind === 'activity') found.push(...block.items.filter((i) => i.id === id))
      if (block.kind === 'tool-error' && block.item.id === id) found.push(block.item)
      if (block.kind === 'subagent') {
        if (block.item.id === id) found.push(block.item)
        walk(block.blocks)
      }
    }
  }
  walk(blocks)
  expect(found).toHaveLength(1)
  return found[0]!
}

describe('projectTurn — 도구 한 줄의 새 값 (events FR-36)', () => {
  it('output은 원문 끝부분이 있으면 그것, 없으면 200자 요약이다 — 어디서 왔는지 함께 준다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Bash', { command: 'pnpm test' }),
      res(1, 'a', { summary: '요약…', output: '…끝부분\nPASS', outputTruncated: 12_345 }),
      use(2, 'b', 'Bash', { command: 'ls' }), res(3, 'b', { summary: 'a.ts' }),
      use(4, 'c', 'Bash', { command: 'sleep 9' })
    ])
    expect(itemOf(blocks, 'a')).toMatchObject({ output: '…끝부분\nPASS', outputSource: 'full', outputTruncated: 12_345 })
    expect(itemOf(blocks, 'b')).toMatchObject({ output: 'a.ts', outputSource: 'summary', outputTruncated: 0 })
    expect(itemOf(blocks, 'c')).toMatchObject({ output: null, outputSource: null, outputTruncated: 0 })
  })

  it('셸 세부 — 종료 코드, 시간 초과가 중단보다 먼저다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Bash'), res(1, 'a', { ok: false, detail: shell({ exitCode: 2 }) }),
      use(2, 'b', 'Bash'), res(3, 'b', { detail: shell({ interrupted: true, timedOut: true }) }),
      use(4, 'c', 'PowerShell'), res(5, 'c', { detail: shell({ interrupted: true }) }),
      use(6, 'd', 'Bash'), res(7, 'd')
    ])
    expect(itemOf(blocks, 'a')).toMatchObject({ exitCode: 2, stopped: null })
    expect(itemOf(blocks, 'b')).toMatchObject({ exitCode: null, stopped: 'timed_out' })
    expect(itemOf(blocks, 'c')).toMatchObject({ stopped: 'interrupted', category: 'shell' })
    expect(itemOf(blocks, 'd')).toMatchObject({ exitCode: null, stopped: null })
  })

  it('검색 세부 — 개수·단위·잘림이 있으면 그것이 `Found N`을 이긴다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'grep', { pattern: 'x' }),
      res(1, 'a', { summary: 'Found 99 files', detail: { kind: 'search', count: 12, unit: 'matches', truncated: true } }),
      use(2, 'b', 'Grep', { pattern: 'y', output_mode: 'content' }),
      res(3, 'b', { detail: { kind: 'search', count: 7, unit: 'lines', truncated: false } })
    ])
    expect(itemOf(blocks, 'a')).toMatchObject({ matches: 12, matchUnit: 'matches', matchesTruncated: true })
    expect(itemOf(blocks, 'b')).toMatchObject({ matches: 7, matchUnit: 'lines', matchesTruncated: false })
  })

  it('검색 세부가 없으면 `Found N`은 파일 수다 — claude Grep files_with_matches의 출력이다 (§7 우려 16)', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Grep', { pattern: 'x' }), res(1, 'a', { summary: 'Found 3 files\nsrc/a.ts' }),
      use(2, 'b', 'Glob', { pattern: '*' }), res(3, 'b', { summary: 'No files found' })
    ])
    expect(itemOf(blocks, 'a')).toMatchObject({ matches: 3, matchUnit: 'files', matchesTruncated: false })
    expect(itemOf(blocks, 'b')).toMatchObject({ matches: null, matchUnit: null, matchesTruncated: false })
  })

  it('denied — 같은 id의 권한 거부 공지가 턴 안에 있을 때만', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Bash', { command: 'rm -rf x' }), res(1, 'a', { ok: false, summary: '거부됨' }),
      notice(2, 'permission_denied', '권한 때문에 막힘: Bash', 'a'),
      use(3, 'b', 'Bash', { command: 'ls' }), res(4, 'b', { ok: false })
    ])
    expect(itemOf(blocks, 'a').denied).toBe(true)
    expect(itemOf(blocks, 'b').denied).toBe(false)
  })

  it('거부됐는데 결과가 아직 없으면 도는 것이 아니라 실패다 — 막힌 호출은 돌지 않는다', () => {
    const projection = projectTurn(turn({ status: 'running' }), [
      use(0, 'a', 'Bash', { command: 'rm -rf x' }), notice(1, 'permission_denied', '권한 때문에 막힘: Bash', 'a')
    ])
    expect(itemOf(projection.blocks, 'a')).toMatchObject({ state: 'failed', denied: true })
    expect(projection.current).toBeNull()
  })

  it('parentToolUseId — 이벤트에 있으면 그 값, 없으면 null이다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Read'), done(1, 'a'),
      under('ghost', use(2, 'b', 'Read')), under('ghost', done(3, 'b'))
    ])
    expect(itemOf(blocks, 'a').parentToolUseId).toBeNull()
    expect(itemOf(blocks, 'b').parentToolUseId).toBe('ghost')
  })

  it('하위 에이전트 세부 — 네 값, 없으면 null이다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Agent', { description: '조사' }),
      res(1, 'a', { detail: { kind: 'subagent', sessionId: null, model: 'claude-haiku-5', toolCount: 12, durationMs: 34_000 } }),
      use(2, 'b', 'task', { description: '조사 2' }), res(3, 'b')
    ])
    expect(itemOf(blocks, 'a').subagent).toEqual({ sessionId: null, model: 'claude-haiku-5', toolCount: 12, durationMs: 34_000 })
    expect(itemOf(blocks, 'b').subagent).toBeNull()
  })

  it('모양이 어긋난 세부는 통째로 버린다 — 반쯤 맞는 세부는 거짓말을 한다', () => {
    const bad = [
      { kind: 'shell', exitCode: '2', interrupted: false, timedOut: false },
      { kind: 'search', count: 'many', unit: 'files', truncated: false },
      { kind: 'search', count: 3, unit: 'bytes', truncated: false },
      { kind: 'mystery' },
      'Error: 문자열'
    ]
    const events: RunEvent[] = []
    bad.forEach((detail, i) => {
      events.push(use(i * 2, `t${i}`, 'Grep', { pattern: 'x' }))
      events.push(res(i * 2 + 1, `t${i}`, { detail: detail as ResultDetail }))
    })
    const { blocks } = projectTurn(turn(), events)
    for (const [i] of bad.entries()) {
      expect(itemOf(blocks, `t${i}`)).toMatchObject({ exitCode: null, matches: null, matchUnit: null })
    }
  })
})

describe('projectTurn — 편집 블록의 줄 번호 (events FR-37)', () => {
  const EDIT_INPUT = { file_path: '/repo/src/auth.ts', old_string: 'a < b', new_string: 'a <= b' }

  function editDetail(files: Array<Partial<Extract<ResultDetail, { kind: 'edit' }>['files'][number]>>): ResultDetail {
    return {
      kind: 'edit',
      files: files.map((file) => ({
        path: '/repo/src/auth.ts', operation: 'edit', hunks: [], hunksTruncated: 0,
        added: null, removed: null, before: null, beforeMissing: null, ...file
      }))
    }
  }

  const HUNK = {
    oldStart: 41, oldLines: 3, newStart: 41, newLines: 3,
    lines: [' const a = 1', '-if (a < b) {', '+if (a <= b) {', ' }']
  }

  it('detail이 있으면 hunk로 번호 diff를 만든다 — LCS가 아니다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Edit', EDIT_INPUT),
      res(1, 'a', { detail: editDetail([{ hunks: [HUNK] }]) })
    ])
    const [file] = only(blocks, 'edit').files
    expect(file).toMatchObject({
      path: '/repo/src/auth.ts', displayPath: 'src/auth.ts', numbered: true, operation: 'edit',
      created: false, before: null, added: 1, removed: 1, truncated: 0
    })
    expect(file!.hunks[0]).toMatchObject({ oldStart: 41, newStart: 41, gapBefore: 40 })
    expect(file!.hunks[0]!.lines).toEqual([
      { sign: ' ', text: 'const a = 1', oldNo: 41, newNo: 41 },
      { sign: '-', text: 'if (a < b) {', oldNo: 42 },
      { sign: '+', text: 'if (a <= b) {', newNo: 42 },
      { sign: ' ', text: '}', oldNo: 43, newNo: 43 }
    ])
  })

  it('+N −M은 detail의 값이 먼저다 — 어댑터가 자르기 전에 센 수다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Edit', EDIT_INPUT),
      res(1, 'a', { detail: editDetail([{ hunks: [HUNK], added: 30, removed: 12, hunksTruncated: 38 }]) })
    ])
    // 어댑터가 버린 hunk 줄도 "… N줄 더"에 들어간다
    expect(only(blocks, 'edit').files[0]).toMatchObject({ added: 30, removed: 12, truncated: 38 })
  })

  it('새 파일은 hunk가 비어도 입력의 내용에 새 줄 번호 1..n을 단다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Write', { file_path: '/repo/new.ts', content: 'one\ntwo\n' }),
      res(1, 'a', { detail: editDetail([{ path: '/repo/new.ts', operation: 'create' }]) })
    ])
    const [file] = only(blocks, 'edit').files
    expect(file).toMatchObject({ created: true, operation: 'create', numbered: true, added: 2, removed: 0 })
    expect(file!.hunks[0]!.lines).toEqual([
      { sign: '+', text: 'one', newNo: 1 },
      { sign: '+', text: 'two', newNo: 2 }
    ])
  })

  it('덮어쓰기는 이전 내용을 넘기고, 편집의 before는 화면에 쓰지 않는다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Write', { file_path: '/repo/a.ts', content: 'new' }),
      res(1, 'a', {
        detail: editDetail([{
          path: '/repo/a.ts', operation: 'overwrite', before: 'old',
          hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }]
        }])
      }),
      use(2, 'b', 'Edit', EDIT_INPUT),
      res(3, 'b', { detail: editDetail([{ hunks: [HUNK], before: '원본 전체' }]) })
    ])
    const [write, edit] = only(blocks, 'edit').files
    expect(write).toMatchObject({ operation: 'overwrite', created: false, before: 'old', numbered: true })
    expect(edit).toMatchObject({ operation: 'edit', before: null })
  })

  it('hunk 없는 덮어쓰기(opencode write)는 입력 diff 그대로이고 새로 쓴 것이 아니다 — 지운 줄 수는 모른다', () => {
    // 리뷰 반영 2026-09-27: 입력으로 만든 "전부 추가" diff에서 세면 −0이 된다. 옛 내용을 모르는데 0이라고
    // 단정하면 100줄을 5줄로 덮어쓴 편집이 "더하기만 했다"로 읽힌다 — 모르는 것은 null이다.
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'write', { filePath: '/repo/oc.ts', content: 'x\ny' }),
      res(1, 'a', { detail: editDetail([{ path: '/repo/oc.ts', operation: 'overwrite', beforeMissing: 'unavailable' }]) })
    ])
    expect(only(blocks, 'edit').files[0]).toMatchObject({
      operation: 'overwrite', created: false, numbered: false, added: 2, removed: null, before: null
    })
  })

  it('지운 줄 수를 모르는 편집을 합치면 합친 줄의 지운 수도 모른다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Edit', { ...EDIT_INPUT, file_path: '/repo/oc.ts' }),
      res(1, 'a', { detail: editDetail([{ path: '/repo/oc.ts', hunks: [HUNK] }]) }),
      use(2, 'b', 'write', { filePath: '/repo/oc.ts', content: 'x\ny' }),
      res(3, 'b', { detail: editDetail([{ path: '/repo/oc.ts', operation: 'overwrite', beforeMissing: 'unavailable' }]) })
    ])
    expect(only(blocks, 'edit').files[0]).toMatchObject({ added: 3, removed: null })
  })

  it('파일 여럿(apply_patch)은 파일마다 한 줄이고 열림 키가 서로 다르다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'p', 'apply_patch', { patchText: '*** Begin Patch' }),
      res(1, 'p', {
        detail: editDetail([
          { path: '/repo/a.ts', hunks: [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ['-x', '+y'] }] },
          { path: '/repo/b.ts', operation: 'create', hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+z'] }] },
          { path: '/repo/c.ts', operation: 'delete' }
        ])
      })
    ])
    const files = only(blocks, 'edit').files
    expect(files.map((f) => f.displayPath)).toEqual(['a.ts', 'b.ts', 'c.ts'])
    expect(files.map((f) => f.operation)).toEqual(['edit', 'create', 'delete'])
    // 한 도구가 파일 셋을 고쳤다 — 같은 열림 키면 한 줄을 열 때 셋이 함께 열린다
    expect(files.map((f) => f.ids)).toEqual([['p'], ['p#1'], ['p#2']])
    expect(files[2]).toMatchObject({ hunks: [], numbered: false })
  })

  it('detail이 없거나 파일이 비었으면 입력으로 만든 번호 없는 diff다 (TL FR-7)', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Edit', EDIT_INPUT), res(1, 'a'),
      use(2, 'b', 'Edit', { ...EDIT_INPUT, file_path: '/repo/b.ts' }), res(3, 'b', { detail: { kind: 'edit', files: [] } })
    ])
    for (const file of only(blocks, 'edit').files) {
      expect(file).toMatchObject({ numbered: false, operation: null, before: null, added: 1, removed: 1 })
      expect(file.hunks[0]!.lines[0]).toEqual({ sign: '-', text: 'a < b' })
    }
  })

  it('같은 파일의 번호 diff 두 번은 한 줄로 합친다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Edit', EDIT_INPUT), res(1, 'a', { detail: editDetail([{ hunks: [HUNK] }]) }),
      use(2, 'b', 'Edit', EDIT_INPUT),
      res(3, 'b', { detail: editDetail([{ hunks: [{ ...HUNK, oldStart: 90, newStart: 90 }], added: 4, removed: 0 }]) })
    ])
    const files = only(blocks, 'edit').files
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ numbered: true, added: 5, removed: 1, ids: ['a', 'b'] })
    expect(files[0]!.hunks.map((h) => h.oldStart)).toEqual([41, 90])
  })

  it('합친 편집의 경계에는 간격(⋯ N줄)을 세지 않는다 — 편집마다 번호의 기준 파일이 다르다', () => {
    // 리뷰 반영 2026-09-27: 편집마다 첫 hunk의 gapBefore(= oldStart − 1)를 그대로 이어 붙이면, 둘째
    // 편집부터 "파일 맨 위부터의 줄 수"가 앞 hunk와의 간격처럼 그려졌다. 둘째 편집의 번호는 첫 편집이
    // 반영된 파일 기준이라 앞 편집과의 간격은 알 수 없다 — 셈 없는 hunk 경계(가는 선)로 둔다.
    const at = (oldStart: number) => ({ ...HUNK, oldStart, newStart: oldStart })
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Edit', EDIT_INPUT), res(1, 'a', { detail: editDetail([{ hunks: [at(41)] }]) }),
      use(2, 'b', 'Edit', EDIT_INPUT), res(3, 'b', { detail: editDetail([{ hunks: [at(45), at(60)] }]) }),
      use(4, 'c', 'Edit', EDIT_INPUT), res(5, 'c', { detail: editDetail([{ hunks: [at(10)] }]) })
    ])
    const [file] = only(blocks, 'edit').files
    expect(file!.hunks.map((h) => [h.oldStart, h.gapBefore])).toEqual([
      [41, 40],
      // 둘째 편집의 첫 hunk — 앞 편집과의 간격은 모른다
      [45, undefined],
      // 같은 편집 안의 hunk 사이는 그대로 잰다(45 + 3 → 60)
      [60, 12],
      [10, undefined]
    ])
  })
})

describe('projectTurn — 하위 에이전트 카드 (events FR-38)', () => {
  const CALL = { description: '인증 조사', prompt: '조사해', subagent_type: 'Explore' }

  it('하위 에이전트 호출은 묶음에 들지 않고 카드 하나다 — 묶음을 끊는다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Read'), done(1, 'a'),
      use(2, 'g', 'Task', CALL), done(3, 'g', '보고'),
      use(4, 'b', 'Read'), done(5, 'b')
    ])
    expect(kinds(blocks)).toEqual(['activity', 'subagent', 'activity'])
    const card = only(blocks, 'subagent')
    expect(card).toMatchObject({ key: 'subagent:2', blocks: [], tools: 0, failed: 0, denied: 0, running: false })
    expect(card.item).toMatchObject({ id: 'g', subtitle: '인증 조사', output: '보고', state: 'done' })
  })

  it('parentToolUseId가 P인 이벤트는 P의 카드 안에 같은 규칙으로 그린다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'g', 'Agent', CALL),
      under('g', use(1, 'c1', 'Read', { file_path: '/repo/a.ts' })), under('g', done(2, 'c1')),
      under('g', use(3, 'c2', 'Grep', { pattern: 'x' })), under('g', done(4, 'c2')),
      under('g', use(5, 'c3', 'Edit', { file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' })),
      under('g', done(6, 'c3')),
      done(7, 'g')
    ])
    expect(kinds(blocks)).toEqual(['subagent'])
    const card = only(blocks, 'subagent')
    expect(kinds(card.blocks)).toEqual(['activity', 'edit'])
    expect(only(card.blocks, 'activity').items.map((i) => i.id)).toEqual(['c1', 'c2'])
    expect(card).toMatchObject({ tools: 3, failed: 0 })
  })

  it('중첩된 에이전트는 카드 안의 카드다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'g1', 'Agent', CALL),
      under('g1', use(1, 'g2', 'Agent', { description: '더 깊이' })),
      under('g2', use(2, 'c', 'Read')), under('g2', done(3, 'c')),
      under('g1', done(4, 'g2')), done(5, 'g1')
    ])
    const outer = only(blocks, 'subagent')
    const inner = only(outer.blocks, 'subagent')
    expect(inner.item.id).toBe('g2')
    expect(only(inner.blocks, 'activity').items[0]!.id).toBe('c')
    expect(outer.tools).toBe(1)
  })

  it('부모 호출이 목록에 없으면(창 때문에 앞이 잘렸다) 메인에 그린다 — 버리지 않는다', () => {
    const { blocks } = projectTurn(turn(), [
      under('gone', use(5, 'c', 'Read')), under('gone', done(6, 'c')),
      text(7, '계속')
    ])
    expect(kinds(blocks)).toEqual(['activity', 'text'])
  })

  it('부모가 하위 에이전트가 아닌 도구면 메인에 그린다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'r', 'Read'), done(1, 'r'),
      under('r', use(2, 'c', 'Grep')), under('r', done(3, 'c'))
    ])
    expect(only(blocks, 'activity').items.map((i) => i.id)).toEqual(['r', 'c'])
  })

  it('부모를 따라가다 같은 id를 다시 만나면 멈추고 메인에 그린다 — 무한히 돌지 않는다', () => {
    const { blocks } = projectTurn(turn(), [
      under('b', use(0, 'a', 'Agent', { description: 'A' })),
      under('a', use(1, 'b', 'Agent', { description: 'B' })),
      under('a', use(2, 'c', 'Read')), under('a', done(3, 'c'))
    ])
    expect(kinds(blocks)).toEqual(['subagent', 'subagent', 'activity'])
    expect(blocks.flatMap((b) => (b.kind === 'subagent' ? b.blocks : []))).toEqual([])
  })

  it('실패한 에이전트 호출도 카드다 — 자식이 한 일이 카드 안에 있어야 한다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'g', 'Task', CALL),
      under('g', use(1, 'c', 'Bash', { command: 'pnpm test' })), under('g', fail(2, 'c')),
      fail(3, 'g', '에이전트 실패')
    ])
    expect(kinds(blocks)).toEqual(['subagent'])
    const card = only(blocks, 'subagent')
    expect(card.item.state).toBe('failed')
    expect(kinds(card.blocks)).toEqual(['tool-error'])
    expect(card).toMatchObject({ tools: 1, failed: 1 })
  })

  it('호출이 돌거나 자식 중 도는 것이 있으면 카드도 running이다', () => {
    const calling = projectTurn(turn({ status: 'running' }), [use(0, 'g', 'Agent', CALL)])
    expect(only(calling.blocks, 'subagent').running).toBe(true)

    const child = projectTurn(turn({ status: 'running' }), [
      use(0, 'g', 'Agent', CALL), done(1, 'g'), under('g', use(2, 'c', 'Read'))
    ])
    expect(only(child.blocks, 'subagent').running).toBe(true)

    const ended = projectTurn(turn(), [use(0, 'g', 'Agent', CALL), done(1, 'g')])
    expect(only(ended.blocks, 'subagent').running).toBe(false)
  })
})

describe('projectTurn — 접힌 턴의 값 (events FR-39)', () => {
  it('요약은 메인 스레드의 도구만 센다 — 카드는 하나로 센다', () => {
    const { summary } = projectTurn(turn(), [
      use(0, 'a', 'Read'), done(1, 'a'),
      use(2, 'g', 'Agent', { description: '조사' }),
      under('g', use(3, 'c1', 'Read')), under('g', done(4, 'c1')),
      under('g', use(5, 'c2', 'Bash')), under('g', fail(6, 'c2')),
      done(7, 'g')
    ])
    expect(summary).toEqual({ tools: 2, failed: 0, denied: 0, compacted: false })
  })

  it('거부는 고유 id로 세고(id 없는 공지는 하나씩), 실패는 거부가 아닌 것만 센다 — 둘이 겹치지 않는다', () => {
    const { summary } = projectTurn(turn(), [
      use(0, 'a', 'Bash'), notice(1, 'permission_denied', '권한 때문에 막힘: Bash', 'a'), fail(2, 'a'),
      use(3, 'b', 'Bash'), fail(4, 'b'),
      notice(5, 'permission_denied', '권한 때문에 막힘: Write'),
      // 끝의 result 줄이 같은 호출을 다시 알린다 — 로그에는 두 번 온다(events FR-19)
      notice(6, 'permission_denied', '권한 때문에 막힘: Bash', 'a')
    ])
    expect(summary).toEqual({ tools: 2, failed: 1, denied: 2, compacted: false })
  })

  it('압축이 있으면 도구가 없어도 요약이 있다', () => {
    expect(projectTurn(turn(), [notice(0, 'compact', '대화가 압축됨 · 자동 · 153,214 → 12,400 토큰')]).summary)
      .toEqual({ tools: 0, failed: 0, denied: 0, compacted: true })
    // 재시도·모델 대체만으로는 요약이 없다
    expect(projectTurn(turn(), [notice(0, 'retry', 'API 재시도 중'), notice(1, 'model_fallback', '모델 대체')]).summary)
      .toBeNull()
  })

  it('지금 도는 도구는 메인의 것이고, 그것이 하위 에이전트면 카드 안의 도는 도구를 함께 준다', () => {
    const { current, currentChild } = projectTurn(turn({ status: 'running' }), [
      use(0, 'g', 'Agent', { description: '조사' }),
      under('g', use(1, 'c1', 'Read', { file_path: '/repo/a.ts' })), under('g', done(2, 'c1')),
      under('g', use(3, 'c2', 'Grep', { pattern: 'expiresAt' }))
    ])
    expect(current).toMatchObject({ id: 'g', category: 'subagent' })
    expect(currentChild).toMatchObject({ id: 'c2', label: 'Grep', subtitle: 'expiresAt' })
  })

  it('메인이 하위 에이전트가 아니면 카드 안을 보지 않는다', () => {
    const { current, currentChild } = projectTurn(turn({ status: 'running' }), [
      use(0, 'g', 'Agent', {}), done(1, 'g'),
      under('g', use(2, 'c', 'Read')),
      use(3, 'b', 'Bash', { command: 'ls' })
    ])
    expect(current).toMatchObject({ id: 'b' })
    expect(currentChild).toBeNull()
  })

  it('retrying — 도는 중이고 턴의 마지막 이벤트가 재시도 공지면 그 문구다', () => {
    const retry = notice(2, 'retry', 'API 재시도 중 · 2/10번째 · 5초 뒤 · 529')
    const events = [use(0, 'a', 'Read'), done(1, 'a'), retry]
    expect(projectTurn(turn({ status: 'running' }), events).retrying)
      .toBe('API 재시도 중 · 2/10번째 · 5초 뒤 · 529')
    // 재시도가 끝나고 무언가 왔다
    expect(projectTurn(turn({ status: 'running' }), [...events, text(3, '계속')]).retrying).toBeNull()
    // 재시도 뒤에 하위 에이전트의 이벤트가 왔다 — 호출이 다시 흐른다(리뷰 반영 2026-09-27). 메인은 Agent의
    // 결과를 기다리는 중이라 이 재시도는 자식의 API 호출이다: 2.1.280은 메인이 아닌 경로의 재시도 대기도
    // 출처(하위 에이전트 id) 없는 재시도 줄로 알린다. 재시도 공지가 늘 메인 스코프에 서므로 "메인의 마지막"으로
    // 보면 자식이 도는 동안 상태 줄이 낡은 재시도 문구에 멈춘다.
    expect(projectTurn(turn({ status: 'running' }), [
      use(0, 'g', 'Agent', {}), retry, under('g', use(3, 'c', 'Read'))
    ]).retrying).toBeNull()
    // 자식 이벤트가 재시도보다 앞이면 아직 재시도 중이다
    expect(projectTurn(turn({ status: 'running' }), [
      use(0, 'g', 'Agent', {}), under('g', use(1, 'c', 'Read')), notice(2, 'retry', '재시도')
    ]).retrying).toBe('재시도')
    // 끝난 턴은 재시도 중이 아니다
    expect(projectTurn(turn(), events).retrying).toBeNull()
  })

  it('omitted — 첫 이벤트의 seq다. 창 때문에 앞이 잘렸으면 0보다 크다', () => {
    expect(projectTurn(turn(), [text(37, '뒷부분')]).omitted).toBe(37)
    expect(projectTurn(turn(), [text(0, '처음부터')]).omitted).toBe(0)
    expect(projectTurn(turn(), []).omitted).toBe(0)
  })
})

describe('projectTurn — 생각 블록 (events FR-40)', () => {
  it('opencode처럼 시각이 있으면 정확한 시간이다', () => {
    const { blocks } = projectTurn(turn(), [
      think(0, '먼저 구조를 본다', { startedAt: 1_000, endedAt: 3_400, truncated: 12 })
    ])
    expect(blocks).toEqual([{
      kind: 'reasoning', key: 'reasoning:0', text: '먼저 구조를 본다',
      durationMs: 2_400, estimated: false, truncated: 12
    }])
  })

  it('claude는 같은 스코프의 바로 앞 이벤트부터 잰다 — 추정이다', () => {
    const { blocks } = projectTurn(turn({ startedAt: 0 }), [
      timed(1_000, { type: 'session', runId: R, seq: 0, at: 0, sessionId: 's' }),
      timed(2_000, use(1, 'a', 'Read')), timed(5_000, done(2, 'a')),
      timed(9_000, think(3, '결과를 보니'))
    ])
    expect(only(blocks, 'reasoning')).toMatchObject({ durationMs: 4_000, estimated: true, truncated: 0 })
  })

  it('첫 이벤트면 턴의 시작부터 재고, 기준이 없거나 음수면 시간이 없다', () => {
    expect(only(projectTurn(turn({ startedAt: 1_000 }), [timed(3_500, think(0, ''))]).blocks, 'reasoning'))
      .toMatchObject({ durationMs: 2_500, estimated: true })
    expect(only(projectTurn(turn({ startedAt: null }), [timed(3_500, think(0, ''))]).blocks, 'reasoning'))
      .toMatchObject({ durationMs: null, estimated: true })
    expect(only(projectTurn(turn(), [timed(9_000, text(0, '앞')), timed(1_000, think(1, ''))]).blocks, 'reasoning'))
      .toMatchObject({ durationMs: null })
  })

  it('하위 에이전트 안의 첫 생각은 그 호출부터 잰다 — 턴의 시작부터 재면 앞선 메인의 시간이 섞인다', () => {
    const { blocks } = projectTurn(turn({ startedAt: 0 }), [
      timed(10_000, use(0, 'g', 'Agent', {})),
      timed(10_500, under('g', think(1, '')))
    ])
    expect(only(only(blocks, 'subagent').blocks, 'reasoning').durationMs).toBe(500)
  })

  it('본문이 빈 생각도 블록이다 — 펼칠 것 없는 한 줄로 보인다 (§7-A)', () => {
    const { blocks } = projectTurn(turn(), [think(0, '')])
    expect(only(blocks, 'reasoning')).toMatchObject({ text: '' })
  })

  it('text처럼 묶음을 끊고, 답 중복 제거는 text 블록만 본다', () => {
    const { blocks, answer } = projectTurn(turn({ resultText: '끝' }), [
      use(0, 'a', 'Read'), done(1, 'a'),
      think(2, '생각'),
      use(3, 'b', 'Read'), done(4, 'b'),
      text(5, '끝'), think(6, '마무리 생각')
    ])
    expect(kinds(blocks)).toEqual(['activity', 'reasoning', 'activity', 'reasoning'])
    expect(answer).toEqual({ text: '끝', final: true })
  })
})

describe('projectTurn — 공지 (events FR-41)', () => {
  it('권한 거부는 그 도구의 실패 줄 바로 뒤에 한 번만 선다 — system과 result가 둘 다 알려도', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Bash', { command: 'rm -rf x' }),
      notice(1, 'permission_denied', '권한 때문에 막힘: Bash', 'a'),
      fail(2, 'a', 'Permission denied'),
      use(3, 'b', 'Read'), done(4, 'b'),
      notice(5, 'permission_denied', '권한 때문에 막힘: Bash (두 번째)', 'a')
    ])
    expect(kinds(blocks)).toEqual(['tool-error', 'notice', 'activity'])
    expect(blocks[1]).toEqual({
      kind: 'notice', key: 'notice:1', noticeKind: 'permission_denied',
      text: '권한 때문에 막힘: Bash', lines: [], count: 1
    })
  })

  it('거부된 호출이 턴에 없으면 공지 자신의 자리에 id마다 한 번 선다', () => {
    const { blocks } = projectTurn(turn(), [
      text(0, '앞'),
      notice(1, 'permission_denied', '권한 때문에 막힘: Bash', 'gone'),
      notice(2, 'permission_denied', '권한 때문에 막힘: Bash', 'gone'),
      text(3, '뒤')
    ])
    expect(kinds(blocks)).toEqual(['text', 'notice', 'text'])
  })

  it('하위 에이전트 안에서 막힌 도구의 공지는 카드 안, 그 줄 바로 뒤다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'g', 'Agent', {}),
      under('g', use(1, 'c', 'Write', { file_path: '/repo/a.ts', content: 'x' })),
      under('g', fail(2, 'c')),
      done(3, 'g'),
      notice(4, 'permission_denied', '권한 때문에 막힘: Write', 'c')
    ])
    expect(kinds(blocks)).toEqual(['subagent'])
    expect(kinds(only(blocks, 'subagent').blocks)).toEqual(['tool-error', 'notice'])
  })

  it('연속된 재시도는 하나로 합친다 — 마지막 문구와 합친 수', () => {
    const { blocks } = projectTurn(turn(), [
      notice(0, 'retry', 'API 재시도 중 · 1/10번째'),
      { type: 'usage', runId: R, seq: 1, at: 0, usage: {
        model: null, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
        reasoningTokens: null, costUsd: null, contextTokens: null, contextWindow: null
      } },
      notice(2, 'retry', 'API 재시도 중 · 2/10번째'),
      notice(3, 'retry', 'API 재시도 중 · 3/10번째')
    ])
    expect(blocks).toEqual([{
      kind: 'notice', key: 'notice:0', noticeKind: 'retry', text: 'API 재시도 중 · 3/10번째', lines: [], count: 3
    }])
  })

  it('사이에 블록이 있으면 재시도를 합치지 않는다', () => {
    const { blocks } = projectTurn(turn(), [
      notice(0, 'retry', '1번째'), text(1, '중간'), notice(2, 'retry', '2번째')
    ])
    expect(kinds(blocks)).toEqual(['notice', 'text', 'notice'])
  })

  it('압축·모델 대체·모르는 종류는 제자리에 따로 서고, 묶음을 끊는다', () => {
    const { blocks } = projectTurn(turn(), [
      use(0, 'a', 'Read'), done(1, 'a'),
      notice(2, 'compact', '대화가 압축됨'),
      use(3, 'b', 'Read'), done(4, 'b'),
      notice(5, 'model_fallback', '모델 대체'),
      { ...notice(6, 'compact', '앞으로 생길 공지'), kind: 'rate_limit' } as unknown as RunEvent,
      notice(7, 'compact', '   ')
    ])
    expect(blocks.map((b) => (b.kind === 'notice' ? `${b.noticeKind}:${b.text}` : b.kind))).toEqual([
      'activity', 'compact:대화가 압축됨', 'activity', 'model_fallback:모델 대체', 'other:앞으로 생길 공지'
    ])
  })

  it('원문 줄은 새 공지에 붙지 않는다 — 해석하지 못한 출력끼리만 합친다', () => {
    const { blocks } = projectTurn(turn(), [notice(0, 'compact', '압축'), raw(1, '{깨짐')])
    expect(blocks.map((b) => (b.kind === 'notice' ? b.noticeKind : b.kind))).toEqual(['compact', 'raw'])
  })
})

describe('switchNotice (FR-10)', () => {
  const claude = { agentKind: 'claude-code' as const, model: 'sonnet', effort: null }

  it('첫 턴에는 공지가 없다', () => {
    expect(switchNotice(null, claude)).toBeNull()
  })

  it('요청한 모델·effort가 같으면 공지가 없다', () => {
    expect(switchNotice(claude, { ...claude })).toBeNull()
  })

  it('모델이 바뀌면 새 모델을 알린다 — 비우면 기본값이다', () => {
    expect(switchNotice(claude, { ...claude, model: 'opus' })).toBe('모델 → opus')
    expect(switchNotice(claude, { ...claude, model: null })).toBe('모델 → 기본값')
  })

  it('effort는 agent의 이름으로 부른다', () => {
    expect(switchNotice(claude, { ...claude, effort: 'high' })).toBe('effort → high')
    const opencode = { agentKind: 'opencode' as const, model: null, effort: 'max' }
    expect(switchNotice(opencode, { ...opencode, effort: null })).toBe('variant → 기본값')
  })

  it('둘 다 바뀌면 한 줄에 잇는다', () => {
    expect(switchNotice(claude, { ...claude, model: 'opus', effort: 'high' }))
      .toBe('모델 → opus · effort → high')
  })
})

describe('formatDuration (FR-11)', () => {
  it('1초 미만', () => {
    expect(formatDuration(0)).toBe('1초 미만')
    expect(formatDuration(999)).toBe('1초 미만')
  })

  it('60초 미만은 초만', () => {
    expect(formatDuration(1_000)).toBe('1초')
    expect(formatDuration(59_900)).toBe('59초')
  })

  it('1시간 미만은 분과 초', () => {
    expect(formatDuration(60_000)).toBe('1분 0초')
    expect(formatDuration(61_000)).toBe('1분 1초')
    expect(formatDuration(3_599_999)).toBe('59분 59초')
  })

  it('그 위는 시간과 분', () => {
    expect(formatDuration(3_600_000)).toBe('1시간 0분')
    expect(formatDuration(3_660_000)).toBe('1시간 1분')
  })
})

describe('metaPieces (FR-11)', () => {
  function makeRun(over: Partial<Run> = {}): Run {
    return {
      id: 'r1', workspaceId: 'ws', agentKind: 'claude-code', model: null, effort: null,
      cwd: '/repo', permission: 'edit', userPrompt: '지시', assembledPrompt: '지시',
      status: 'succeeded', externalSessionId: null, parentRunId: null, rootRunId: 'r1',
      title: null, closedAt: null, resultText: null, needsAnswer: false, timeoutMs: null,
      exitCode: null, errorMessage: null, logPath: '/tmp/x.log', reviewedAt: null,
      reviewedKind: null, startedAt: null, endedAt: null, createdAt: 0, contextItems: [],
      usage: null, ...over
    }
  }

  it('agent · 모델 · 소요 시간 · effort · 권한 순서다', () => {
    expect(metaPieces(makeRun({
      model: 'sonnet', effort: 'high', startedAt: 1_000, endedAt: 23_000
    }))).toEqual(['Claude Code', 'sonnet', '22초', 'effort high', '편집 허용'])
  })

  it('관측한 모델이 요청한 모델을 이긴다', () => {
    const usage = {
      model: 'claude-opus-5[1m]', inputTokens: null, outputTokens: null, cacheReadTokens: null,
      cacheWriteTokens: null, reasoningTokens: null, costUsd: null,
      contextTokens: null, contextWindow: null
    }
    expect(metaPieces(makeRun({ model: 'opus', usage }))).toContain('claude-opus-5[1m]')
    expect(metaPieces(makeRun({ model: 'opus', usage }))).not.toContain('opus')
  })

  it('모르는 조각은 빠진다 — 모델·시작 전의 시간·effort', () => {
    expect(metaPieces(makeRun({ agentKind: 'opencode', permission: 'read_only' })))
      .toEqual(['OpenCode', '읽기 전용'])
  })

  it('도는 턴에는 시간이 없다 — 상태 줄이 경과 시간을 말한다 (spec §8의 3)', () => {
    // 상태 줄 "작업 중 · 12초"와 끝줄 "… · 12초 · …"가 한 턴에 시간을 두 번 보였다(결정 2026-09-27).
    // 끝나면 끝줄이 걸린 시간을 말한다 — 그때는 상태 줄이 없다.
    expect(metaPieces(makeRun({ status: 'running', model: 'sonnet', startedAt: 0 })))
      .toEqual(['Claude Code', 'sonnet', '편집 허용'])
  })

  it('대기한 시간은 넣지 않는다 — 시작부터 잰다', () => {
    expect(metaPieces(makeRun({ createdAt: 0, startedAt: 50_000, endedAt: 55_000 })))
      .toContain('5초')
  })

  it('opencode의 effort는 variant다', () => {
    expect(metaPieces(makeRun({ agentKind: 'opencode', effort: 'max' }))).toContain('variant max')
  })

  it('중단된 턴에는 시간이 없다 — 끝난 시각은 앱이 다시 켜진 시각이다 (FR-11 다듬음)', () => {
    // interrupted는 도는 중에 앱이 꺼진 턴이고, endedAt은 다음 부팅의 reapStale이 찍는다. 20초 돌다
    // 꺼져 다음 날 켜면 "14시간 3분"이 agent가 쓴 시간처럼 보인다(리뷰가 찾은 것) — 대기 시간을 빼는
    // 것과 같은 이유다.
    const run = makeRun({ status: 'interrupted', startedAt: 0, endedAt: 50_580_000 })
    expect(metaPieces(run)).toEqual(['Claude Code', '편집 허용'])
  })
})

describe('toolDetailOf — 도구 한 줄을 펼쳤을 때 (FR-16)', () => {
  function item(
    name: string, input: unknown, output: string | null = null,
    outputSource: ToolItem['outputSource'] = output === null ? null : 'summary'
  ): ToolItem {
    const { label, category } = toolLabelOf(name)
    return {
      id: 'a', name, label, category, subtitle: toolSubtitleOf(input, '/repo'), subtitlePath: false,
      input, state: output === null ? 'running' : 'done', output, outputSource, outputTruncated: 0,
      exitCode: null, stopped: null, matches: null, matchUnit: null, matchesTruncated: false,
      denied: false, parentToolUseId: null, subagent: null
    }
  }

  it('셸은 명령 전문과 결과 요약이다 — 부제는 첫 줄뿐이지만 펼치면 전부다', () => {
    expect(toolDetailOf(item('Bash', { command: 'pnpm test\n  --run' }, 'ok'))).toEqual({
      kind: 'shell', command: 'pnpm test\n  --run', output: 'ok', truncated: false
    })
  })

  it('요약이 …로 끝나면 잘린 것이다 — 잘린 출력을 전부인 것처럼 보이면 안 된다', () => {
    const detail = toolDetailOf(item('Bash', { command: 'pnpm test' }, `${'x'.repeat(200)}…`))
    expect(detail).toMatchObject({ kind: 'shell', truncated: true })
  })

  it('원문 출력이 …로 끝나는 것은 잘린 표시가 아니다 — 200자 요약만 그 표식을 단다', () => {
    // conversation-events FR-36: output이 원문 끝부분이면 요약의 `…` 규칙을 쓰지 않는다
    const detail = toolDetailOf(item('Bash', { command: 'pnpm test' }, '기다리는 중…', 'full'))
    expect(detail).toMatchObject({ kind: 'shell', output: '기다리는 중…', truncated: false })
  })

  it('결과가 아직 없으면 명령만이다', () => {
    expect(toolDetailOf(item('Bash', { command: 'ls' }))).toEqual({
      kind: 'shell', command: 'ls', output: null, truncated: false
    })
  })

  it('명령이 없는 셸 도구(BashOutput)는 결과만, 둘 다 없으면 펼칠 것이 없다', () => {
    expect(toolDetailOf(item('BashOutput', { bash_id: 'b1' }, '출력'))).toEqual({
      kind: 'shell', command: '', output: '출력', truncated: false
    })
    expect(toolDetailOf(item('KillShell', { shell_id: 'b1' }))).toBeNull()
  })

  it('하위 에이전트는 종류와 지시다 — 문자열이 아니면 쓰지 않는다', () => {
    expect(toolDetailOf(item('Task', {
      description: '코드 조사', prompt: '인증 흐름을 조사해', subagent_type: 'Explore'
    }))).toEqual({ kind: 'subagent', agentType: 'Explore', prompt: '인증 흐름을 조사해' })
    expect(toolDetailOf(item('Task', { prompt: { nested: 1 }, subagent_type: 3 }))).toEqual({
      kind: 'subagent', agentType: null, prompt: null
    })
  })

  it('mcp·그 밖은 입력을 들여쓴 JSON으로 보인다', () => {
    expect(toolDetailOf(item('mcp__onedesk__list_issues', { state: 'open' }))).toEqual({
      kind: 'input', json: '{\n  "state": "open"\n}'
    })
    expect(toolDetailOf(item('SomethingNew', [1, 2]))).toEqual({
      kind: 'input', json: '[\n  1,\n  2\n]'
    })
  })

  it('입력 JSON은 2,000자까지다', () => {
    const detail = toolDetailOf(item('mcp__x__y', { body: 'a'.repeat(5_000) }))
    expect(detail?.kind).toBe('input')
    const json = detail?.kind === 'input' ? detail.json : ''
    expect(json).toHaveLength(MAX_INPUT_JSON + 1)
    expect(json.endsWith('…')).toBe(true)
  })

  it('입력이 없으면 펼칠 것이 없다', () => {
    expect(toolDetailOf(item('mcp__x__y', undefined))).toBeNull()
  })

  it.each(['Read', 'Grep', 'Glob', 'WebFetch', 'TodoWrite', 'Edit'])(
    '%s는 펼칠 것이 없다 — 한 줄로 끝난다',
    (name) => {
      expect(toolDetailOf(item(name, { file_path: '/repo/a.ts', pattern: 'x', url: 'https://e.x' }, 'ok'))).toBeNull()
    }
  )
})
