import { Fragment } from 'react'
import { Markdown } from './Markdown'
import { CopyButton } from './CopyButton'
import { IconChevronRight } from './icons'
import {
  toolDetailOf, type EditFile, type TimelineBlock, type ToolDetail, type ToolItem, type ToolLabel
} from '../timeline'
import type { DiffLine } from '../diff'

/**
 * 펼친 턴의 블록 여섯 종류 (`docs/sdlc/conversation-timeline/` spec FR-13·FR-16~18).
 * OpenCode의 "컴팩트" 타임라인이다 — 중간 텍스트, 한 줄로 접힌 활동 묶음, 따로 선 실패,
 * 파일별 편집.
 *
 * **그리기만 한다.** 이벤트를 블록으로 바꾸는 규칙은 `timeline.ts`에 있고(FR-1), 무엇이
 * 열려 있는지는 `Turn`이 쥔다(plan 다듬은 것 4) — 이 컴포넌트가 state를 가지면 턴을 접을
 * 때 언마운트되며 열어 둔 묶음이 전부 닫힌다. 열거나 닫는 effect는 없다.
 *
 * **열림은 도구 id에 매단다**(FR-15 다듬음 — 리뷰가 찾은 것). 묶음은 그 안의 도구마다
 * `group:<id>`, 편집 파일 줄은 `file:<id>`, 도구 한 줄(실패로 따로 선 것까지)은 `tool:<id>`다.
 * 블록 key(첫 이벤트의 seq)에 매달면 결과가 뒤늦게 실패로 와서 첫 도구가 묶음 밖으로 빠질 때
 * key가 바뀌어, 열어 둔 묶음이 새 이벤트 하나에 닫혔다. id는 도구가 어느 블록으로 옮겨 가도
 * 그대로라 — 붙어서 길어지든, 실패로 갈라지든 — 열어 둔 것은 열린 채고 닫힌 것은 닫힌 채다.
 * 묶음이 갈라지면 갈라진 둘이 다 열려 있다(보이던 도구가 닫힌 묶음으로 숨지 않는다).
 *
 * **agent 출력은 신뢰할 수 없는 입력이다**(CLAUDE.md). 마크다운은 text 블록뿐이고(FR-26)
 * 도구의 입력·출력·오류·원문 줄은 전부 평문 글자다 — React가 이스케이프한다.
 *
 * 블록은 `.turn`의 직계 자식으로 선다(Fragment) — 턴 안의 칸 순서가 곧 블록 순서다.
 */

interface Toggles {
  /** 열려 있는 열림 키 — `group:`·`file:`·`tool:`에 도구 id, 또는 공지의 블록 key */
  openKeys: ReadonlySet<string>
  /**
   * 한 줄의 열림 키 전부를 뒤집는다 — 하나라도 열려 있으면 전부 닫고, 아니면 전부 연다.
   * 묶음·파일 줄은 도구마다 키가 하나라 여럿이다.
   */
  onToggle: (keys: readonly string[]) => void
}

interface Props extends Toggles {
  blocks: readonly TimelineBlock[]
}

type BlockProps<K extends TimelineBlock['kind']> = Toggles & { block: Extract<TimelineBlock, { kind: K }> }

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

function isOpen(openKeys: ReadonlySet<string>, keys: readonly string[]): boolean {
  return keys.some((key) => openKeys.has(key))
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
 * 도구 한 줄의 공통 조각 — 라벨 · 부제 · (N개 일치) · 상태 · (꺾쇠) · 옆 글자. 꺾쇠를 여기서 받는
 * 것은 옆 글자(오른쪽 끝) **앞**에 세우기 위해서다.
 */
function ToolLine({ item, aside, chevron = false }: {
  item: ToolItem
  aside?: string | null
  chevron?: boolean
}) {
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
      {item.matches !== null && <>{' '}<span className="tl-count">({item.matches}개 일치)</span></>}
      {item.state === 'running' && <Spinner />}
      {item.state === 'unknown' && <>{' '}<span className="tl-state">결과 없음</span></>}
      {chevron && <Chevron />}
      {aside && <>{' '}<span className="tl-aside">{aside}</span></>}
    </>
  )
}

/** 결과 요약·입력 JSON·원문 줄 — 모노, 최대 높이 안에서 스크롤한다. */
function Output({ text }: { text: string }) {
  return <pre className="tl-output">{text}</pre>
}

