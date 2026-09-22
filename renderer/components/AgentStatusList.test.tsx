import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentStatusList } from './AgentStatusList'
import type { AgentProbe, AgentProbes, AgentStatuses } from '@shared/models'

function statuses(over: Partial<AgentStatuses> = {}): AgentStatuses {
  return {
    'claude-code': { ok: true, executable: 'C:\\bin\\claude.exe' },
    opencode: { ok: true, executable: 'C:\\bin\\opencode.exe' },
    ...over
  }
}

function probe(over: Partial<AgentProbe> = {}): AgentProbe {
  return {
    auth: { state: 'ok', method: 'claude.ai', plan: 'max' },
    model: { state: 'resolved', model: 'claude-opus-5[1m]' },
    version: '2.1.278',
    models: [],
    ...over
  }
}

function probes(over: Partial<AgentProbes> = {}): AgentProbes {
  return { 'claude-code': probe(), opencode: probe(), ...over }
}

function renderList(over: Partial<Parameters<typeof AgentStatusList>[0]> = {}) {
  const onRefresh = vi.fn()
  render(
    <AgentStatusList
      statuses={statuses()}
      probes={probes()}
      busy={false}
      onRefresh={onRefresh}
      {...over}
    />
  )
  return { onRefresh }
}

/** 한 agent 줄의 텍스트 전부 */
function rowText(name: string): string {
  const row = screen.getAllByRole('listitem').find((li) => li.textContent?.includes(name))
  return row?.textContent ?? ''
}

