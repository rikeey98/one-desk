import { Fragment, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Markdown } from './Markdown'
import { CopyButton } from './CopyButton'
import { IconChevronRight, IconExternalLink } from './icons'
import { useCodePaneOpener } from './code/CodePaneContext'
import { repoRelativePath } from '../code/editPath'
import {
  formatDuration, isSummaryCut, toolDetailOf,
  type EditFile, type TimelineBlock, type ToolDetail, type ToolItem, type ToolLabel
} from '../timeline'
import { stripAnsi } from '../ansi'
import type { DiffLine } from '../diff'
import type { AgentKind } from '@shared/models'

/**
 * 펼친 턴의 블록 (`docs/sdlc/conversation-timeline/` spec FR-13·FR-16~18). OpenCode의 "컴팩트"
 * 타임라인이다 — 중간 텍스트, 한 줄로 접힌 활동 묶음, 따로 선 실패, 파일별 편집. 어댑터가 버리던
 * 것 — 원문 출력·줄 번호 diff·이전 내용·생각·하위 에이전트·공지 — 은 `docs/sdlc/conversation-events/`
 * spec FR-43~50이 그린다(아래 주석의 `events FR-n`).
 *
 * **그리기만 한다.** 이벤트를 블록으로 바꾸는 규칙은 `timeline.ts`에 있고(FR-1), 무엇이
 * 열려 있는지는 `Turn`이 쥔다(plan 다듬은 것 4) — 이 컴포넌트가 state를 가지면 턴을 접을
 * 때 언마운트되며 열어 둔 묶음이 전부 닫힌다. 열거나 닫는 effect는 없다.
 *
 * **열림은 도구 id에 매단다**(FR-15 다듬음 — 리뷰가 찾은 것). 묶음은 그 안의 도구마다
 * `group:<id>`, 편집 파일 줄은 `file:<id>`, 그 파일의 이전 내용은 `before:<id>`, 도구 한 줄(실패로
 * 따로 선 것과 하위 에이전트 카드까지)은 `tool:<id>`다. 블록 key(첫 이벤트의 seq)에 매달면 결과가
 * 뒤늦게 실패로 와서 첫 도구가 묶음 밖으로 빠질 때 key가 바뀌어, 열어 둔 묶음이 새 이벤트 하나에
 * 닫혔다. id는 도구가 어느 블록으로 옮겨 가도 그대로라 — 붙어서 길어지든, 실패로 갈라지든 — 열어
 * 둔 것은 열린 채고 닫힌 것은 닫힌 채다. 묶음이 갈라지면 갈라진 둘이 다 열려 있다(보이던 도구가
 * 닫힌 묶음으로 숨지 않는다). 갈라지지 않는 블록(원문 줄 공지·생각)은 블록 key 그대로다.
 *
 * **agent 출력은 신뢰할 수 없는 입력이다**(CLAUDE.md). 마크다운은 text 블록뿐이고(FR-26)
 * 도구의 입력·출력·오류·원문 줄·이전 내용·생각·공지는 전부 평문 글자다 — React가 이스케이프한다
 * (events FR-53).
 *
 * 블록은 `.turn`의 직계 자식으로 선다(Fragment) — 턴 안의 칸 순서가 곧 블록 순서다. 하위 에이전트
 * 카드 안에서는 같은 컴포넌트가 카드의 자식 칸 안에 선다(events FR-49).
 */

interface Toggles {
  /** 열려 있는 열림 키 — `group:`·`file:`·`before:`·`tool:`에 도구 id, 또는 블록 key */
  openKeys: ReadonlySet<string>
  /**
   * 한 줄의 열림 키 전부를 뒤집는다 — 하나라도 열려 있으면 전부 닫고, 아니면 전부 연다.
   * 묶음·파일 줄은 도구마다 키가 하나라 여럿이다.
   */
  onToggle: (keys: readonly string[]) => void
}

/** 블록이 같이 받는 것 — 열림과, 이 턴을 돌린 agent(카드의 안내 문구가 가른다, events FR-49) */
interface Shared extends Toggles {
  agentKind: AgentKind
}

