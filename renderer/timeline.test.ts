import { describe, it, expect } from 'vitest'
import {
  TOOL_LABELS, toolLabelOf, toolSubtitleOf, projectTurn, switchNotice,
  formatDuration, metaPieces, toolDetailOf, MAX_INPUT_JSON, type TimelineBlock, type ToolItem
} from './timeline'
import type { RunEvent, RunUsage } from '@shared/events'
import type { Run } from '@shared/models'

const R = 'r1'

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
  return { status: 'succeeded', resultText: null, errorMessage: null, cwd: '/repo', ...over }
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
      ['skill', '스킬', 'other']
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
      kind: 'notice', key: 'notice:0', text: '해석하지 못한 출력 2줄', lines: ['{깨짐', '또 깨짐']
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
    expect(summary).toEqual({ tools: 3, failed: 1 })
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
  function item(name: string, input: unknown, output: string | null = null): ToolItem {
    const { label, category } = toolLabelOf(name)
    return {
      id: 'a', name, label, category, subtitle: toolSubtitleOf(input, '/repo'), subtitlePath: false,
      input, state: output === null ? 'running' : 'done', output, matches: null
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
