# Plan: 도크 대화 목록을 repo로 나눈다

- 출처: `spec.md`
- 상태: 구현 완료 (2026-10-07)

## 순서 (각 단계는 테스트 먼저, 회귀 테스트는 대상 줄을 망가뜨려 빨개지는지 본다)

1. **순수 함수** `renderer/conversation.ts` — `repoOfConversation(conv, repos)`(FR-1), `sectionByRepo(conversations, repos)`
   (FR-3·4·5), `filterByRepo`(FR-8). `repoLabel`이 `repoOfConversation`을 쓰게 바꾼다(FR-2). `conversation.test.ts`.
2. **접힘 기억** `renderer/dockSections.ts` — localStorage 읽기/쓰기(try/catch, `listWidth.ts`와 같은 모양).
3. **`ConversationList`** — 구획 머리(`SectionHeader`)·구획 안 줄(메타에서 repo 뺌)·거름 줄. state 없음.
4. **`Dock`** — 접힌 구획 state(마운트 시 저장소에서), 거름 적용(목록·폴백), focus로 연 대화의 구획 펴기, 필수 prop `onClearRepoFilter`.
   `Dock.test`.
5. **App 배선** — `onClearRepoFilter={() => setRepoId(null)}`. `App.test`.
6. **CSS** — 구획 머리·거름 줄(토큰만).
7. **e2e** `e2e/dock-repo.e2e.ts` + 전체 e2e.
8. **캡처** 라이트·다크 → 확인 → 임시 캡처 삭제.
9. **문서** CLAUDE.md(현재 상태 한 단락·함정이 생기면 그 절·문서 표), DESIGN.md(도크 목록).

## 바뀌는 파일

`renderer/conversation.ts`(+test) · `renderer/dockSections.ts`(+test) · `renderer/components/ConversationList.tsx` ·
`renderer/components/Dock.tsx`(+test) · `renderer/App.tsx`(+test) · `renderer/index.css` · `e2e/dock-repo.e2e.ts` · 문서.

## 위험

- `repoLabel`의 판정이 마지막 턴 → 뿌리 턴으로 바뀐다. 대화 중 cwd가 바뀐 옛 데이터가 있다면 줄의 repo 이름이 달라진다 —
  지금 UI로는 만들 수 없는 상태라 받아들인다.
- Dock은 이미 크다 — 판정은 전부 순수 함수로 빼고 Dock에는 state와 배선만 둔다.

## 완료 증명

2026-10-07, Windows 11 · Node 22.

- 순수 함수 테스트(`conversation.test.ts` 넷, `dockSections.test.ts` 둘), Dock 테스트 일곱, App 배선 테스트 하나를 먼저 쓰고 빨간 것을 본 뒤 구현했다.
- 변이 확인(되돌린 뒤 초록): `pathKey`의 Windows 대소문자 정규화를 지움 → FR-1 테스트 빨강. `sectionByRepo`의 "기타 맨 아래"를 지움 →
  구획 순서 테스트 둘 빨강. focus로 연 대화의 구획 펴기를 무력화 → FR-7 테스트 빨강. App의 `onClearRepoFilter`를 빈 함수로 →
  배선 테스트 빨강.
- `e2e/dock-repo.e2e.ts` 통과 — 사이드바 repo로 고른 cwd에서 실제로 돈 대화가 그 구획에 든다.
- 캡처(라이트·다크·접힘·거름)에서 고친 것: 구획 머리의 대문자 변환이 repo 이름(`api` → `API`)을 바꿔 다른 이름처럼 읽혀 뺐다(spec NFR-2).
- 계획과 달라진 것: Dock 테스트의 "폴백은 거른 목록에서 고른다"는 쓰지 않았다 — 도크의 기본 보기가 새 대화 칸이라 폴백이 화면에
  드러나는 경로를 단위 테스트로 결정적으로 만들 수 없었다(검증하지 못한 것으로 남긴다).
