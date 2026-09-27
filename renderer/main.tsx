import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClientProvider } from './client/ClientProvider'
import { RunEventProvider } from './store/RunEventContext'
import { createRunEventStore } from './store/runEvents'
import { DraftProvider } from './store/DraftContext'
import { createDraftStore } from './store/drafts'
import App from './App'

// window.oneDesk를 참조하는 곳은 이 파일 하나뿐이어야 한다 (설계 §4 규칙 2).
// 스토어는 여기서 한 번 만들어 Context로 내려보낸다.
const store = createRunEventStore()
window.oneDesk.events.onRunEvent((event) => store.push(event))
// 대화마다 쓰던 지시 (docs/sdlc/conversation-timeline/ spec FR-31). 도크는 인박스·설정에 가면
// 언마운트되므로 그 아래에 두면 사라진다 — 이벤트 스토어와 같은 자리에 하나 둔다. 이 한 줄은
// 단위 테스트가 못 잡는다(각 테스트가 제 Provider를 세운다) — e2e의 인박스 왕복이 맡는다.
const drafts = createDraftStore()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClientProvider client={window.oneDesk}>
      <RunEventProvider store={store}>
        <DraftProvider store={drafts}>
          <App />
        </DraftProvider>
      </RunEventProvider>
    </ClientProvider>
  </StrictMode>
)