interface Props extends Shared {
  blocks: readonly TimelineBlock[]
}

type BlockProps<K extends TimelineBlock['kind']> = Shared & { block: Extract<TimelineBlock, { kind: K }> }

/** 도구 한 줄의 열림 키. 묶음 안의 줄이 실패로 따로 서도 같은 키다 — 열어 둔 채 옮겨 간다. */
function toolKeys(item: ToolItem): string[] {
  return [`tool:${item.id}`]
}

/** 묶음의 열림 키 — 안의 도구마다 하나. 하나라도 열려 있으면 묶음이 열려 있다. */
function groupKeys(items: readonly ToolItem[]): string[] {
  return items.map((item) => `group:${item.id}`)
}

/** 편집 파일 줄의 열림 키 — 그 파일을 고친 도구마다 하나. */
function fileKeys(file: EditFile): string[] {
  return file.ids.map((id) => `file:${id}`)
}

/** 파일 줄 안의 이전 내용(events FR-47)의 열림 키 — 파일 줄과 같은 도구 id에 매단다. */
function beforeKeys(file: EditFile): string[] {
  return file.ids.map((id) => `before:${id}`)
}

function isOpen(openKeys: ReadonlySet<string>, keys: readonly string[]): boolean {
  return keys.some((key) => openKeys.has(key))
}

/** 화면의 수 — 어댑터의 공지 문구와 같은 모양(`153,214`, events FR-18)이다. */
function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * 상태를 전하는 유일한 움직임(FR-49) — 상태 줄과 같은 스피너다. 뜻은 곁의 글자가 말한다.
 * **도는 도구 한 줄에만 단다** — 묶음·편집 머리에는 없다. 머리까지 돌면 펼친 진행 중 턴에서 상태
 * 줄 · 머리 · 도구 줄의 스피너 셋이 한꺼번에 돈다(리뷰가 찾은 것). 무엇이 도는지는 상태 줄이 말한다.
 */
function Spinner() {
  return <span className="turn-spinner" aria-hidden="true" />
}

/**
 * 펼침 화살표. 열리면 CSS가 90° 돌려 둔다 — 전환 애니메이션은 없다(장식 모션 금지).
 *
 * **자리는 글자 바로 뒤다** — 묶음·도구·실패 줄이 한 자리를 쓴다. 파일 줄만 오른쪽 끝(`+N −M` 곁)이다
 * (spec §8의 5, 결정 2026-09-27). 오른쪽으로 민 곁 글자(하위 에이전트의 종류)는 꺾쇠 뒤에 선다.
 */
function Chevron() {
  return <IconChevronRight className="tl-chevron" />
}

/**
 * 도구 이름 한 조각. **mcp 도구 이름은 모노 글자다** (spec §8의 5, 결정 2026-09-27) — 이름이 곧
 * 코드라 모양으로 가른다. 라벨에 백틱을 담던 때는 렌더되지 않은 마크다운처럼 보였다. 한국어 라벨
 * (`읽기`·`셸`)은 그대로 글자다. 상태 줄의 지금 도는 도구도 이것을 쓴다.
 */
export function ToolName({ label, category }: ToolLabel) {
  return category === 'mcp' ? <span className="tool-name">{label}</span> : <>{label}</>
}

/**
 * 검색 개수 (events FR-44) — 센 것에 따라 글자가 다르다. TL은 "(N개 일치)" 하나였지만 claude Grep의
 * 기본 출력(`Found N files`)이 센 것은 **파일**이다(events §7 우려 16). 도구가 결과를 잘랐으면 더
 * 있다는 뜻이라 "이상"을 붙인다.
 */
function countText(item: ToolItem): string | null {
  if (item.matches === null) return null
  const n = formatCount(item.matches)
  const more = item.matchesTruncated ? ' 이상' : ''
  switch (item.matchUnit) {
    case 'matches':
      return `${n}개${more} 일치`
    case 'lines':
      return `${n}줄${more}`
    default:
      return `파일 ${n}개${more}`
  }
}

