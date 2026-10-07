import type { ReportData } from '@shared/models'
import { BUCKETS, projectReport, type ConversationLine, type WorkspaceTotals } from './project'
import { dayLabel, durationLabel, oneLine, periodLabel } from './format'

/** 문서 보기와 마크다운이 담는 것 (FR-15). 요일·이슈 흐름 보기는 이 값을 따르지 않는다 */
export interface Include {
  issues: boolean
  conversations: boolean
  memos: boolean
  /** 대화 줄 아래 마지막 답 한 줄 */
  answers: boolean
}

export const DEFAULT_INCLUDE: Include = { issues: true, conversations: true, memos: false, answers: true }

/** 화면 안내문과 마크다운의 마지막 줄 — 상태는 기간 끝이 아니라 리포트를 만든 때의 것이다 (spec §6의 1·2) */
export const STATE_NOTE = '상태는 리포트를 만든 때의 것입니다. 기간 안에 끝냈다가 다시 연 이슈는 완료에 들지 않습니다.'

export function reportTitle(data: Pick<ReportData, 'since' | 'until'>): string {
  return `리포트 ${periodLabel(data)}`
}

export function totalsLine(t: WorkspaceTotals, include: Include): string {
  const parts: string[] = []
  if (include.issues) parts.push(`새 이슈 ${t.created}`, `완료 ${t.done}`, `진행 중 ${t.doing}`)
  if (include.conversations) parts.push(`대화 ${t.conversations}`, `agent 실행 ${durationLabel(t.seconds)}`)
  return parts.join(' · ')
}

function conversationText(line: ConversationLine): string {
  const bits = [`${line.turns}턴`]
  if (line.seconds > 0) bits.push(durationLabel(line.seconds))
  return `${oneLine(line.conversation.title)} · ${bits.join(' · ')}`
}

function answerLine(line: ConversationLine, indent: string, include: Include): string[] {
  const answer = line.conversation.lastAnswer
  if (!include.answers || answer === null) return []
  const first = oneLine(answer)
  return first ? [`${indent}  > ${first}`] : []
}

/**
 * 내보낼 글 (FR-12). 탭과 무관하게 문서 보기의 순서다. 마크다운 문법 문자는 이스케이프하지 않는다 — 읽는 쪽(`Markdown`)이
 * 안전하게 그리고, 이스케이프하면 붙여 넣은 곳에서 `\*`가 보인다. 줄바꿈은 접어 한 줄로 둔다.
 */
export function toMarkdown(data: ReportData, include: Include = DEFAULT_INCLUDE): string {
  const view = projectReport(data)
  const out: string[] = [`# ${reportTitle(data)}`, '']
  const names = data.workspaces.map((w) => w.name).join(', ')
  if (names) out.push(names, '')
  out.push(totalsLine(view.totals, include), '')

  for (const ws of view.workspaces) {
    const sections: string[][] = []
    if (include.issues) {
      for (const { id, label } of BUCKETS) {
        const lines = ws.buckets[id]
        if (lines.length === 0) continue
        const body = [`### ${label}`]
        for (const line of lines) {
          body.push(`- ${oneLine(line.issue.title)} — ${dayLabel(line.at)}`)
          if (!include.conversations) continue
          for (const conv of line.conversations) {
            body.push(`  - 대화: ${conversationText(conv)}`, ...answerLine(conv, '  ', include))
          }
        }
        sections.push(body)
      }
    }
    if (include.conversations) {
      // 이슈를 담지 않으면 이슈에 붙던 대화도 여기 모인다 — 대화를 고른 사람에게서 대화가 사라지면 안 된다
      const loose = include.issues
        ? ws.loose
        : [...ws.loose, ...Object.values(ws.buckets).flat().flatMap((l) => l.conversations)]
      if (loose.length > 0) {
        const body = [include.issues ? '### 이슈 없는 대화' : '### 대화']
        for (const conv of loose) {
          // 이 묶음의 대화는 이슈 줄 밑에 있지 않다 — 할당된 이슈가 있으면 곁글로 이름을 단다(FR-8)
          const side = conv.conversation.issueTitle ? ` (이슈: ${oneLine(conv.conversation.issueTitle)})` : ''
          body.push(`- ${conversationText(conv)}${side}`, ...answerLine(conv, '', include))
        }
        sections.push(body)
      }
    }
    if (include.memos && ws.memos.length > 0) {
      sections.push(['### 메모', ...ws.memos.map((m) => `- ${oneLine(m.title)} — ${dayLabel(m.updatedAt)}`)])
    }
    if (sections.length === 0) continue
    out.push(`## ${ws.name}`, '', totalsLine(ws.totals, include), '')
    for (const s of sections) out.push(...s, '')
  }

  out.push(`_${STATE_NOTE}_`)
  return out.join('\n') + '\n'
}
