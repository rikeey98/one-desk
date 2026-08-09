import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClientProvider } from './client/ClientProvider'
import { RunEventProvider } from './store/RunEventContext'
import { createRunEventStore } from './store/runEvents'
import App from './App'

// window.oneDesk를 참조하는 곳은 이 파일 하나뿐이어야 한다 (설계 §4 규칙 2).
// 스토어는 여기서 한 번 만들어 Context로 내려보낸다.
const store = createRunEventStore()
window.oneDesk.events.onRunEvent((event) => store.push(event))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClientProvider client={window.oneDesk}>
      <RunEventProvider store={store}>
        <App />
      </RunEventProvider>
    </ClientProvider>
  </StrictMode>
)