/** 끝까지 돌지 못한 셸 (events FR-43) */
const STOPPED: Record<NonNullable<ToolItem['stopped']>, string> = {
  timed_out: '시간 초과',
  interrupted: '중단됨'
}

/**
 * 도구 한 줄의 공통 조각 — 라벨 · 부제 · (개수) · 종료 코드 · 멈춤 · 상태 · (꺾쇠) · 옆 글자. 꺾쇠를
 * 여기서 받는 것은 옆 글자(오른쪽 끝) **앞**에 세우기 위해서다.
 */
function ToolLine({ item, aside, chevron = false }: {
  item: ToolItem
  aside?: ReactNode
  chevron?: boolean
}) {
  const matches = countText(item)
  // 성공한 claude 셸은 종료 코드를 모른다(null, events §7 우려 15) — 0과 모르는 것은 적지 않는다.
  const exited = item.exitCode !== null && item.exitCode !== 0
  // 조각 사이의 ' '는 접근성 이름과 글자에 틈을 준다(`셸 pnpm test`). flex 안의 공백 글자는
  // 화면 배치에 끼어들지 않는다. 부제가 경로면 모노다 — UI 글꼴은 `\`를 `₩`로 그린다(spec §8의 7).
  return (
    <>
      <span className="tl-label"><ToolName label={item.label} category={item.category} /></span>
      {item.subtitle && (
        <>
          {' '}
          <span className={item.subtitlePath ? 'tl-sub path-text' : 'tl-sub'} title={item.subtitle}>
            {item.subtitle}
          </span>
        </>
      )}
      {matches !== null && <>{' '}<span className="tl-count">({matches})</span></>}
      {exited && <>{' '}<span className="tl-exit">종료 코드 {item.exitCode}</span></>}
      {item.stopped !== null && <>{' '}<span className="tl-state">{STOPPED[item.stopped]}</span></>}
      {item.state === 'running' && <Spinner />}
      {item.state === 'unknown' && <>{' '}<span className="tl-state">결과 없음</span></>}
      {chevron && <Chevron />}
      {aside ? <>{' '}<span className="tl-aside">{aside}</span></> : null}
    </>
  )
}

/** 입력 JSON·원문 줄·이전 내용 — 모노, 최대 높이 안에서 스크롤한다. 위에서부터 읽는 글이다. */
function Output({ text }: { text: string }) {
  return <pre className="tl-output">{text}</pre>
}

/**
 * 도구 출력 (events FR-43) — 원문의 **끝부분**이다. **열 때 바닥으로 스크롤한 채 연다**: 남긴 것이
 * 끝(앞을 버렸다)이고, 셸에서 보고 싶은 것도 끝(테스트 결과·오류)이다. 펼칠 때만 마운트되므로(열림이
 * 거짓이면 그리지 않는다 — plan 리스크 "큰 출력의 렌더링") 마운트가 곧 여는 순간이다. 열어 둔 뒤
 * 사용자가 올려 읽는 자리를 빼앗지 않도록 한 번만 내린다.
 */
function TailOutput({ text }: { text: string }) {
  const ref = useRef<HTMLPreElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])
  return <pre className="tl-output" ref={ref}>{text}</pre>
}

/**
 * 도구 결과의 출력 블록과 잘림 안내 (events FR-43·45·46·49). 앞을 버렸으면 블록 **위**에 몇 자인지,
 * 200자 요약이 잘렸으면(옛 로그) 아래에 TL FR-16의 안내다 — 잘린 것을 전부인 것처럼 보이면 안 된다.
 *
 * **ANSI 제어열은 셸 출력에서만, 화면에서만 걷는다**(events FR-43) — 로그는 CLI가 준 그대로다.
 * mcp·그 밖의 출력은 걷지 않는다(FR-45).
 */
function ToolOutput({ item }: { item: ToolItem }) {
  if (item.output === null) return null
  const text = item.category === 'shell' ? stripAnsi(item.output) : item.output
  return (
    <>
      {item.outputTruncated > 0 && (
        <div className="tl-output-note">앞부분 {formatCount(item.outputTruncated)}자는 기록하지 않았습니다</div>
      )}
      <TailOutput text={text} />
      {isSummaryCut(item) && <div className="tl-output-note">출력 앞부분만 기록됩니다</div>}
    </>
  )
}

