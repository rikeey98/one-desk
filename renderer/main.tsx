import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClientProvider } from './client/ClientProvider'
import { RunEventProvider } from './store/RunEventContext'
import { createRunEventStore } from './store/runEvents'
import { DraftProvider } from './store/DraftContext'
import { createDraftStore } from './store/drafts'
import { PendingSavesProvider } from './store/PendingSavesContext'
import { createPendingSaves, guardUnload } from './store/pendingSaves'
import { CodeBufferProvider } from './store/CodeBufferContext'
import { createCodeBufferStore } from './store/codeBuffers'
import { createCloseGuard } from './store/closeGuard'
import { isPanelHash, parsePanelHash } from '@shared/panelWindow'
import { PanelWindow } from './components/PanelWindow'
import App from './App'

// window.oneDesk를 참조하는 곳은 이 파일 하나뿐이어야 한다 (설계 §4 규칙 2).
// 스토어는 여기서 한 번 만들어 Context로 내려보낸다.

// 이 창에서 아직 끝나지 않은 저장 (docs/sdlc/item-windows/ FR-15·16a). 창을 닫는 것은 React 언마운트가
// 아니라서, 대기 중인 저장이 있으면 닫기를 한 번 미루고 흘려보낸 뒤 스스로 닫는다. 앱 창·패널 창이 같다 —
// 앱 창은 그 위에 코드 칸의 고친 글을 묻는 판정이 한 겹 더 있다(아래 `createCloseGuard`).
// 이 줄들은 단위 테스트가 못 잡는다 — e2e의 "닫기 직전에 친 글자가 남는다"·코드 칸의 닫기 확인이 맡는다.
const saves = createPendingSaves()

const root = createRoot(document.getElementById('root')!)

// 패널 창이면 해시가 범위를 말한다 (FR-13). 모양이 틀린 패널 해시도 앱 창을 그리지 않는다 — 앱 창이 둘이 된다.
if (isPanelHash(window.location.hash)) {
  window.addEventListener('beforeunload', guardUnload(saves, () => window.close()))
  root.render(
    <StrictMode>
      <ClientProvider client={window.oneDesk}>
        <PendingSavesProvider saves={saves}>
          <PanelWindow scope={parsePanelHash(window.location.hash)} />
        </PendingSavesProvider>
      </ClientProvider>
    </StrictMode>
  )
} else {
  const store = createRunEventStore()
  window.oneDesk.events.onRunEvent((event) => store.push(event))
  // 대화마다 쓰던 지시 (docs/sdlc/conversation-timeline/ spec FR-31). 도크는 인박스·설정에 가면
  // 언마운트되므로 그 아래에 두면 사라진다 — 이벤트 스토어와 같은 자리에 하나 둔다. 이 한 줄은
  // 단위 테스트가 못 잡는다(각 테스트가 제 Provider를 세운다) — e2e의 인박스 왕복이 맡는다.
  const drafts = createDraftStore()
  // 코드 칸의 연 파일·고친 글 (docs/sdlc/code-editor/ FR-20) — 초안과 같은 이유로 도크 밖에 둔다. 닫기 판정은 대기 저장을
  // 먼저 흘려보내고 그다음 고친 글을 묻는다(FR-21). 패널 창에는 코드 칸이 없어 이것이 없다.
  const buffers = createCodeBufferStore()
  const closeGuard = createCloseGuard({
    saves, buffers, close: () => window.close(), save: (input) => window.oneDesk.files.save(input)
  })
  window.addEventListener('beforeunload', closeGuard.onBeforeUnload)

  root.render(
    <StrictMode>
      <ClientProvider client={window.oneDesk}>
        <RunEventProvider store={store}>
          <DraftProvider store={drafts}>
            <PendingSavesProvider saves={saves}>
              <CodeBufferProvider store={buffers} guard={closeGuard}>
                <App />
              </CodeBufferProvider>
            </PendingSavesProvider>
          </DraftProvider>
        </RunEventProvider>
      </ClientProvider>
    </StrictMode>
  )
}
