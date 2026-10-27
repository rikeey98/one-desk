import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/channels'
import type { Core } from '@core/index'
import type { AcceptIssueProposal } from '@shared/models'

/** agent의 제안 (docs/sdlc/agent-proposals/ FR-20). 핸들러는 core 호출 한 줄이다 */
export function registerProposalHandlers(core: Core) {
  ipcMain.handle(CHANNELS.proposalsPending, (_e, workspaceId: string) => core.proposals.pending(workspaceId))
  ipcMain.handle(
    CHANNELS.proposalsAccept,
    (_e, id: string, choice: AcceptIssueProposal) => core.proposals.accept(id, choice)
  )
  ipcMain.handle(CHANNELS.proposalsDecline, (_e, id: string) => core.proposals.decline(id))
}
