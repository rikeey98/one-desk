import { describe, it, expect } from 'vitest'
import { opencodeDeniedNotice, opencodeToolDetail, parseUnifiedDiff } from './opencode.detail'

/**
 * opencode의 `state.metadata`·오류 문구를 detail·공지로 접는 순수 함수들
 * (`docs/sdlc/conversation-events/` spec FR-24·26).
 *
 * **모양의 출처** — 모델을 부르는 실행을 하지 않았으므로 스트림을 새로 뜨지 않았다(spec §7 우려 3):
 * - 바이너리: opencode 1.18.30(`opencode.exe`)의 도구 구현 문자열 — edit의 `diff`·`filediff`
 *   (`createTwoFilesPatch`), grep의 `matches`, glob의 `count`, bash의 `exit`, 권한 거부 두 문구
 * - 소스: `session/processor.ts`(completed·error의 `state` 모양, 중단된 도구의 `interrupted`)·
 *   `tool/task.ts`:184(task의 `sessionId`·`model`)
 * - 픽스처: `opencode-stream.jsonl`의 write `metadata`(`filepath`·`exists`)
 * - apply_patch의 `files[]`도 1.18.30 바이너리의 도구 구현이다 — 파일별 diff는 **`patch`** 키이고
 *   (`patch:d.diff`), 이름을 옮기면 `type: 'move'`와 `movePath`가 붙는다(리뷰 반영 2026-09-27 — spec
 *   §2-3이 UI 데모 값에서 추정한 `diff` 키는 1.18.30에 없다)
 */

