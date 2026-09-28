# Plan: 입력칸에서 ↑로 이전 지시 불러오기

- 출처: `intent.md`, `spec.md` (같은 디렉토리)
- 작성자: 권용현 (초안: Claude)
- 상태: 구현 완료 (2026-09-28, 승인 2026-09-28)

## 변경되는 파일

| 파일 | 신규/수정 | 변경 |
| --- | --- | --- |
| `renderer/promptHistory.ts` | 신규 | `historyOf(conversation: Conversation \| null): string[]` (FR-1). `stepHistory({ entries, index, text }, direction): { index, text } \| null` — `index`는 -1(불러오지 않음)부터, `null`이면 "기본 동작에 맡긴다"(FR-2의 4·FR-3) |
| `renderer/promptHistory.test.ts` | 신규 | 아래 테스트 1~8 |
| `renderer/components/RunPanel.tsx` | 수정 | `historyIndex` state(-1). `onPromptKeyDown`에서 피커 분기 **뒤**, 수식키 없는 ↑↓면 `stepHistory` → 결과가 있으면 `preventDefault`·`setPrompt`·초안 스토어 쓰기·캐럿을 끝으로(`useLayoutEffect` 또는 `requestAnimationFrame`)·`setDismissed(true)`(FR-6). 입력(onChange)이 오면 `historyIndex = -1`. 전송 성공 시에도 -1 |
| `renderer/components/RunPanel.test.tsx` | 수정 | 아래 테스트 9~12 |
| `e2e/composer.e2e.ts` | 수정 | 한 턴을 보낸 뒤 빈 입력칸에서 ↑ → 방금 보낸 지시가 입력칸에 보이고 ↓ → 비어 있다 |
| `docs/backlog.md` | 수정 | §3 제거 |
| `CLAUDE.md` | 수정 | 대화 화면 절에 한 문단(규칙은 `promptHistory.ts`, 비었을 때만, 이 대화만), 문서 표에 행 |

## 테스트 (실패를 먼저 본다)

`promptHistory.test.ts`
1. 최근 것부터, 이웃한 중복은 하나로, 공백뿐인 지시는 빠진다. 대화가 null이면 빈 목록.
2. 예약(뿌리가 아닌 pending)의 지시도 들어간다.
3. 빈 입력에서 ↑ → 가장 최근 지시(index 0).
4. 불러온 글 그대로에서 ↑ → 그다음 오래된 것. 가장 오래된 것에서 ↑ → 제자리(`{ index 그대로 }`).
5. 가장 최근 것에서 ↓ → 빈 글(index -1). 빈 입력에서 ↓ → null.
6. 불러온 글을 고친 뒤(`text !== entries[index]`)의 ↑ → null.
7. 쓰던 글이 있을 때(index -1, 비지 않음) ↑ → null.
8. history가 비었으면 ↑ → null.

`RunPanel.test.tsx`
9. 이어 가는 대화에서 빈 입력칸 ↑ → 마지막 지시가 입력칸에, ↓ → 빈 칸.
10. 쓰던 글이 있으면 ↑가 입력칸을 바꾸지 않는다.
11. `/`로 시작하는 지시를 불러와도 피커(`listbox`)가 열리지 않고 다음 ↑가 더 오래된 지시로 간다.
12. 피커가 열려 있으면 ↑는 피커 선택을 옮기고 입력칸은 그대로다(기존 동작 보존).

**변이 확인:** `RunPanel`의 `setDismissed(true)`를 빼면 11이, 수식키 조건을 빼면(Shift+↑가 넘기기로)
추가하는 경계 테스트가, "손대지 않은 글" 비교를 빼면 6·10이 빨개지는지 본다.

## 완료 증명

`pnpm test`, `pnpm typecheck`, `pnpm lint`, 경계 grep 둘, `pnpm test:e2e -- composer`.