function ToolDetailView({ item, detail }: { item: ToolItem; detail: ToolDetail | null }) {
  switch (detail?.kind) {
    case 'shell':
      return (
        <div className="tl-detail">
          {detail.command !== '' && (
            <div className="tl-command">
              <pre>{detail.command}</pre>
              <CopyButton text={detail.command} label="명령 복사" />
            </div>
          )}
          <ToolOutput item={item} />
        </div>
      )
    case 'subagent':
      // 하위 에이전트는 카드다(events FR-38) — 이 줄로 오지 않지만, 오면 지시를 평문으로 보인다(FR-26).
      return <div className="tl-detail"><div className="tl-plain">{detail.prompt}</div></div>
    case 'input':
      // mcp·그 밖은 입력 JSON 아래에 출력이다 (events FR-45)
      return <div className="tl-detail"><Output text={detail.json} /><ToolOutput item={item} /></div>
    default:
      return <div className="tl-detail"><ToolOutput item={item} /></div>
  }
}

/**
 * 펼쳐 보일 것이 있는가. 하위 에이전트는 지시가 없으면 한 줄로 끝난다. mcp·그 밖은 입력이 없어도
 * 출력이 있으면 펼친다(events FR-45).
 */
function expandable(item: ToolItem, detail: ToolDetail | null): boolean {
  if (detail !== null) return detail.kind !== 'subagent' || detail.prompt !== null
  return (item.category === 'mcp' || item.category === 'other') && item.output !== null
}

function ToolRow({ item, open, onToggle }: { item: ToolItem; open: boolean; onToggle: () => void }) {
  const detail = toolDetailOf(item)
  const aside = detail?.kind === 'subagent' ? detail.agentType : null
  // 읽기·검색·웹·할 일은 펼칠 것이 없다 — 버튼이 아니라 한 줄이다(OpenCode의 컴팩트 행).
  if (!expandable(item, detail)) {
    return <li><div className="tl-tool"><ToolLine item={item} aside={aside} /></div></li>
  }
  return (
    <li>
      <button type="button" className="tl-tool" aria-expanded={open} onClick={onToggle}>
        <ToolLine item={item} aside={aside} chevron />
      </button>
      {open && <ToolDetailView item={item} detail={detail} />}
    </li>
  )
}