describe('parseUnifiedDiff', () => {
  /** `createTwoFilesPatch`의 출력 모양 — 머리 네 줄 뒤에 hunk가 온다 */
  const PATCH = [
    'Index: /repo/src/auth.ts',
    '===================================================================',
    '--- /repo/src/auth.ts',
    '+++ /repo/src/auth.ts',
    '@@ -41,3 +41,3 @@',
    ' export function isExpired(token) {',
    '-  return now > token.expiresAt',
    '+  return now >= token.expiresAt',
    ' }',
    '@@ -88,2 +88,3 @@ export function refresh() {',
    ' export function refresh() {',
    '-  return fetchToken()',
    '\\ No newline at end of file',
    '+  return fetchToken()',
    '+}',
    '\\ No newline at end of file',
    ''
  ].join('\n')

  it('hunk마다 머리의 수와 줄을 옮기고, 머리 줄과 No newline 줄은 건너뛴다', () => {
    expect(parseUnifiedDiff(PATCH)).toEqual([
      {
        oldStart: 41, oldLines: 3, newStart: 41, newLines: 3,
        lines: [
          ' export function isExpired(token) {',
          '-  return now > token.expiresAt',
          '+  return now >= token.expiresAt',
          ' }'
        ]
      },
      {
        oldStart: 88, oldLines: 2, newStart: 88, newLines: 3,
        lines: [' export function refresh() {', '-  return fetchToken()', '+  return fetchToken()', '+}']
      }
    ])
  })

  it('개수를 생략한 머리는 1줄이다', () => {
    expect(parseUnifiedDiff('@@ -1 +1 @@\n-a\n+b\n')).toEqual([
      { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }
    ])
  })

  it('새 파일의 hunk는 옛 쪽이 0줄이다', () => {
    expect(parseUnifiedDiff('--- /dev/null\n+++ b.ts\n@@ -0,0 +1,2 @@\n+a\n+b')).toEqual([
      { oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+a', '+b'] }
    ])
  })

  it('hunk 안에서 ---·+++로 시작하는 줄은 머리가 아니라 본문이다 — 줄 수로 hunk의 끝을 안다', () => {
    // "-- 주석"을 지운 줄은 "--- 주석"이 된다. 머리 줄로 보고 건너뛰면 본문이 사라진다
    expect(parseUnifiedDiff('@@ -1,2 +1,2 @@\n--- 주석\n+++ 새 주석\n x\n')).toEqual([
      { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: ['--- 주석', '+++ 새 주석', ' x'] }
    ])
  })

  it('CRLF로 온 patch도 읽는다', () => {
    expect(parseUnifiedDiff('@@ -1 +1 @@\r\n-a\r\n+b\r\n')).toEqual([
      { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }
    ])
  })

  it('hunk 안의 빈 줄은 빈 문맥 줄이다', () => {
    // 끝 공백을 걷는 도구를 거치면 문맥 줄 " "이 ""가 된다
    expect(parseUnifiedDiff('@@ -1,3 +1,3 @@\n a\n\n-b\n+c')).toEqual([
      { oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [' a', ' ', '-b', '+c'] }
    ])
  })

  it('모양이 깨지면 빈 배열이다', () => {
    expect(parseUnifiedDiff('diff가 아니다')).toEqual([])
    expect(parseUnifiedDiff('@@ -a,b +c,d @@\n-a\n+b')).toEqual([])
    // 머리가 말한 줄 수보다 먼저 끝났다
    expect(parseUnifiedDiff('@@ -1,3 +1,3 @@\n a\n-b')).toEqual([])
    // hunk 안에 부호가 없는 줄
    expect(parseUnifiedDiff('@@ -1,2 +1,2 @@\n a\n?b\n c')).toEqual([])
    expect(parseUnifiedDiff(undefined)).toEqual([])
    expect(parseUnifiedDiff(7)).toEqual([])
    expect(parseUnifiedDiff('')).toEqual([])
  })
})

/** completed 상태의 도구. 모양은 소스 processor:160-183이다 */
function done(metadata: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { status: 'completed', input: {}, output: '', metadata, title: '', time: { start: 1000, end: 1500 }, ...extra }
}

describe('opencodeToolDetail — completed (FR-24 표의 행마다)', () => {
  it('bash — 종료 코드는 metadata.exit다', () => {
    expect(opencodeToolDetail('bash', done({ output: 'x', exit: 1, truncated: false })))
      .toEqual({ kind: 'shell', exitCode: 1, interrupted: false, timedOut: false })
    expect(opencodeToolDetail('bash', done({ output: 'x', exit: 0 })))
      .toEqual({ kind: 'shell', exitCode: 0, interrupted: false, timedOut: false })
  })

  it('shell도 셸이다', () => {
    expect(opencodeToolDetail('shell', done({ exit: 2 }))).toMatchObject({ kind: 'shell', exitCode: 2 })
  })

  it('bash — exit가 수가 아니면 코드를 모른다(null)', () => {
    expect(opencodeToolDetail('bash', done({ exit: null }))).toMatchObject({ exitCode: null })
    expect(opencodeToolDetail('bash', done({ exit: '1' }))).toMatchObject({ exitCode: null })
  })

  it('bash — interrupted가 참이면 중단이고, 시간 초과는 모른다(spec §7 우려 14)', () => {
    expect(opencodeToolDetail('bash', done({ exit: 130, interrupted: true })))
      .toEqual({ kind: 'shell', exitCode: 130, interrupted: true, timedOut: false })
  })

  it('grep — 일치한 줄 수이고 잘렸는지를 옮긴다', () => {
    expect(opencodeToolDetail('grep', done({ matches: 12, truncated: false })))
      .toEqual({ kind: 'search', count: 12, unit: 'matches', truncated: false })
    expect(opencodeToolDetail('grep', done({ matches: 100, truncated: true })))
      .toEqual({ kind: 'search', count: 100, unit: 'matches', truncated: true })
  })

  it('glob — 파일 수다', () => {
    expect(opencodeToolDetail('glob', done({ count: 3, truncated: false })))
      .toEqual({ kind: 'search', count: 3, unit: 'files', truncated: false })
  })

  it('검색의 수가 수가 아니면 detail이 없다 — 반쯤 맞는 detail은 거짓말을 한다', () => {
    expect(opencodeToolDetail('grep', done({ matches: '12' }))).toBeUndefined()
    expect(opencodeToolDetail('glob', done({}))).toBeUndefined()
  })

  it('개수는 음이 아닌 정수다 — 렌더러와 같은 판정이라 로그에 실린 detail이 화면에서 사라지지 않는다', () => {
    // 리뷰 반영 2026-09-27: 어댑터가 유한한 수를 다 받으면 렌더러(readDetail)가 detail을 통째로 버린다
    expect(opencodeToolDetail('grep', done({ matches: 2.5 }))).toBeUndefined()
    expect(opencodeToolDetail('glob', done({ count: -1 }))).toBeUndefined()
    expect(opencodeToolDetail('edit', done(
      { filediff: { file: '/a', patch: '@@ -1 +1 @@\n-a\n+b', additions: 1.5, deletions: 0 } }
    ))).toBeUndefined()
    expect(opencodeToolDetail('apply_patch', done(
      { files: [{ type: 'update', filePath: '/a', patch: '@@ -1 +1 @@\n-a\n+b', additions: -1 }] }
    ))).toBeUndefined()
  })

  it('edit — filediff의 patch를 hunk로 펴고 추가·삭제는 CLI가 센 값이다', () => {
    const patch = '--- a\n+++ a\n@@ -41,1 +41,1 @@\n-a\n+b\n'
    expect(opencodeToolDetail('edit', done(
      { diagnostics: {}, diff: patch, filediff: { file: '/repo/src/auth.ts', patch, additions: 5, deletions: 4 } },
      { input: { filePath: '/elsewhere.ts', oldString: 'a', newString: 'b' } }
    ))).toEqual({
      kind: 'edit',
      files: [{
        path: '/repo/src/auth.ts', operation: 'edit',
        hunks: [{ oldStart: 41, oldLines: 1, newStart: 41, newLines: 1, lines: ['-a', '+b'] }],
        hunksTruncated: 0, added: 5, removed: 4,
        before: null, beforeMissing: 'unavailable'
      }]
    })
  })

  it('edit — filediff가 없으면 metadata.diff와 input.filePath로 채우고, 추가·삭제는 hunk에서 센다', () => {
    expect(opencodeToolDetail('edit', done(
      { diff: '@@ -1 +1,2 @@\n-a\n+b\n+c' },
      { input: { filePath: '/repo/a.ts' } }
    ))).toMatchObject({
      kind: 'edit',
      files: [{ path: '/repo/a.ts', operation: 'edit', added: 2, removed: 1, beforeMissing: 'unavailable' }]
    })
  })

  it('edit — 깨진 patch는 빈 hunk다', () => {
    expect(opencodeToolDetail('edit', done(
      { filediff: { file: '/repo/a.ts', patch: '깨짐', additions: 1, deletions: 1 } }
    ))).toMatchObject({ files: [{ path: '/repo/a.ts', hunks: [], added: 1, removed: 1 }] })
  })

  it('edit — 경로를 모르면 detail이 없다', () => {
    expect(opencodeToolDetail('edit', done({ filediff: { patch: '@@ -1 +1 @@\n-a\n+b' } }))).toBeUndefined()
  })

  it('write — exists가 false면 새 파일이고, 아니면 덮어쓰기다(이전 내용은 없다)', () => {
    expect(opencodeToolDetail('write', done({ diagnostics: {}, filepath: '/repo/new.md', exists: false, truncated: false })))
      .toEqual({
        kind: 'edit',
        files: [{
          path: '/repo/new.md', operation: 'create', hunks: [], hunksTruncated: 0,
          added: null, removed: null, before: null, beforeMissing: null
        }]
      })
    expect(opencodeToolDetail('write', done({ filepath: '/repo/README.md', exists: true })))
      .toMatchObject({ files: [{ operation: 'overwrite', before: null, beforeMissing: 'unavailable' }] })
  })

  it('write — filepath가 없으면 input.filePath다', () => {
    expect(opencodeToolDetail('write', done({ exists: true }, { input: { filePath: '/repo/x.md', content: 'x' } })))
      .toMatchObject({ files: [{ path: '/repo/x.md' }] })
  })

  it('apply_patch·patch — files[]마다 파일 하나, type으로 종류를 가른다', () => {
    // 1.18.30의 모양 그대로다 — 파일별 diff는 `patch` 키다(`patch:d.diff`)
    const files = [
      { type: 'add', filePath: '/repo/src/new.ts', relativePath: 'src/new.ts', patch: '@@ -0,0 +1,2 @@\n+a\n+b', additions: 2, deletions: 0 },
      { type: 'update', filePath: '/repo/src/auth.ts', relativePath: 'src/auth.ts', patch: '@@ -3 +3 @@\n-x\n+y' },
      { type: 'delete', filePath: '/repo/src/old.ts', relativePath: 'src/old.ts', patch: '@@ -1 +0,0 @@\n-z' }
    ]
    const detail = opencodeToolDetail('apply_patch', done({ diff: '', files }))
    expect(detail).toMatchObject({
      kind: 'edit',
      files: [
        { path: '/repo/src/new.ts', operation: 'create', added: 2, removed: 0, beforeMissing: null },
        { path: '/repo/src/auth.ts', operation: 'edit', added: 1, removed: 1, beforeMissing: 'unavailable' },
        { path: '/repo/src/old.ts', operation: 'delete', added: 0, removed: 1, beforeMissing: 'unavailable' }
      ]
    })
    expect(detail && detail.kind === 'edit' ? detail.files[1]!.hunks : null)
      .toEqual([{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ['-x', '+y'] }])
    expect(opencodeToolDetail('patch', done({ files }))).toMatchObject({ kind: 'edit' })
  })

  it('apply_patch — 1.18.30의 files[].patch를 hunk로 편다 (리뷰 반영: diff 키로 읽으면 hunk가 늘 비었다)', () => {
    const detail = opencodeToolDetail('apply_patch', done({
      diff: '', files: [{ type: 'update', filePath: '/a', relativePath: 'a', patch: '@@ -1 +1 @@\n-a\n+b\n', additions: 1, deletions: 1 }]
    }))
    expect(detail && detail.kind === 'edit' ? detail.files[0]!.hunks : null)
      .toEqual([{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }])
  })

  it('apply_patch — 옮긴 파일(move)은 새 자리(movePath)의 편집이다', () => {
    // 1.18.30은 relativePath도 `movePath ?? filePath`로 만든다 — 파일이 지금 있는 곳이다
    const detail = opencodeToolDetail('apply_patch', done({
      files: [{
        type: 'move', filePath: '/repo/old.ts', movePath: '/repo/new.ts', relativePath: 'new.ts',
        patch: '@@ -1 +1 @@\n-a\n+b', additions: 1, deletions: 1
      }]
    }))
    expect(detail).toMatchObject({ kind: 'edit', files: [{ path: '/repo/new.ts', operation: 'edit' }] })
  })

  it('apply_patch — files가 배열이 아니거나 비었거나, 항목에 diff 글이 없으면 detail이 없다', () => {
    expect(opencodeToolDetail('apply_patch', done({ diff: '@@ -1 +1 @@\n-a\n+b' }))).toBeUndefined()
    expect(opencodeToolDetail('apply_patch', done({ files: [] }))).toBeUndefined()
    expect(opencodeToolDetail('apply_patch', done({ files: [{ type: 'add' }] }))).toBeUndefined()
    // 경로·수는 있는데 diff 글이 없다 — 줄 없는 "+1 −1"은 반쯤 맞는 detail이다
    expect(opencodeToolDetail('apply_patch', done({
      files: [{ type: 'update', filePath: '/a', additions: 1, deletions: 1 }]
    }))).toBeUndefined()
  })

  it('apply_patch — 옛 모양(files[].diff)도 읽는다', () => {
    const detail = opencodeToolDetail('apply_patch', done({
      files: [{ type: 'update', filePath: '/a', diff: '@@ -2 +2 @@\n-x\n+y' }]
    }))
    expect(detail && detail.kind === 'edit' ? detail.files[0]!.hunks[0]!.oldStart : null).toBe(2)
  })

  it('task — 하위 세션 id·모델·걸린 시간', () => {
    expect(opencodeToolDetail('task', done(
      { parentSessionId: 'ses_parent', sessionId: 'ses_child', model: { modelID: 'claude-sonnet-5', providerID: 'anthropic' } },
      { time: { start: 1000, end: 35000 } }
    ))).toEqual({ kind: 'subagent', sessionId: 'ses_child', model: 'claude-sonnet-5', toolCount: null, durationMs: 34000 })
  })

  it('task — 모르는 값은 null이고, 타입이 어긋나면 detail이 없다', () => {
    expect(opencodeToolDetail('task', done({}, { time: {} })))
      .toEqual({ kind: 'subagent', sessionId: null, model: null, toolCount: null, durationMs: null })
    expect(opencodeToolDetail('task', done({ sessionId: 7 }))).toBeUndefined()
  })

  it('그 밖의 도구(read·webfetch·mcp)는 detail이 없다', () => {
    expect(opencodeToolDetail('read', done({ preview: 'x', truncated: false }))).toBeUndefined()
    expect(opencodeToolDetail('webfetch', done({}))).toBeUndefined()
    expect(opencodeToolDetail('onedesk_list_issues', done({}))).toBeUndefined()
  })

  it('metadata가 없으면 detail이 없다 — 새 파일인지 덮어쓰기인지조차 모른다', () => {
    expect(opencodeToolDetail('write', done(undefined, { input: { filePath: '/repo/x.md' } }))).toBeUndefined()
    expect(opencodeToolDetail('bash', done(undefined))).toBeUndefined()
  })
})

describe('opencodeToolDetail — error', () => {
  const failed = (metadata: unknown): Record<string, unknown> =>
    ({ status: 'error', input: {}, error: '실패', metadata, time: { start: 1, end: 2 } })

  it('exit가 수인 bash만 셸 detail을 싣는다', () => {
    expect(opencodeToolDetail('bash', failed({ exit: 2 })))
      .toEqual({ kind: 'shell', exitCode: 2, interrupted: false, timedOut: false })
    expect(opencodeToolDetail('bash', failed({ output: '...' }))).toBeUndefined()
    expect(opencodeToolDetail('bash', failed(undefined))).toBeUndefined()
  })

  it('중단된 bash는 코드를 모르는 채로 중단이다', () => {
    // 소스 processor:599 — status error, error "Tool execution aborted", metadata.interrupted
    expect(opencodeToolDetail('bash', failed({ output: '진행 중...', interrupted: true })))
      .toEqual({ kind: 'shell', exitCode: null, interrupted: true, timedOut: false })
  })

  it('실패한 다른 도구는 detail이 없다', () => {
    expect(opencodeToolDetail('grep', failed({ matches: 3 }))).toBeUndefined()
    expect(opencodeToolDetail('edit', failed({ filediff: { file: '/a', patch: '@@ -1 +1 @@\n-a\n+b' } }))).toBeUndefined()
    expect(opencodeToolDetail('task', failed({ sessionId: 'ses_child' }))).toBeUndefined()
  })
})

describe('opencodeDeniedNotice (FR-26)', () => {
  it('묻는 권한의 자동 거부 — 헤드리스라서 거부됐다고 알린다', () => {
    expect(opencodeDeniedNotice('bash', 'The user rejected permission to use this specific tool call.', 'call-1'))
      .toEqual({
        kind: 'permission_denied',
        text: '권한 때문에 막힘: bash (묻는 권한은 헤드리스에서 자동으로 거부됩니다)',
        toolUseId: 'call-1'
      })
  })

  it('deny 규칙의 거부', () => {
    expect(opencodeDeniedNotice(
      'edit',
      'The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules [{"permission":"edit","pattern":"*","action":"deny"}]',
      'call-2'
    )).toEqual({ kind: 'permission_denied', text: '권한 때문에 막힘: edit', toolUseId: 'call-2' })
  })

  it('다른 오류 문구는 공지가 아니다', () => {
    expect(opencodeDeniedNotice('read', 'File not found: /repo/missing.ts', 'call-3')).toBeNull()
    expect(opencodeDeniedNotice('bash', 'Tool execution aborted', 'call-4')).toBeNull()
    // 문장 가운데 섞인 것은 거부가 아니다 — 시작으로만 가른다
    expect(opencodeDeniedNotice('bash', 'echo "The user rejected permission to use this specific tool call"', 'c')).toBeNull()
    expect(opencodeDeniedNotice('bash', undefined, 'c')).toBeNull()
  })

  it('호출 id가 비었으면 키를 싣지 않고, 도구 이름이 없으면 공지를 만들지 않는다', () => {
    const notice = opencodeDeniedNotice('bash', 'The user rejected permission to use this specific tool call.', '')
    expect(notice && 'toolUseId' in notice).toBe(false)
    expect(opencodeDeniedNotice('', 'The user rejected permission to use this specific tool call.', 'c')).toBeNull()
  })
})
