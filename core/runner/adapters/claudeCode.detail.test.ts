import { describe, it, expect } from 'vitest'
import {
  claudeDenialNotices,
  claudeNotice,
  claudeResultText,
  claudeToolDetail,
  isClaudeReadResult
} from './claudeCode.detail'
import { BEFORE_MAX_CHARS } from './common'

/**
 * claude의 `tool_use_result`·system 줄을 one-desk의 detail·공지로 접는 순수 함수
 * (`docs/sdlc/conversation-events/` spec FR-13·14·18·19).
 *
 * **모양의 출처** — 모델을 부르는 실행을 하지 않았으므로 스트림을 새로 뜨지 않았다(spec §7 우려 3).
 * - 스키마: claude 2.1.280 바이너리의 SDK 메시지 zod 스키마 문자열 (Edit·Write·Bash·Grep·Glob·Agent·
 *   system 하위 타입 전부)
 * - 기록: `~/.claude/projects/<repo>/*.jsonl`의 `toolUseResult` 키 모양 (Edit 129·Write 73·Bash 1,637·
 *   실패 문자열 67·Grep content 2·비동기 Agent 2건). 스트림이 아니라 디스크 기록이라 크기는 다를 수 있다
 * - Glob은 스키마에만 있고 기록에서 확인하지 못했다(spec §2-1 "미확인")
 * 실제 `raw.jsonl`이 생기면 그 줄로 바꾼다(plan 완료 증명의 후속 항목).
 */

