import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TimelineBlocks } from '../TimelineBlocks'
import { CodePaneContext, type CodePaneOpener } from './CodePaneContext'
import type { EditFile, TimelineBlock } from '../../timeline'

function file(over: Partial<EditFile>): EditFile {
  return {
    path: '/tmp/api/src/auth.ts', displayPath: 'src/auth.ts', created: false, added: 1, removed: 1,
    hunks: [{ lines: [{ sign: '+', text: 'x', newNo: 12 }], oldStart: 10, newStart: 12, gapBefore: 9 }],
    truncated: 0, ids: ['t1'], numbered: true, operation: 'edit', before: null, ...over
  }
}

function renderBlocks(files: EditFile[], opener: CodePaneOpener | null) {
  const blocks: TimelineBlock[] = [{ kind: 'edit', key: 'e1', files, running: false }]
  return render(
    <CodePaneContext.Provider value={opener}>
      <TimelineBlocks blocks={blocks} openKeys={new Set()} onToggle={vi.fn()} agentKind="claude-code" />
    </CodePaneContext.Provider>
  )
}

describe('대화록 편집 줄의 코드 칸에서 열기 (docs/sdlc/code-editor/ FR-23)', () => {
  it('칸의 repo 안 경로면 버튼이 서고, 누르면 repo 상대 경로와 첫 hunk 줄로 연다', async () => {
    const open = vi.fn()
    renderBlocks([file({})], { repoPath: '/tmp/api', open })

    const button = screen.getByRole('button', { name: '코드 칸에서 열기' })
    // 이름에는 경로가 없다(파일 줄을 경로로 잡는 셀렉터와 부딪히지 않게) — 어느 파일인지는 설명이 말한다
    expect(button).toHaveAccessibleDescription('src/auth.ts')
    await userEvent.click(button)

    expect(open).toHaveBeenCalledWith('src/auth.ts', 12)
  })

  it('줄 번호가 없는 편집(입력으로 만든 diff)은 첫 줄로 연다', async () => {
    const open = vi.fn()
    renderBlocks([file({ hunks: [{ lines: [{ sign: '+', text: 'x' }] }], numbered: false })], { repoPath: '/tmp/api', open })
    await userEvent.click(screen.getByRole('button', { name: '코드 칸에서 열기' }))
    expect(open).toHaveBeenCalledWith('src/auth.ts', 1)
  })

  it('diff 없는 편집 줄에도 선다', () => {
    renderBlocks([file({ hunks: [], added: 0, removed: null })], { repoPath: '/tmp/api', open: vi.fn() })
    expect(screen.getByRole('button', { name: '코드 칸에서 열기' })).toHaveAccessibleDescription('src/auth.ts')
  })

  it('repo 밖 경로면 버튼이 없다', () => {
    renderBlocks([file({ path: '/etc/hosts', displayPath: '/etc/hosts' })], { repoPath: '/tmp/api', open: vi.fn() })
    expect(screen.queryByRole('button', { name: '코드 칸에서 열기' })).not.toBeInTheDocument()
  })

  it('도크 밖(컨텍스트 없음)이면 버튼이 없다', () => {
    renderBlocks([file({})], null)
    expect(screen.queryByRole('button', { name: '코드 칸에서 열기' })).not.toBeInTheDocument()
  })
})