function ActivityBlock({ block, openKeys, onToggle }: BlockProps<'activity'>) {
  const keys = groupKeys(block.items)
  const open = isOpen(openKeys, keys)
  return (
    <div className="tl-activity">
      {/* 글자는 `block.label`과 같은 모양이다(`3 읽기, list_issues 사용됨`) — 조각으로 그리는 것은
          mcp 이름만 모노로 두기 위해서다(spec §8의 5). 이름은 그 한 줄 글자를 그대로 준다 — 조각의
          경계에서 이름 계산이 틈을 끼우면(`list_issues ,`) 셀렉터와 스크린리더가 다른 글을 본다. */}
      <button
        type="button"
        className="tl-head"
        aria-label={block.label}
        aria-expanded={open}
        onClick={() => onToggle(keys)}
      >
        <span>
          {block.items.length}{' '}
          {block.labels.map((piece, i) => (
            <Fragment key={piece.label}>
              {i > 0 && ', '}
              <ToolName label={piece.label} category={piece.category} />
            </Fragment>
          ))}
          {' '}사용됨
        </span>
        <Chevron />
      </button>
      {open && (
        <ul className="tl-tools">
          {block.items.map((item, i) => (
            <ToolRow
              key={`${i}:${item.id}`}
              item={item}
              open={isOpen(openKeys, toolKeys(item))}
              onToggle={() => onToggle(toolKeys(item))}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** 줄 부호. 지운 줄은 글자 `-`가 아니라 빼기 기호로 그린다 — `+N −M`과 같은 글자다. */
const SIGNS: Record<DiffLine['sign'], { text: string; className: string }> = {
  '+': { text: '+', className: 'tl-add' },
  '-': { text: '−', className: 'tl-del' },
  ' ': { text: ' ', className: 'tl-ctx' }
}

/**
 * 파일 줄을 펼친 diff (FR-18). 세부의 hunk로 만든 diff(`numbered`, events FR-47)는 줄마다 옛·새 번호
 * 칸이 앞에 서고, hunk 앞에서 건너뛴 줄이 있으면 `⋯ N줄` 구분선이 선다 — 첫 hunk가 1줄에서 시작하지
 * 않으면 맨 위에도. 번호 칸은 복사에서 빠진다(`user-select: none`, `.tl-diff-no`). 입력으로 만든
 * 번호 없는 diff는 TL 그대로다.
 */
function Diff({ file }: { file: EditFile }) {
  const numbered = file.numbered
  return (
    <div className="tl-diff">
      {file.hunks.map((hunk, h) => (
        <Fragment key={h}>
          {numbered && (hunk.gapBefore ?? 0) > 0 && (
            <div className="tl-diff-gap">⋯ {formatCount(hunk.gapBefore!)}줄</div>
          )}
          <div className="tl-hunk">
            {hunk.lines.map((line, i) => {
              const sign = SIGNS[line.sign]
              return (
                <div className={`tl-line ${sign.className}`} key={i}>
                  {numbered && (
                    <>
                      <span className="tl-diff-no">{line.oldNo ?? ''}</span>
                      <span className="tl-diff-no">{line.newNo ?? ''}</span>
                    </>
                  )}
                  <span className="tl-sign">{sign.text}</span>
                  <span className="tl-line-text">{line.text}</span>
                </div>
              )
            })}
          </div>
        </Fragment>
      ))}
      {file.truncated > 0 && <div className="tl-more">… {formatCount(file.truncated)}줄 더</div>}
    </div>
  )
}

/**
 * 편집 파일 줄의 `코드 칸에서 열기` (`docs/sdlc/code-editor/` FR-23). 칸의 대상 repo 안의 경로일 때만 선다 — 컨텍스트가
 * 없거나(도크 밖) repo 밖이면 없다. 그 편집의 첫 hunk 줄로 연다(번호가 없으면 첫 줄).
 */
function OpenInPane({ file, describedBy }: { file: EditFile; describedBy: string }) {
  const opener = useCodePaneOpener()
  if (!opener || !file.path) return null
  const rel = repoRelativePath(file.path, opener.repoPath)
  if (!rel) return null
  const line = file.hunks.find((h) => h.newStart !== undefined)?.newStart ?? 1
  return (
    <button
      type="button"
      className="row-action tl-file-open"
      // 이름에 경로를 넣지 않는다 — 파일 줄을 `{ name: /auth\.ts/ }`로 잡는 e2e가 이 버튼까지 잡는다(실제로 셋이 깨졌다).
      // 어느 파일인지는 설명(aria-describedby)이 그 줄의 경로를 가리켜 말한다.
      aria-label="코드 칸에서 열기"
      aria-describedby={describedBy}
      title="코드 칸에서 열기"
      onClick={() => opener.open(rel, line)}
    >
      <IconExternalLink width="11" height="11" />
    </button>
  )
}

function EditFileRow({ file, open, onToggle, beforeOpen, onToggleBefore }: {
  file: EditFile
  open: boolean
  onToggle: () => void
  beforeOpen: boolean
  onToggleBefore: () => void
}) {
  const pathId = useId()
  // 모양을 모르는 편집(NotebookEdit·patch)은 diff가 없다 — 경로만이고 펼칠 것이 없다(FR-7).
  // 이전 내용이 있는 덮어쓰기는 diff가 없어도 펼친다(events FR-47).
  const hasDiff = file.hunks.length > 0
  const hasBefore = file.before !== null
  const line = (
    <>
      {/* 경로면 모노다(spec §8의 7). 경로를 모르는 편집은 부제나 라벨이 대신 서므로 글자 그대로다. */}
      <span id={pathId} className={file.path ? 'tl-path path-text' : 'tl-path'} title={file.path || file.displayPath}>
        {file.displayPath}
      </span>
      {file.created && <>{' '}<span className="tl-created">새로 씀</span></>}
      {hasDiff && (
        <>
          {' '}
          <span className="tl-stat">
            <span className="tl-added">+{file.added}</span>
            {/* 지운 수를 모르면(옛 내용을 모르는 덮어쓰기) 적지 않는다 — −0은 "지운 것이 없다"는 거짓이다 */}
            {file.removed !== null && <>{' '}<span className="tl-removed">−{file.removed}</span></>}
          </span>
        </>
      )}
    </>
  )
  if (!hasDiff && !hasBefore) return <li className="tl-file-row"><div className="tl-file">{line}</div><OpenInPane file={file} describedBy={pathId} /></li>
  return (
    <li>
      {/* 버튼 안에 버튼을 둘 수 없다 — 여는 아이콘은 펼치기 버튼 옆에 선다 */}
      <div className="tl-file-row">
        <button type="button" className="tl-file" aria-expanded={open} onClick={onToggle}>
          {line}
          <Chevron />
        </button>
        <OpenInPane file={file} describedBy={pathId} />
      </div>
      {open && hasDiff && <Diff file={file} />}
      {/* 덮어쓰기 전 파일 전체 (events FR-47) — 파일 줄 안에서 따로 연다. 파일 내용은 신뢰할 수 없는
          입력이라 평문이고, 위에서부터 읽는 글이라 바닥으로 내리지 않는다. */}
      {open && hasBefore && (
        <div className="tl-before">
          <button type="button" className="tl-before-toggle" aria-expanded={beforeOpen} onClick={onToggleBefore}>
            {beforeOpen ? '이전 내용 숨기기' : '이전 내용 보기'}
          </button>
          {beforeOpen && <Output text={file.before!} />}
        </div>
      )}
    </li>
  )
}

function EditBlock({ block, openKeys, onToggle }: BlockProps<'edit'>) {
  return (
    <div className="tl-edit">
      <div className="tl-head tl-head-static">
        <span>편집 · 파일 {block.files.length}개</span>
      </div>
      <ul className="tl-files">
        {block.files.map((file) => {
          const keys = fileKeys(file)
          const before = beforeKeys(file)
          return (
            <EditFileRow
              key={keys[0]}
              file={file}
              open={isOpen(openKeys, keys)}
              onToggle={() => onToggle(keys)}
              beforeOpen={isOpen(openKeys, before)}
              onToggleBefore={() => onToggle(before)}
            />
          )
        })}
      </ul>
    </div>
  )
}

/**
 * 실패한 도구 (FR-17) — 묶음 밖에 따로 선다. 펼치면 출력 블록(events FR-46)이다. 권한 때문에 막힌
 * 호출은 "실패" 대신 "권한 거부"이고, 공지선이 바로 아래에 선다(투영이 세운다, events FR-41).
 */
function ToolErrorBlock({ block, openKeys, onToggle }: BlockProps<'tool-error'>) {
  const { item } = block
  // 묶음 안에서 열어 둔 도구가 실패로 판명돼 여기로 옮겨 와도 열린 채다 — 같은 도구 키다.
  const keys = toolKeys(item)
  const open = isOpen(openKeys, keys)
  const line = (
    <>
      <ToolLine item={item} />
      {' '}
      <span className="tl-failed">{item.denied ? '권한 거부' : '실패'}</span>
    </>
  )
  return (
    <div className="tl-tool-error">
      {item.output === null ? (
        <div className="tl-tool">{line}</div>
      ) : (
        <button type="button" className="tl-tool" aria-expanded={open} onClick={() => onToggle(keys)}>
          {line}
          <Chevron />
        </button>
      )}
      {open && <ToolOutput item={item} />}
    </div>
  )
}

/** 생각 한 줄의 글자 (events FR-48) — 추정이면 "약", 시간을 모르면 "생각"뿐이다. */
function reasoningLabel(block: Extract<TimelineBlock, { kind: 'reasoning' }>): string {
  if (block.durationMs === null) return '생각'
  return `생각 · ${block.estimated ? '약 ' : ''}${formatDuration(block.durationMs)}`
}

/**
 * 생각 (events FR-48) — 접힌 한 줄 `생각 · 약 4초`, 펼치면 본문이다. **본문은 마크다운으로 해석하지
 * 않는다** — 모델의 생각은 신뢰할 수 없는 입력이다(TL FR-26의 평문 목록에 생각을 더한다). 본문이
 * 빈 생각(claude는 대부분 서명만 보낸다, §7-A)은 펼칠 것 없는 한 줄이다. 열림은 블록 key다 —
 * 생각은 갈라지지 않는다.
 */
function ReasoningBlock({ block, openKeys, onToggle }: BlockProps<'reasoning'>) {
  const label = reasoningLabel(block)
  if (block.text.trim() === '') {
    return <div className="tl-reasoning"><div className="tl-head tl-head-static"><span>{label}</span></div></div>
  }
  const open = openKeys.has(block.key)
  return (
    <div className="tl-reasoning">
      <button type="button" className="tl-head" aria-expanded={open} onClick={() => onToggle([block.key])}>
        <span>{label}</span>
        <Chevron />
      </button>
      {open && <div className="tl-reasoning-body">{block.text}</div>}
      {open && block.truncated > 0 && (
        <div className="tl-output-note">뒷부분 {formatCount(block.truncated)}자는 기록하지 않았습니다</div>
      )}
    </div>
  )
}

/**
 * 카드 머리의 메타 (events FR-49) — `도구 12회 · 34초 · <모델>`. 호출이 끝나며 알려 준 값이 먼저이고,
 * 도구 수를 모르면 카드 안에서 센 수다(셀 것이 없으면 뺀다 — OpenCode는 자식을 보내지 않는다).
 */
function subagentMeta(block: Extract<TimelineBlock, { kind: 'subagent' }>): string | null {
  const info = block.item.subagent
  const tools = info?.toolCount ?? (block.tools > 0 ? block.tools : null)
  const pieces = [
    tools === null ? null : `도구 ${formatCount(tools)}회`,
    info?.durationMs == null ? null : formatDuration(info.durationMs),
    info?.model || null
  ].filter((piece): piece is string => piece !== null)
  return pieces.length > 0 ? pieces.join(' · ') : null
}

/**
 * 하위 에이전트 카드 (events FR-38·49). 머리 줄 전체가 토글이다 — 라벨 · 설명 · (꺾쇠) · 오른쪽에
 * 종류 · 상태 · 메타. **이름은 `하위 에이전트 <설명>`**(aria-label)이다 — 상태·메타 글자가 이름에
 * 빨려 들어가면 셀렉터와 스크린리더가 턴마다 다른 이름을 본다. 펼치면 지시(평문) · 자식 블록(같은
 * 컴포넌트, 들여쓰기와 세로선) · 결과(출력 블록)다. 열림 키는 호출의 도구 키다 — 옛 한 줄과 같다.
 *
 * 실패한 호출도 카드다 — 자식이 한 일이 카드 안에 있어야 한다. OpenCode는 하위 세션의 활동을 내보내지
 * 않으므로(`run`, spec §2-3) 자식 자리에 그렇다고 말한다 — 모르는 것을 빈칸으로 두지 않는다.
 */
function SubagentBlock({ block, openKeys, onToggle, agentKind }: BlockProps<'subagent'>) {
  const { item } = block
  const keys = toolKeys(item)
  const open = isOpen(openKeys, keys)
  const detail = toolDetailOf(item)
  const agent = detail?.kind === 'subagent' ? detail : null
  const prompt = agent?.prompt ?? null
  const unseen = agentKind === 'opencode' && block.blocks.length === 0
  const meta = subagentMeta(block)
  const failed = item.state === 'failed'
  const aside = agent?.agentType || failed || meta ? (
    <>
      {agent?.agentType && <span>{agent.agentType}</span>}
      {failed && <>{' '}<span className="tl-failed">{item.denied ? '권한 거부' : '실패'}</span></>}
      {meta && <>{' '}<span className="tl-subagent-meta">{meta}</span></>}
    </>
  ) : null
  const name = item.subtitle ? `${item.label} ${item.subtitle}` : item.label
  const hasBody = prompt !== null || block.blocks.length > 0 || item.output !== null || unseen

  if (!hasBody) {
    return (
      <div className="tl-subagent">
        <div className="tl-tool tl-subagent-head"><ToolLine item={item} aside={aside} /></div>
      </div>
    )
  }
  return (
    <div className="tl-subagent">
      <button
        type="button"
        className="tl-tool tl-subagent-head"
        aria-label={name}
        aria-expanded={open}
        onClick={() => onToggle(keys)}
      >
        <ToolLine item={item} aside={aside} chevron />
      </button>
      {open && (
        <div className="tl-detail">
          {/* 지시는 평문이다 — agent가 agent에게 쓴 글이라도 마크다운으로 그리지 않는다(FR-26). */}
          {prompt !== null && <div className="tl-plain">{prompt}</div>}
          {block.blocks.length > 0 && (
            <div className="tl-subagent-children">
              <TimelineBlocks blocks={block.blocks} openKeys={openKeys} onToggle={onToggle} agentKind={agentKind} />
            </div>
          )}
          {unseen && <div className="tl-subagent-note">OpenCode는 하위 에이전트의 활동을 보내지 않습니다</div>}
          {/* 하위 에이전트의 보고도 도구 출력이다 — 평문이다(FR-26). */}
          <ToolOutput item={item} />
        </div>
      )}
    </div>
  )
}

/**
 * 해석하지 못한 출력 (FR-2의 raw) — 몇 줄인지만 보이고 펼치면 원문이다.
 *
 * 어댑터의 공지(압축·재시도·권한 거부·모델 대체, events FR-41·50)는 **공지선**이다 — 턴 사이 공지
 * (TL FR-19)와 같은 가운데 한 줄, 양옆 가는 선. 문구는 어댑터가 만든 그대로이고 펼칠 것이 없다.
 * 권한 거부·모델 대체는 경고 색이다 — 무엇이 막혔거나 바뀌었다. 보기 전용이고 live region이 아니다.
 */
function NoticeBlock({ block, openKeys, onToggle }: BlockProps<'notice'>) {
  if (block.noticeKind !== 'raw') {
    const warn = block.noticeKind === 'permission_denied' || block.noticeKind === 'model_fallback'
    return (
      <div className={warn ? 'tl-notice tl-notice-line tl-notice-warn' : 'tl-notice tl-notice-line'}>
        <span>{block.text}</span>
      </div>
    )
  }
  // 원문 줄은 붙기만 하고 갈라지지 않는다 — 블록 key(첫 줄의 seq)가 그대로다.
  const open = openKeys.has(block.key)
  return (
    <div className="tl-notice">
      <button type="button" className="tl-head" aria-expanded={open} onClick={() => onToggle([block.key])}>
        <span>{block.text}</span>
        <Chevron />
      </button>
      {open && <Output text={block.lines.join('\n')} />}
    </div>
  )
}

export function TimelineBlocks({ blocks, openKeys, onToggle, agentKind }: Props) {
  if (blocks.length === 0) {
    return <div className="tl-empty">기록된 활동이 없습니다</div>
  }
  const shared = { openKeys, onToggle, agentKind }
  return (
    <>
      {blocks.map((block) => {
        switch (block.kind) {
          case 'text':
            return <div className="tl-text" key={block.key}><Markdown text={block.text} /></div>
          case 'activity':
            return <ActivityBlock key={block.key} block={block} {...shared} />
          case 'edit':
            return <EditBlock key={block.key} block={block} {...shared} />
          case 'tool-error':
            return <ToolErrorBlock key={block.key} block={block} {...shared} />
          case 'error':
            return <div className="tl-error" key={block.key}>{block.message}</div>
          case 'notice':
            return <NoticeBlock key={block.key} block={block} {...shared} />
          case 'reasoning':
            return <ReasoningBlock key={block.key} block={block} {...shared} />
          case 'subagent':
            return <SubagentBlock key={block.key} block={block} {...shared} />
        }
      })}
    </>
  )
}