describe('claudeToolDetail — 모양으로 가른다 (FR-14)', () => {
  const editResult = {
    filePath: '/repo/src/auth.ts',
    oldString: 'return false',
    newString: 'return true',
    originalFile: 'function a() {\n  return false\n}\n',
    structuredPatch: [{
      oldStart: 41, oldLines: 3, newStart: 41, newLines: 3,
      lines: ['   if (!user) {', '-    return false', '+    return true', '   }']
    }],
    userModified: false,
    replaceAll: false
  }

  it('Edit — structuredPatch + oldString', () => {
    expect(claudeToolDetail(editResult, 'updated', false)).toEqual({
      kind: 'edit',
      files: [{
        path: '/repo/src/auth.ts',
        operation: 'edit',
        hunks: editResult.structuredPatch,
        hunksTruncated: 0,
        added: 1,
        removed: 1,
        before: 'function a() {\n  return false\n}\n',
        beforeMissing: null
      }]
    })
  })

  it('Edit인데 originalFile이 null이면 이유를 모른다(unavailable) — 스트림의 Edit은 크기로 원본을 빼지 않는다', () => {
    // 리뷰 반영 2026-09-27: 기록의 null은 트랜스크립트 writer(n3t, 1만 자)가 한 일이고 스트림 변환은
    // toolUseResult를 그대로 싣는다. 스트림의 Edit null은 원격 실행 재구성처럼 "원본을 모름"이다.
    const d = claudeToolDetail({ ...editResult, originalFile: null }, '', false)
    expect(d).toMatchObject({ files: [{ before: null, beforeMissing: 'unavailable' }] })
  })

  it('Edit의 originalFile이 상한을 넘으면 싣지 않는다', () => {
    const big = 'x'.repeat(BEFORE_MAX_CHARS + 10)
    const d = claudeToolDetail({ ...editResult, originalFile: big }, '', false)
    expect(d).toMatchObject({ files: [{ before: null, beforeMissing: 'too_large' }] })
  })

  it('`\\ No newline at end of file` 줄은 hunk에서 뺀다', () => {
    const d = claudeToolDetail({
      ...editResult,
      structuredPatch: [{
        oldStart: 1, oldLines: 1, newStart: 1, newLines: 1,
        lines: ['-a', '\\ No newline at end of file', '+b', '\\ No newline at end of file']
      }]
    }, '', false)
    expect(d).toMatchObject({ files: [{ hunks: [{ lines: ['-a', '+b'] }] }] })
  })

  it('Write create — 빈 hunk, before 없음(원래 없으니 이유도 null)', () => {
    const d = claudeToolDetail({
      type: 'create', filePath: '/repo/src/new.ts', content: 'export const x = 1\n',
      structuredPatch: [], originalFile: null
    }, '', false)
    expect(d).toEqual({
      kind: 'edit',
      files: [{
        path: '/repo/src/new.ts', operation: 'create', hunks: [], hunksTruncated: 0,
        added: null, removed: null, before: null, beforeMissing: null
      }]
    })
  })

  it('Write update는 overwrite다', () => {
    const d = claudeToolDetail({
      type: 'update', filePath: '/repo/README.md', content: '# 새 제목\n',
      structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-# 옛 제목', '+# 새 제목'] }],
      originalFile: '# 옛 제목\n'
    }, '', false)
    expect(d).toMatchObject({
      kind: 'edit',
      files: [{ operation: 'overwrite', before: '# 옛 제목\n', beforeMissing: null, added: 1, removed: 1 }]
    })
  })

  it('Write update인데 originalFile이 null이면 too_large다', () => {
    const d = claudeToolDetail({
      type: 'update', filePath: '/repo/big.txt', content: '', structuredPatch: [], originalFile: null
    }, '', false)
    expect(d).toMatchObject({ files: [{ operation: 'overwrite', before: null, beforeMissing: 'too_large' }] })
  })

  it('Bash — 종료 코드를 모른다(성공한 셸은 알려주지 않는다)', () => {
    const d = claudeToolDetail({ stdout: 'PASS', stderr: '', interrupted: false, isImage: false }, 'PASS', false)
    expect(d).toEqual({ kind: 'shell', exitCode: null, interrupted: false, timedOut: false })
  })

  it('PowerShell도 같은 모양이라 같은 detail이다', () => {
    const d = claudeToolDetail({ stdout: 'd---- src', stderr: '', interrupted: false }, 'd---- src', false)
    expect(d).toEqual({ kind: 'shell', exitCode: null, interrupted: false, timedOut: false })
  })

  it('timedOutAfterMs는 멈춘 것이 아니라 백그라운드로 넘긴 것이다 — 시간 초과가 아니다', () => {
    // 리뷰 반영 2026-09-27: 2.1.280 스키마의 설명은 "Set when the command hit its timeout and was
    // auto-backgrounded"이고, 그 값은 늘 backgroundTaskId·interrupted: false와 함께 온다(명령은 계속 돈다).
    const d = claudeToolDetail(
      { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1', timedOutAfterMs: 120_000 }, '', false
    )
    expect(d).toEqual({ kind: 'shell', exitCode: null, interrupted: false, timedOut: false })
  })

  it('실패한 도구는 문자열이다 — content의 Exit code N에서 종료 코드를 읽는다', () => {
    const d = claudeToolDetail('Error: Exit code 2\nerror  no-unused-vars', 'Exit code 2\nerror  no-unused-vars', true)
    expect(d).toEqual({ kind: 'shell', exitCode: 2, interrupted: false, timedOut: false })
  })

  it('실패한 셸이 중단된 것이면 둘째 줄의 표식으로 안다', () => {
    // 2.1.280의 ShellError 글: [`Exit code ${code}`, interrupted ? "[Request interrupted by user for tool use]" : "", stderr, stdout]
    const content = 'Exit code 130\n[Request interrupted by user for tool use]\nnpm ERR! canceled'
    expect(claudeToolDetail(`Error: ${content}`, content, true))
      .toEqual({ kind: 'shell', exitCode: 130, interrupted: true, timedOut: false })
    // 표식이 둘째 줄이 아니면 출력에 섞인 글자다
    const echoed = 'Exit code 1\nstderr 첫 줄\n[Request interrupted by user for tool use]'
    expect(claudeToolDetail(`Error: ${echoed}`, echoed, true)).toMatchObject({ interrupted: false })
  })

  it('실패했어도 Exit code로 시작하지 않으면 detail이 없다', () => {
    expect(claudeToolDetail('Error: File does not exist.', 'File does not exist.', true)).toBeUndefined()
  })

  it('성공한 줄의 Exit code 글자는 종료 코드가 아니다', () => {
    expect(claudeToolDetail(undefined, 'Exit code 2 is fine', false)).toBeUndefined()
  })

  it('Grep files_with_matches — 파일 수', () => {
    const d = claudeToolDetail({ mode: 'files_with_matches', numFiles: 3, filenames: ['a', 'b', 'c'] }, '', false)
    expect(d).toEqual({ kind: 'search', count: 3, unit: 'files', truncated: false })
  })

  it('Grep mode가 없으면 files_with_matches다', () => {
    const d = claudeToolDetail({ numFiles: 3, filenames: ['a', 'b', 'c'] }, '', false)
    expect(d).toEqual({ kind: 'search', count: 3, unit: 'files', truncated: false })
  })

  it('Grep content — numMatches가 있으면 일치 수', () => {
    const d = claudeToolDetail({ mode: 'content', numFiles: 2, filenames: [], content: '…', numLines: 14, numMatches: 9 }, '', false)
    expect(d).toEqual({ kind: 'search', count: 9, unit: 'matches', truncated: false })
  })

  it('Grep content — numMatches가 없으면 줄 수', () => {
    const d = claudeToolDetail({ mode: 'content', numFiles: 2, filenames: [], content: '…', numLines: 14 }, '', false)
    expect(d).toEqual({ kind: 'search', count: 14, unit: 'lines', truncated: false })
  })

  it('Grep count — 일치 수', () => {
    const d = claudeToolDetail({ mode: 'count', numFiles: 2, filenames: [], numMatches: 17 }, '', false)
    expect(d).toEqual({ kind: 'search', count: 17, unit: 'matches', truncated: false })
  })

  it('Grep appliedLimit이 수면 잘렸다 — 총수(totalFiles)가 없는 옛 모양', () => {
    const d = claudeToolDetail({ mode: 'files_with_matches', numFiles: 250, filenames: [], appliedLimit: 250 }, '', false)
    expect(d).toMatchObject({ kind: 'search', truncated: true })
  })

  it('Grep files_with_matches — totalFiles가 있으면 그것이 정확한 총수다(잘리지 않았다)', () => {
    // 리뷰 반영 2026-09-27: numFiles는 head_limit(기본 250)으로 자른 뒤의 수이고 totalFiles가 총수다
    const d = claudeToolDetail({
      mode: 'files_with_matches', numFiles: 250, totalFiles: 1234, filenames: [], appliedLimit: 250
    }, '', false)
    expect(d).toEqual({ kind: 'search', count: 1234, unit: 'files', truncated: false })
  })

  it('Grep content — totalLines가 있으면 그것이 정확한 줄 수다', () => {
    const d = claudeToolDetail({
      mode: 'content', numFiles: 0, filenames: [], content: '…', numLines: 250, totalLines: 900, appliedLimit: 250
    }, '', false)
    expect(d).toEqual({ kind: 'search', count: 900, unit: 'lines', truncated: false })
  })

  it('Grep count — numMatches가 없으면 파일 수다(일치 수라고 부르지 않는다)', () => {
    const d = claudeToolDetail({ mode: 'count', numFiles: 2, filenames: [] }, '', false)
    expect(d).toEqual({ kind: 'search', count: 2, unit: 'files', truncated: false })
  })

  it('Glob — durationMs가 있고 mode가 없다', () => {
    const d = claudeToolDetail({ durationMs: 8, numFiles: 2, filenames: ['a', 'b'], truncated: false }, '', false)
    expect(d).toEqual({ kind: 'search', count: 2, unit: 'files', truncated: false })
  })

  it('Glob — totalMatches가 있으면 그것이 개수이고 truncated를 옮긴다', () => {
    const d = claudeToolDetail({ durationMs: 8, numFiles: 100, filenames: [], truncated: true, totalMatches: 412 }, '', false)
    expect(d).toEqual({ kind: 'search', count: 412, unit: 'files', truncated: true })
  })

  it('동기 하위 에이전트 — 도구 수·시간·모델', () => {
    const d = claudeToolDetail({
      content: [{ type: 'text', text: '보고' }], resolvedModel: 'claude-sonnet-5',
      totalToolUseCount: 12, totalDurationMs: 34_000, totalTokens: 5000, usage: {}
    }, '보고', false)
    expect(d).toEqual({ kind: 'subagent', sessionId: null, model: 'claude-sonnet-5', toolCount: 12, durationMs: 34_000 })
  })

  it('비동기 하위 에이전트 — 수치는 모른다', () => {
    const d = claudeToolDetail({
      agentId: 'a1b2', status: 'async_launched', isAsync: true, outputFile: '/tmp/a1b2.output',
      description: '조사', prompt: '…', resolvedModel: 'claude-haiku-5'
    }, '', false)
    expect(d).toEqual({ kind: 'subagent', sessionId: null, model: 'claude-haiku-5', toolCount: null, durationMs: null })
  })

  it('MCP 도구·Read는 detail이 없다', () => {
    expect(claudeToolDetail({ content: [{ type: 'text', text: 'x' }] }, 'x', false)).toBeUndefined()
    expect(claudeToolDetail({
      type: 'text', file: { filePath: '/a', content: 'x', numLines: 1, startLine: 1, totalLines: 1 }
    }, 'x', false)).toBeUndefined()
  })

  it('없거나 모양이 아니면 detail이 없다', () => {
    expect(claudeToolDetail(undefined, 'x', false)).toBeUndefined()
    expect(claudeToolDetail(null, 'x', false)).toBeUndefined()
    expect(claudeToolDetail('그냥 글', 'x', false)).toBeUndefined()
  })

  describe('타입이 어긋나면 detail을 통째로 싣지 않는다 — 반쯤 맞는 detail은 거짓말을 한다', () => {
    it('hunk의 수 자리에 문자열', () => {
      const bad = { ...editResult, structuredPatch: [{ ...editResult.structuredPatch[0], oldStart: '41' }] }
      expect(claudeToolDetail(bad, '', false)).toBeUndefined()
    })

    it('hunk 줄이 문자열이 아니다', () => {
      const bad = { ...editResult, structuredPatch: [{ ...editResult.structuredPatch[0], lines: [1, 2] }] }
      expect(claudeToolDetail(bad, '', false)).toBeUndefined()
    })

    it('경로가 문자열이 아니다', () => {
      expect(claudeToolDetail({ ...editResult, filePath: 7 }, '', false)).toBeUndefined()
    })

    it('Grep content의 numMatches가 문자열', () => {
      expect(claudeToolDetail({ mode: 'content', numFiles: 2, filenames: [], numMatches: '9' }, '', false))
        .toBeUndefined()
    })

    it('Grep의 모르는 mode', () => {
      expect(claudeToolDetail({ mode: 'weird', numFiles: 2, filenames: [] }, '', false)).toBeUndefined()
    })

    it('Glob의 totalMatches가 문자열', () => {
      expect(claudeToolDetail({ durationMs: 8, numFiles: 2, filenames: [], totalMatches: 'many' }, '', false))
        .toBeUndefined()
    })

    it('하위 에이전트의 시간이 문자열', () => {
      expect(claudeToolDetail({ totalToolUseCount: 3, totalDurationMs: '34s' }, '', false)).toBeUndefined()
    })

    // 개수·줄 번호·도구 수는 음이 아닌 정수다 — 렌더러(readDetail)와 같은 판정이다. 어댑터만 느슨하면
    // 로그와 IPC에는 실린 detail이 화면에서 말없이 통째로 사라진다(리뷰 반영 2026-09-27).
    it('검색 개수가 정수가 아니다', () => {
      expect(claudeToolDetail({ mode: 'files_with_matches', numFiles: 2.5, filenames: [] }, '', false)).toBeUndefined()
      expect(claudeToolDetail({ durationMs: 8, numFiles: 2, filenames: [], totalMatches: -1 }, '', false)).toBeUndefined()
    })

    it('hunk의 시작 번호가 음수다', () => {
      const bad = { ...editResult, structuredPatch: [{ ...editResult.structuredPatch[0], oldStart: -1 }] }
      expect(claudeToolDetail(bad, '', false)).toBeUndefined()
    })

    it('하위 에이전트의 도구 수가 정수가 아니다', () => {
      expect(claudeToolDetail({ totalToolUseCount: 3.5, totalDurationMs: 10 }, '', false)).toBeUndefined()
    })
  })

  it('하위 에이전트의 소수 시간은 반올림한다 — 시간은 개수가 아니라 잰 값이다', () => {
    expect(claudeToolDetail({ totalToolUseCount: 3, totalDurationMs: 1234.5 }, '', false))
      .toMatchObject({ kind: 'subagent', toolCount: 3, durationMs: 1235 })
    expect(claudeToolDetail({ totalToolUseCount: 3, totalDurationMs: -5 }, '', false)).toBeUndefined()
  })
})

describe('isClaudeReadResult — 읽기 도구의 원문은 싣지 않는다 (spec §7-A)', () => {
  it('file 객체와 type 문자열이 있으면 읽기다', () => {
    expect(isClaudeReadResult({ type: 'text', file: { filePath: '/a', content: 'x' } })).toBe(true)
    expect(isClaudeReadResult({ type: 'image', file: { base64: '…' } })).toBe(true)
  })

  it('Write(type은 있지만 file이 없다)·셸·문자열은 읽기가 아니다', () => {
    expect(isClaudeReadResult({ type: 'create', filePath: '/a', structuredPatch: [] })).toBe(false)
    expect(isClaudeReadResult({ stdout: '', stderr: '', interrupted: false })).toBe(false)
    expect(isClaudeReadResult('Error: File does not exist.')).toBe(false)
    expect(isClaudeReadResult(undefined)).toBe(false)
  })
})

describe('claudeResultText — tool_result.content를 글로 (FR-13)', () => {
  it('문자열은 그대로다', () => {
    expect(claudeResultText('PASS')).toBe('PASS')
  })

  it('배열은 text를 줄로 잇고 이미지는 [이미지], 그 밖은 [<type>]이다 — base64가 로그에 들어가지 않는다', () => {
    const text = claudeResultText([
      { type: 'text', text: '이슈 2개' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo' } },
      { type: 'document', source: {} },
      { type: 'text', text: '끝' }
    ])
    expect(text).toBe('이슈 2개\n[이미지]\n[document]\n끝')
  })

  it('글이 될 수 없으면 null이다', () => {
    expect(claudeResultText(undefined)).toBeNull()
    expect(claudeResultText({ a: 1 })).toBeNull()
  })
})

const system = (subtype: string, extra: Record<string, unknown>) =>
  ({ type: 'system', subtype, uuid: 'u1', session_id: 's1', ...extra })

describe('claudeNotice — system 줄의 공지 문구 (FR-18)', () => {
  it('자동 압축 — 전후 토큰', () => {
    expect(claudeNotice(system('compact_boundary', {
      compact_metadata: { trigger: 'auto', pre_tokens: 153_214, post_tokens: 12_400, duration_ms: 5100 }
    }))).toEqual({ kind: 'compact', text: '대화가 압축됨 · 자동 · 153,214 → 12,400 토큰' })
  })

  it('수동 압축, post_tokens가 없으면 압축 전만', () => {
    expect(claudeNotice(system('compact_boundary', {
      compact_metadata: { trigger: 'manual', pre_tokens: 153_214 }
    }))).toEqual({ kind: 'compact', text: '대화가 압축됨 · 수동 · 압축 전 153,214 토큰' })
  })

  it('pre_tokens가 없으면 공지를 만들지 않는다', () => {
    expect(claudeNotice(system('compact_boundary', { compact_metadata: { trigger: 'auto' } }))).toBeNull()
    expect(claudeNotice(system('compact_boundary', {}))).toBeNull()
  })

  it('API 재시도 — 초는 올림, 상태 코드', () => {
    expect(claudeNotice(system('api_retry', {
      attempt: 2, max_retries: 10, retry_delay_ms: 4200, error_status: 529, error: 'overloaded_error'
    }))).toEqual({ kind: 'retry', text: 'API 재시도 중 · 2/10번째 · 5초 뒤 · 529' })
  })

  it('API 재시도 — error_status가 null이면 연결 오류다', () => {
    expect(claudeNotice(system('api_retry', {
      attempt: 1, max_retries: 10, retry_delay_ms: 500, error_status: null, error: 'ECONNRESET'
    }))).toEqual({ kind: 'retry', text: 'API 재시도 중 · 1/10번째 · 1초 뒤 · 연결 오류' })
  })

  it('API 재시도 — 필수 필드가 없거나 타입이 다르면 공지를 만들지 않는다', () => {
    expect(claudeNotice(system('api_retry', { max_retries: 10, retry_delay_ms: 500, error_status: 529 }))).toBeNull()
    expect(claudeNotice(system('api_retry', { attempt: '2', max_retries: 10, retry_delay_ms: 500, error_status: 529 }))).toBeNull()
    expect(claudeNotice(system('api_retry', { attempt: 2, max_retries: 10, retry_delay_ms: 500 }))).toBeNull()
  })

  it('권한 거부 — 막힌 호출의 id를 싣는다', () => {
    expect(claudeNotice(system('permission_denied', {
      tool_name: 'Bash', tool_use_id: 'toolu_denied', decision_reason_type: 'rule'
    }))).toEqual({ kind: 'permission_denied', text: '권한 때문에 막힘: Bash', toolUseId: 'toolu_denied' })
  })

  it('권한 거부 — tool_use_id가 없으면 id 없는 공지다', () => {
    const n = claudeNotice(system('permission_denied', { tool_name: 'Bash' }))
    expect(n).toEqual({ kind: 'permission_denied', text: '권한 때문에 막힘: Bash' })
    expect(n && 'toolUseId' in n).toBe(false)
  })

  it('권한 거부 — tool_name이 없으면 공지를 만들지 않는다', () => {
    expect(claudeNotice(system('permission_denied', { tool_use_id: 'x' }))).toBeNull()
  })

  it.each([
    ['overloaded', '과부하'],
    ['model_not_found', '모델 없음'],
    ['permission_denied', '접근 권한 없음'],
    ['server_error', '서버 오류'],
    ['model_blocked', '차단됨'],
    ['quota_exceeded', 'quota_exceeded']
  ])('모델 대체 — 사유 %s → %s', (trigger, reason) => {
    expect(claudeNotice(system('model_fallback', {
      trigger, original_model: 'claude-opus-5', fallback_model: 'claude-sonnet-5', content: '…'
    }))).toEqual({ kind: 'model_fallback', text: `모델 대체: claude-opus-5 → claude-sonnet-5 (${reason})` })
  })

  it('응답 거부로 인한 모델 대체도 같은 종류다', () => {
    expect(claudeNotice(system('model_refusal_fallback', {
      trigger: 'refusal', direction: 'down', original_model: 'claude-opus-5', fallback_model: 'claude-sonnet-5'
    }))).toEqual({ kind: 'model_fallback', text: '모델 대체: claude-opus-5 → claude-sonnet-5 (응답 거부)' })
  })

  it('모델 대체 — 모델 이름이 없으면 공지를 만들지 않는다', () => {
    expect(claudeNotice(system('model_fallback', { trigger: 'overloaded', original_model: 'claude-opus-5' }))).toBeNull()
  })

  it.each(['init', 'status', 'notification', 'informational', 'task_started', 'hook_response', 'turn_duration'])(
    '%s는 공지가 아니다', (subtype) => {
      expect(claudeNotice(system(subtype, { status: 'compacting' }))).toBeNull()
    }
  )
})

describe('claudeDenialNotices — result.permission_denials (FR-19)', () => {
  it('항목마다 권한 거부 공지 하나', () => {
    expect(claudeDenialNotices({
      type: 'result',
      permission_denials: [
        { tool_name: 'Bash', tool_use_id: 'toolu_a', tool_input: { command: 'rm -rf build' } },
        { tool_name: 'Write', tool_use_id: 'toolu_b', tool_input: { file_path: '/etc/x' } }
      ]
    })).toEqual([
      { kind: 'permission_denied', text: '권한 때문에 막힘: Bash', toolUseId: 'toolu_a' },
      { kind: 'permission_denied', text: '권한 때문에 막힘: Write', toolUseId: 'toolu_b' }
    ])
  })

  it('모양이 아닌 항목은 건너뛰고, 목록이 없으면 빈 배열이다', () => {
    expect(claudeDenialNotices({ permission_denials: [null, { tool_use_id: 'x' }, 'Bash'] })).toEqual([])
    expect(claudeDenialNotices({ permission_denials: [] })).toEqual([])
    expect(claudeDenialNotices({})).toEqual([])
  })
})
