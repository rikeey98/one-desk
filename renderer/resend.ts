import type { ResumeRunInput, Run } from '@shared/models'

/**
 * 다시 보내기의 입력 (`docs/sdlc/conversation-timeline/` spec FR-43) — 그 턴의 지시·맥락·조건 **그대로** 같은 대화에 새 턴을
 * 잇는다. 대화록의 `다시 보내기`(ConversationPanel)와 홈의 할 일 줄(App)이 같은 함수를 쓴다(`docs/sdlc/home/` FR-9) —
 * 따로 적으면 파일 맥락을 거르는 규칙이 한쪽에서 빠진다.
 *
 * 파일은 빼고 보낸다 — 원문 지시문의 `@`가 다시 가져오고, 요청으로 오면 core가 거부한다(input-triggers FR-9·FR-18).
 * 맥락은 id만 보낸다: 이름은 core가 읽는 시점에 다시 붙이고, 지워진 항목은 core가 이미 뺐다.
 */
export function resendInput(conversationId: string, run: Run): ResumeRunInput {
  return {
    conversationId,
    userPrompt: run.userPrompt,
    context: run.contextItems.filter((item) => item.type !== 'file').map(({ type, id }) => ({ type, id })),
    model: run.model,
    effort: run.effort,
    permission: run.permission
  }
}