describe('AgentStatusList — 빠른 칸이 먼저 그려진다 (FR-7)', () => {
  it('느린 칸이 아직 안 와도 실행 파일 줄은 이미 보인다', () => {
    // 합쳐 기다리면 workspace를 고를 때마다 이 블록이 통째로 1초씩 비어 있다.
    renderList({ probes: null })
    expect(screen.getByText('C:\\bin\\claude.exe')).toBeInTheDocument()
  })

  it('둘 다 없으면 아직 확인하지 않았다고 말한다', () => {
    renderList({ statuses: null, probes: null })
    expect(rowText('Claude Code')).toContain('아직 확인하지 않았습니다')
  })

  it('다시 확인 버튼이 콜백을 부른다', () => {
    const { onRefresh } = renderList()
    screen.getByRole('button', { name: '다시 확인' }).click()
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('조회 중에는 버튼이 잠긴다', () => {
    renderList({ busy: true })
    expect(screen.getByRole('button', { name: '확인 중…' })).toBeDisabled()
  })
})

describe('AgentStatusList — 세 상태가 서로 다른 말이다 (FR-3)', () => {
  it('로그인 안 됨과 인증 확인 불가가 다른 문구다', () => {
    // **이것이 FR-3의 전부다.** 조회 실패를 "로그인 안 됨"으로 적으면 멀쩡히
    // 돌아가는 설치본에 거짓말을 하게 된다.
    const { unmount } = render(
      <AgentStatusList
        statuses={statuses()} busy={false} onRefresh={() => {}}
        probes={probes({
          'claude-code': probe({ auth: { state: 'none', hint: '`claude auth login`으로 로그인하세요.' } })
        })}
      />
    )
    const none = rowText('Claude Code')
    unmount()

    render(
      <AgentStatusList
        statuses={statuses()} busy={false} onRefresh={() => {}}
        probes={probes({
          'claude-code': probe({ auth: { state: 'unknown', reason: '서브커맨드가 없습니다' } })
        })}
      />
    )
    const unknown = rowText('Claude Code')

    expect(none).toContain('로그인 필요')
    expect(unknown).toContain('인증 확인 불가')
    expect(none).not.toBe(unknown)
  })

  it('자격 증명 0개인 OpenCode는 초록이 아니다', () => {
    // **이 작업이 고치려던 증상 그 자체다.** 실행 파일은 있는데 자격 증명이
    // 없어 아무 모델로도 못 도는 상태가 지금은 초록으로 지나간다.
    render(
      <AgentStatusList
        statuses={statuses()} busy={false} onRefresh={() => {}}
        probes={probes({
          opencode: probe({
            auth: { state: 'none', hint: '`opencode auth login`으로 provider에 로그인하세요.' },
            model: { state: 'skipped', reason: 'OpenCode는 실제로 쓰인 모델을 알려주지 않습니다.' },
            version: null
          })
        })}
      />
    )

    const row = screen.getAllByRole('listitem').find((li) => li.textContent?.includes('OpenCode'))!
    expect(row.className).not.toContain('settings-status-ok')
    expect(row.textContent).toContain('opencode auth login')
  })

  it('로그인하지 않은 claude는 모델 이름이 있어도 초록이 아니다', () => {
    // init은 인증을 보지 않아 토큰 없이도 모델을 되돌려 준다(2026-09-22 실측).
    // 그 이름을 초록으로 띄우면 아무것도 못 돌리는 사람을 속이게 된다.
    render(
      <AgentStatusList
        statuses={statuses()} busy={false} onRefresh={() => {}}
        probes={probes({
          'claude-code': probe({
            auth: { state: 'none', hint: '`claude auth login`으로 로그인하세요.' },
            model: { state: 'skipped', reason: '로그인한 뒤에 확인합니다.' }
          })
        })}
      />
    )

    const row = screen.getAllByRole('listitem').find((li) => li.textContent?.includes('Claude Code'))!
    expect(row.className).not.toContain('settings-status-ok')
    expect(row.textContent).toContain('로그인 필요')
    expect(row.textContent).not.toContain('claude-opus-5[1m]')
  })

  it('준비된 agent는 모델 이름을 머리에 보여준다', () => {
    renderList()
    expect(rowText('Claude Code')).toContain('claude-opus-5[1m]')
    expect(rowText('Claude Code')).toContain('로그인됨')
    expect(rowText('Claude Code')).toContain('v2.1.278')
  })

  it('실행 파일이 없으면 그 사유만 보여준다', () => {
    render(
      <AgentStatusList
        statuses={statuses({ opencode: { ok: false, reason: 'PATH에서 찾을 수 없습니다' } })}
        probes={probes()} busy={false} onRefresh={() => {}}
      />
    )
    const row = screen.getAllByRole('listitem').find((li) => li.textContent?.includes('OpenCode'))!
    expect(row.textContent).toContain('PATH에서 찾을 수 없습니다')
    expect(row.className).toContain('settings-status-bad')
  })

  it('모델을 건너뛴 것과 못 얻은 것이 다른 문구다', () => {
    render(
      <AgentStatusList
        statuses={statuses()} busy={false} onRefresh={() => {}}
        probes={probes({
          'claude-code': probe({ model: { state: 'skipped', reason: 'repo를 등록하면 확인합니다.' } }),
          opencode: probe({ model: { state: 'unknown', reason: '시간이 초과됐습니다' } })
        })}
      />
    )
    expect(rowText('Claude Code')).toContain('확인하지 않았습니다')
    expect(rowText('OpenCode')).toContain('확인하지 못했습니다')
  })

  it('"이 모델로 돕니다"라고 말하지 않는다', () => {
    const { container } = render(
      <AgentStatusList statuses={statuses()} probes={probes()} busy={false} onRefresh={() => {}} />
    )
    expect(container.textContent).not.toContain('돕니다')
  })

  it('계정 식별 정보를 그리지 않는다', () => {
    // core가 애초에 나르지 않지만(NFR-5), 화면이 우연히 다른 경로로 받아
    // 그리는 일이 없도록 여기서도 고정한다.
    const { container } = render(
      <AgentStatusList statuses={statuses()} probes={probes()} busy={false} onRefresh={() => {}} />
    )
    expect(container.textContent).not.toContain('@')
  })
})
