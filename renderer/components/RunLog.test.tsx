import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RunLog } from './RunLog'
import type { RunEvent } from '@shared/events'

function text(seq: number, body: string): RunEvent {
  return { type: 'text', runId: 'r1', seq, at: 0, text: body }
}

function result(seq: number, body: string, needsAnswer = false): RunEvent {
  return {
    type: 'result', runId: 'r1', seq, at: 0,
    status: 'succeeded', resultText: body, sessionId: 's', needsAnswer
  }
}

describe('RunLog', () => {
  it('result가 직전 텍스트와 같으면 본문을 반복하지 않는다', () => {
    // Claude Code는 마지막 assistant 메시지를 text로 흘린 뒤 result에 같은 내용을 다시 담는다.
    render(<RunLog events={[text(0, '작업을 마쳤습니다.'), result(1, '작업을 마쳤습니다.')]} />)
    expect(screen.getAllByText('작업을 마쳤습니다.')).toHaveLength(1)
    expect(screen.getByText('완료')).toBeInTheDocument()
  })

  it('result에만 있는 내용이면 보여준다', () => {
    render(<RunLog events={[text(0, '중간 보고'), result(1, '최종 결과는 다릅니다')]} />)
    expect(screen.getByText('중간 보고')).toBeInTheDocument()
    expect(screen.getByText('최종 결과는 다릅니다')).toBeInTheDocument()
  })

  it('공백 차이만 있어도 같은 내용으로 본다', () => {
    render(<RunLog events={[text(0, '  같은 말  '), result(1, '같은 말')]} />)
    expect(screen.getAllByText(/같은 말/)).toHaveLength(1)
  })

  it('답변을 기다리며 끝난 run은 그렇게 표시한다', () => {
    render(<RunLog events={[text(0, '어느 쪽인가요?'), result(1, '어느 쪽인가요?', true)]} />)
    expect(screen.getByText('답변 필요')).toBeInTheDocument()
  })

  it('이벤트가 없으면 안내를 보여준다', () => {
    render(<RunLog events={[]} />)
    expect(screen.getByText('아직 출력이 없습니다')).toBeInTheDocument()
  })
})