function ToolDetailView({ detail }: { detail: ToolDetail }) {
  switch (detail.kind) {
    case 'shell':
      return (
        <div className="tl-detail">
          {detail.command !== '' && (
            <div className="tl-command">
              <pre>{detail.command}</pre>
              <CopyButton text={detail.command} label="명령 복사" />
            </div>
          )}
          {detail.output !== null && <Output text={detail.output} />}
          {/* 기록되는 것은 200자 요약뿐이다 — 잘린 것을 전부인 것처럼 보이면 안 된다(FR-16). */}
          {detail.truncated && <div className="tl-truncated">출력 앞부분만 기록됩니다</div>}
        </div>
      )
    case 'subagent':
      // 지시는 평문이다 — agent가 agent에게 쓴 글이라도 마크다운으로 그리지 않는다(FR-26).
      return <div className="tl-detail"><div className="tl-plain">{detail.prompt}</div></div>
    case 'input':
      return <div className="tl-detail"><Output text={detail.json} /></div>
  }
}

/** 펼쳐 보일 것이 있는가. 하위 에이전트는 지시가 없으면 한 줄로 끝난다. */
function expandable(detail: ToolDetail | null): detail is ToolDetail {
  if (detail === null) return false
  return detail.kind !== 'subagent' || detail.prompt !== null
}

function ToolRow({ item, open, onToggle }: { item: ToolItem; open: boolean; onToggle: () => void }) {
  const detail = toolDetailOf(item)
  const aside = detail?.kind === 'subagent' ? detail.agentType : null
  // 읽기·검색·웹·할 일은 펼칠 것이 없다 — 버튼이 아니라 한 줄이다(OpenCode의 컴팩트 행).
  if (!expandable(detail)) {
    return <li><div className="tl-tool"><ToolLine item={item} aside={aside} /></div></li>
  }
  return (
    <li>
      <button type="button" className="tl-tool" aria-expanded={open} onClick={onToggle}>
        <ToolLine item={item} aside={aside} chevron />
      </button>
      {open && <ToolDetailView detail={detail} />}
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

function Diff({ file }: { file: EditFile }) {
  return (
    <div className="tl-diff">
      {file.hunks.map((hunk, h) => (
        <div className="tl-hunk" key={h}>
          {hunk.lines.map((line, i) => {
            const sign = SIGNS[line.sign]
            return (
              <div className={`tl-line ${sign.className}`} key={i}>
                <span className="tl-sign">{sign.text}</span>
                <span className="tl-line-text">{line.text}</span>
              </div>
            )
          })}
        </div>
      ))}
      {file.truncated > 0 && <div className="tl-more">… {file.truncated}줄 더</div>}
    </div>
  )
}

function EditFileRow({ file, open, onToggle }: { file: EditFile; open: boolean; onToggle: () => void }) {
  // 모양을 모르는 편집(NotebookEdit·patch)은 diff가 없다 — 경로만이고 펼칠 것이 없다(FR-7).
  const hasDiff = file.hunks.length > 0
  const line = (
    <>
      {/* 경로면 모노다(spec §8의 7). 경로를 모르는 편집은 부제나 라벨이 대신 서므로 글자 그대로다. */}
      <span className={file.path ? 'tl-path path-text' : 'tl-path'} title={file.path || file.displayPath}>
        {file.displayPath}
      </span>
      {file.created && <>{' '}<span className="tl-created">새로 씀</span></>}
      {hasDiff && (
        <>
          {' '}
          <span className="tl-stat">
            <span className="tl-added">+{file.added}</span>{' '}<span className="tl-removed">−{file.removed}</span>
          </span>
        </>
      )}
    </>
  )
  if (!hasDiff) return <li><div className="tl-file">{line}</div></li>
  return (
    <li>
      <button type="button" className="tl-file" aria-expanded={open} onClick={onToggle}>
        {line}
        <Chevron />
      </button>
      {open && <Diff file={file} />}
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
          return (
            <EditFileRow key={keys[0]} file={file} open={isOpen(openKeys, keys)} onToggle={() => onToggle(keys)} />
          )
        })}
      </ul>
    </div>
  )
}

/** 실패한 도구 (FR-17) — 묶음 밖에 따로 선다. 펼치면 결과 요약(오류 문구)이다. */
function ToolErrorBlock({ block, openKeys, onToggle }: BlockProps<'tool-error'>) {
  const { item } = block
  // 묶음 안에서 열어 둔 도구가 실패로 판명돼 여기로 옮겨 와도 열린 채다 — 같은 도구 키다.
  const keys = toolKeys(item)
  const open = isOpen(openKeys, keys)
  const line = (
    <>
      <ToolLine item={item} />
      {' '}
      <span className="tl-failed">실패</span>
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
      {open && item.output !== null && <Output text={item.output} />}
    </div>
  )
}

/** 해석하지 못한 출력 (FR-2의 raw) — 몇 줄인지만 보이고 펼치면 원문이다. */
function NoticeBlock({ block, openKeys, onToggle }: BlockProps<'notice'>) {
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

export function TimelineBlocks({ blocks, openKeys, onToggle }: Props) {
  if (blocks.length === 0) {
    return <div className="tl-empty">기록된 활동이 없습니다</div>
  }
  const shared = { openKeys, onToggle }
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
        }
      })}
    </>
  )
}
