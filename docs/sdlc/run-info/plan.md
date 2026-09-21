# Plan: 대화에 실행 정보 표시 — 모델·사용량·컨텍스트

- 출처: `intent.md`, `spec.md` (2026-09-21 승인)
- 작성자: 권용현
- 상태: 구현 완료 (2026-09-21)
- 작성일: 2026-09-21

## 0. 먼저 못박는 것 — 병합 규칙 (spec §3-3의 정밀화)

spec은 "나중 것이 앞의 것을 덮되 null은 덮지 않는다"와 "OpenCode는 manager가 누적한다"를
따로 적었다. 구현에는 **필드마다 규칙이 다르다**는 사실을 정확히 적어야 한다.

| 필드 | 병합 | 왜 |
| --- | --- | --- |
| `inputTokens`·`outputTokens`·`cacheReadTokens`·`cacheWriteTokens`·`reasoningTokens`·`costUsd` | **더한다** | opencode는 스텝마다 오고, claude는 턴에 한 번 온다. 하나를 더하면 그 하나가 된다 — **한 규칙이 두 CLI를 모두 맞춘다** |
| `model`·`contextTokens`·`contextWindow` | **마지막 non-null이 이긴다** | 합이 아니라 상태다. claude의 `model`은 `init`에서, 수치는 `result`에서 따로 온다. `contextTokens`는 마지막 요청의 크기이므로 덮어쓰는 것이 곧 정답이다 |

이 한 표 덕분에 **어댑터는 누적을 모른다.** claude 어댑터는 `init`에서 모델만 담은
`usage`를 내고 `result`에서 수치를 담은 `usage`를 낸다. opencode 어댑터는 `step_finish`마다
그 스텝의 수치를 낸다. 누적은 전적으로 manager 몫이다 — `parseLine`이 앞 줄을 기억하지
못한다는 기존 제약(설계 §7)을 그대로 지킨다.

**spec §3-3에 이 표를 반영한다**(1단계). 설계를 바꾸는 것이 아니라 같은 결정을 실행 가능한
문장으로 적는 것이다.

## 변경되는 파일

전부 읽고 확인했다.

| 파일 | 신규/수정 | 변경 내용 |
| --- | --- | --- |
| `docs/sdlc/run-info/spec.md` | 수정 | §3-3에 위 병합 표를 넣는다 |
| `shared/events.ts` | 수정 | `RunUsage` 인터페이스(9필드 전부 nullable) + `RunEvent`에 `{ type: 'usage'; usage: RunUsage }` |
| `shared/models.ts` | 수정 | `Run`에 `usage: RunUsage | null`. `RunUsage`는 `@shared/events`에서 re-export하지 않고 그대로 import한다 |
| `core/runner/adapters/claudeCode.ts` | 수정 | `system/init`에서 `model`만 담은 `usage` 추가 발행. `result`에서 `usage`·`modelUsage`를 읽어 `usage` 발행. `rate_limit_event`는 **건드리지 않는다**(spec §7) |
| `core/runner/adapters/claudeCode.parse.test.ts` | 수정 | init의 모델, result의 수치, `iterations` 마지막으로 `contextTokens`, `iterations` 없을 때 폴백, `modelUsage`에서 `contextWindow`, 필드가 없는 옛 스트림이면 `usage`를 내지 않음 |
| `core/runner/adapters/opencode.ts` | 수정 | `step_finish`를 `default`에서 꺼내 `usage` 발행(그 스텝 수치 + `contextTokens`). "토큰·비용은 아직 쓰는 곳이 없다" 주석 교체 |
| `core/runner/adapters/opencode.parse.test.ts` | 수정 | `step_finish` 한 줄 → `usage` 하나, `contextTokens = input + cache.read + cache.write`, `contextWindow`는 null |
| `core/runner/adapters/fixtures/claude-stream.jsonl` | 수정 | 실측(2.1.278)에서 뜬 `usage`·`modelUsage`를 가진 `result` 줄로 갱신 |
| `core/runner/manager.ts` | 수정 | `emit`에 `usage` 누적(§0의 표). `RunOutcome`에 `usage: RunUsage | null` |
| `core/runner/manager.test.ts` | 수정 | 합계 필드는 더해지고 상태 필드는 마지막이 이기는 것, `usage` 이벤트가 없으면 `outcome.usage`가 null |
| `core/db/schema.ts` | 수정 | `run`에 컬럼 아홉 (spec §4). 전부 nullable, 기본값 없음 |
| `drizzle/0006_*.sql` | 신규 | `pnpm db:generate`가 만든다. **`ALTER TABLE ... ADD COLUMN` 아홉 줄인지 눈으로 확인한다** |
| `core/db/repositories/run.ts` | 수정 | `FinishRunInput`에 `usage` 추가 → `markFinished`가 컬럼으로 펼친다. `hydrate`가 아홉 컬럼을 `usage` 하나로 접는다(아래 함정) |
| `core/db/repositories/run.test.ts` | 수정 | `markFinished`가 넣은 값이 `get()`에서 `usage`로 돌아오고, 아홉 컬럼이 `Run`에 **낱개로 새지 않는다**. 전부 NULL이면 `usage`는 null |
| `core/execution.ts` | 수정 | `finish(runId, { …, usage: outcome.usage })` 한 줄 |
| `core/index.test.ts` | 수정 | 그 배선 한 줄을 잡는 테스트(아래 리스크 — Windows에서 가짜 CLI가 안 떠도 성립해야 한다) |
| `renderer/usage.ts` | **신규** | 순수 포맷 함수 — `formatTokens(n)`, `formatPercent(used, window)`, `usageLine(run)`이 화면 조각 배열을 만든다. 컴포넌트에서 분리해야 표기 규칙(spec §5-2)을 단독으로 고정할 수 있다 |
| `renderer/usage.test.ts` | **신규** | 표기 규칙 테스트 — `999`→`999`, `1234`→`1.2k`, `1234567`→`1.2M`, `0.4%`→`<1%`, 창 모르면 퍼센트 없음, 조각 생략 |
| `renderer/components/Transcript.tsx` | 수정 | `.turn-user` 다음에 `.turn-info` 한 줄. `pending`에는 없다 |
| `renderer/components/Transcript.test.tsx` | 수정 | 줄이 보임·조각 생략·`usage`가 null이면 줄 없음·버튼 없음·`title`에 캐시와 비용 |
| `renderer/index.css` | 수정 | `.turn-info`·`.turn-info > span` 두 규칙(구분점은 `::before`). `.applied-chip`처럼 `cursor: default` |
| `core/runner/fixtures/fake-claude.mjs` | 수정 | `init`에 `model`, `result`에 `usage`·`modelUsage`를 실어 e2e가 실제 값을 본다 |
| `core/runner/fixtures/fake-opencode.mjs` | 수정 | `step_finish`에 `tokens`·`cost`를 실어 보낸다 |
| `e2e/conversation.e2e.ts` | 수정 | 1턴 뒤 `.turn-info`에 모델과 토큰이 보인다 |
| `docs/superpowers/specs/2026-09-06-opencode-adapter-design.md` | 수정 | §6-2의 "무료 모델로 뜬다. 비용이 들지 않는다"에 2026-09-21 실측(403 FreeTierError)을 덧붙인다. **사실이 아닌 문장을 남겨두지 않는다** |
| `CLAUDE.md` | 수정 | 문서 표에 `docs/sdlc/run-info/` 행. "밟으면 조용히 깨지는 것들"에 `hydrate` 함정 한 문단 |

**건드리지 않는 것과 그 이유**

- `electron/ipc/runs.ts`·`electron/preload.ts` — `Run`을 그대로 나른다. `usage`가 `Run`에
  실리므로 배선이 저절로 따라온다(맥락 표시 작업과 같은 구조).
- `core/runner/adapters/*.command.test.ts` — **CLI 인자가 바뀌지 않는다.** effort가 범위
  밖이라 새 플래그가 없다(spec §1).
- `RunLog`·`TurnLog` — `usage` 이벤트는 로그에 남지만 화면에 그리지 않는다. 한 줄은 DB에서
  읽는다(FR-7). 로그 뷰어가 모르는 `type`을 어떻게 다루는지는 3단계에서 확인만 한다.
- 인박스·도크 탭 — 누계는 이번 범위 밖(spec §1).

## 작업 순서

TDD다. 빨간 것을 먼저 보고 초록으로 만든다. 렌더러 테스트는 **Node 22**에서 돌린다.

1. **spec §3-3에 병합 표를 넣는다**(§0). 코드보다 먼저다 — 구현 중에 규칙이 흔들리면
   무엇이 맞는지 돌아볼 곳이 필요하다. **완료 확인**: `git diff docs/sdlc/run-info/spec.md`에
   표 하나만.
2. `shared/events.ts`에 `RunUsage`와 `usage` 이벤트를 더한다 — **완료 확인**:
   `pnpm typecheck` 통과(순수 추가라 아무것도 안 깨진다). `RunEventInit`의 `OmitSeq`가
   새 멤버에도 분배되는지 눈으로 확인(유니온 분배는 이미 주석이 경고하는 자리다).
3. `claudeCode.parse.test.ts`에 실패하는 테스트 여섯을 넣는다 — (a) `system/init`이
   `usage.model = 'claude-opus-5[1m]'` 하나를 더 낸다, (b) `result`가 수치를 담은 `usage`를
   낸다, (c) `contextTokens`는 `iterations`의 **마지막** 원소로 계산된다(원소 둘을 주고
   앞의 것이 아님을 본다), (d) `iterations`가 없으면 최상위 값으로 폴백한다,
   (e) `contextWindow`는 `modelUsage`의 값이다, (f) `usage`가 아예 없는 옛 `result` 줄은
   `usage` 이벤트를 내지 않는다(빈 객체를 내지 않는다) — **완료 확인**: 여섯 빨강.
4. `claudeCode.ts`를 고친다 — **완료 확인**: 3의 여섯 초록, 파일 전체 초록.
   **`rate_limit_event`가 여전히 `default`로 빠지는 것을 테스트로 고정한다**(spec §7) —
   그 줄을 주면 이벤트가 하나도 나오지 않아야 한다.
5. `opencode.parse.test.ts`에 테스트 셋 → `opencode.ts` 구현 — `step_finish` 한 줄이
   `usage` 하나가 되고, `contextTokens = input + cache.read + cache.write`,
   `contextWindow`는 null, `model`도 null — **완료 확인**: 셋 초록, 기존 파싱 테스트 그대로
   초록(`step_finish`가 `default`에서 빠져나와도 다른 `type`은 영향 없다).
6. `manager.test.ts`에 병합 테스트 넷 → `manager.ts` 구현 — 합계 필드 누적, 상태 필드
   마지막 우선, `usage` 없으면 `outcome.usage`가 null, **null이 앞의 값을 덮지 않는다** —
   **완료 확인**: 넷 초록. **변이**: 합계를 "마지막이 이긴다"로 바꾸면 누적 테스트가
   빨개지고, 상태를 "더한다"로 바꾸면 모델 테스트가 빨개진다. 둘 다 보고 되돌린다.
7. `schema.ts`에 컬럼 아홉 + `pnpm db:generate` — **완료 확인**: `drizzle/0006_*.sql`이
   `ALTER TABLE ... ADD COLUMN` 아홉 줄이고 `DROP`·`CREATE TABLE`이 **없다**(spec NFR-4,
   맥락 기록을 태우는 함정). meta 스냅샷도 함께 커밋한다.
8. `run.test.ts`에 저장·복원 테스트 → `run.ts` 구현 — `FinishRunInput.usage`를 컬럼으로
   펼치고 `hydrate`가 되접는다. **`hydrate`는 `{ ...r }`로 흘려보내면 안 된다**(아래 리스크).
   전부 NULL이면 `usage`는 `null`이다 — **완료 확인**: 테스트 초록 + `Object.keys(get(id))`에
   `inputTokens` 같은 낱개 컬럼이 **없다**는 단언이 함께 초록.
9. `core/execution.ts`의 `finish(...)`에 `usage: outcome.usage` 한 줄 — **완료 확인**:
   `core/index.test.ts`에 그 배선을 잡는 테스트를 먼저 넣고 빨간 것을 본다. Windows에서는
   가짜 CLI가 안 떠 run이 곧바로 `failed`가 되므로(`CLAUDE.md`), **`RunManager`를 스텁으로
   갈아끼워 `usage`를 담은 `RunOutcome`을 돌려주는 방식**으로 쓴다 — 그래야 두 OS에서
   같은 것을 본다. **변이**: 그 한 줄을 지우면 빨개지는지 확인한다.
10. `renderer/usage.test.ts` → `renderer/usage.ts` — spec §5-2의 표기 규칙 전부.
    **완료 확인**: 경계값(999/1000/1,000,000/0.4%/0%)이 테스트에 있다.
11. `Transcript.test.tsx` → `Transcript.tsx` + `index.css` — **완료 확인**: 줄이 보이고,
    조각이 빠지고, `usage`가 null이면 줄이 없고, `within(row).queryAllByRole('button')`이
    비었다. **짧은 라벨 함정**: `.turn-info` 안의 텍스트가 기존 e2e의 `getByText`·`getByRole`
    선택자와 겹치지 않는지 11단계 뒤 `pnpm test:e2e`로 확인한다(전례가 둘 있다).
12. 가짜 CLI 둘에 값 싣기 + `e2e/conversation.e2e.ts` 단언 — 1턴 뒤 `.turn-info`에 모델과
    토큰이 보인다 — **완료 확인**: `pnpm test:e2e` 통과.
13. 문서 셋 — `CLAUDE.md` 문서 표 + `hydrate` 함정, opencode 설계 §6-2의 무료 티어 정정 —
    **완료 확인**: `git diff`에 그 셋만.
14. 전체 검증 — `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm test:e2e` ·
    NFR-2 grep — **완료 확인**: 넷 다 초록, grep 무출력.
15. 커밋 하나 — `feat(runs): show model, token usage and context fill per turn`.

## 리스크

| 리스크 | 영향 | 완화 방법 |
| --- | --- | --- |
| **`hydrate`의 `{ ...r, contextItems }`가 새 컬럼 아홉을 그대로 흘려보낸다** | `Run`에 `usage`와 낱개 컬럼이 **둘 다** 실려 IPC로 나간다. 타입 오류가 안 난다 — 스프레드는 초과 속성 검사를 받지 않는다. 조용히 중복 전송되고, 나중에 누가 `run.inputTokens`를 쓰기 시작하면 두 출처가 갈린다 | 8단계에서 구조 분해로 아홉을 빼내고 `usage`만 실는다. **`Object.keys`에 낱개 컬럼이 없다는 단언**을 테스트에 넣는다. `CLAUDE.md`에도 적는다 |
| 합계와 점유를 한 규칙으로 병합해 버린다 | 도구를 쓰는 턴에서 컨텍스트가 100%를 넘거나, 모델 이름이 사라진다 | §0의 표를 spec에 먼저 박고(1단계), 6단계에서 양방향 변이를 둘 다 빨갛게 본다 |
| claude의 `iterations`가 없는 버전 | `contextTokens`가 과대평가돼 100%를 넘는다 | 폴백을 3(d)에서 고정하고, 표시 쪽은 `>99%`로 자른다(spec §8) |
| OpenCode `tokens.input`의 의미가 우리 해석과 다르다 | 토큰 수 과대계상 | spec §8에서 열어 둔 채 승인됨. 창 크기를 모르므로 **비율은 안 그린다** — 거짓 게이지는 생기지 않는다. 무료 티어가 막혀(403) 지금은 재측정 수단이 없다 |
| 마이그레이션이 테이블을 다시 만든다 | `run_context_item`의 cascade가 타 **모든 맥락 기록이 지워진다** | 7단계에서 생성된 SQL을 눈으로 읽는다. `DROP TABLE`·`CREATE TABLE`이 보이면 손으로 `ALTER TABLE ADD COLUMN`으로 고쳐 쓴다 |
| `.turn-info`의 짧은 텍스트가 기존 e2e 선택자와 겹친다 | 기존 e2e가 strict mode 위반으로 깨진다 | `CLAUDE.md`가 경고하는 전례가 둘 있다. 11단계 직후 e2e 전체를 돌린다. 겹치면 `aria-label`을 명시한다 |
| Windows에서 가짜 CLI가 안 떠 9단계 배선 테스트가 OS마다 다르게 돈다 | 로컬 초록 · 릴리스 CI 빨강 | 9단계는 실제 spawn 대신 `RunManager` 스텁을 쓴다. 릴리스 CI가 Windows라 이 함정은 실제로 두 번 터졌다(v0.7.0·v0.7.1) |
| `rate_limit_event`를 무심코 파싱한다 | 개인 구독 정보가 로그·DB에 남는다 | 4단계에 **"이 줄은 이벤트를 내지 않는다"는 테스트**를 둔다. 금지를 테스트로 고정하지 않으면 다음 사람이 "유용해 보여서" 켠다 |
| 비용을 화면에 상시 띄우고 싶어진다 | intent의 "깔끔하게"와 고른 모양에서 벗어난다 | `title`에만 둔다(FR-4). 바꾸려면 intent로 돌아간다 |

## 완료 증명

- [x] `pnpm test` — 72 파일 통과, **1025개**(작업 전 977 → +48)
- [x] `pnpm typecheck` 오류 0 · `pnpm lint` 오류 0 (저장소 전체 — 남아 있던 워크트리 노이즈도 정리돼 이제 전체가 깨끗하다)
- [x] `pnpm test:e2e` 15 파일 통과 — `conversation.e2e.ts`가 진짜 Electron 창에서 모델 이름·`컨텍스트 5%`·`title`의 `$0.3870`·화면에 `$` 없음을 단언한다
- [x] `drizzle/0006_naive_dormammu.sql`이 `ALTER TABLE ... ADD COLUMN` 아홉 줄뿐 — `DROP`·`CREATE TABLE` 없음
- [x] 변이 4건을 각각 빨간 채로 봤다 — 합계→마지막우선(1 fail), 컨텍스트→합계(「컨텍스트는 덮어쓴다」 빨강), `execution.ts`의 `usage:` 한 줄 제거(「RunManager가 낸 usage가 run에 저장된다」 빨강), `hydrate`의 접기 제거(「아홉 컬럼이 Run에 낱개로 새지 않는다」 빨강). 넷 다 되돌렸다
- [x] NFR-2 grep 무출력 — CLI 방언(`cache_creation_input_tokens`·`tokens.cache`·`modelUsage`)이 `adapters/` 밖에 없다
- [x] `rate_limit` grep 무출력(테스트의 금지 단언 제외) — 개인 구독 정보를 파싱하지 않는다
- [x] 경계 grep 둘 무출력
- [ ] **수동 확인은 남겨 둔다** — 진짜 claude로 한 턴 돌려 실제 모델·토큰·컨텍스트가 뜨는지, 긴 대화에서 비율이 턴마다 올라가는지. 가짜 CLI로는 값이 고정이라 "올라간다"를 볼 수 없다

## 계획 이탈 기록

- **`emptyUsage`를 `adapters/common.ts`에 두었다.** 계획에는 없던 헬퍼다. 두 어댑터가
  아홉 필드를 매번 손으로 적으면 하나를 빠뜨렸을 때 `undefined`가 되어 조용히 샌다.
  기준값이 전부 null이라 빠뜨려도 "모름"이 되고 거짓말이 되지 않는다.
- **`mergeUsage`를 manager에서 export해 순수 함수로 검증했다.** 계획은 `manager.test.ts`의
  병합 테스트라고만 적었는데, 실제 spawn에 얹으면 Windows에서 가짜 CLI가 뜨지 않아 OS마다
  다른 것을 본다. 배선(`emit`이 그것을 부르는지)은 e2e가 끝까지 훑어 잡는다.
- **`FinishRunInput.usage`·`RunOutcome.usage`를 선택 인자로 두지 않았다.** 그래서 기존
  호출부 서른 곳 남짓이 typecheck에서 한 번에 드러났고 전부 `usage: null`로 채웠다.
  `RunManagerOptions.onError`가 필수인 것과 같은 이유다 — 기본값을 두면 배선 한 줄을
  지워도 조용히 컴파일된다.
- **`hydrate`의 구조 분해를 `withoutUsageColumns` 헬퍼로 바꿨다.** 계획대로 구조 분해로
  아홉을 빼냈더니 `no-unused-vars`가 아홉 개 터졌다. eslint 설정을 고치는 대신(저장소
  전체 규칙이다) 컬럼 목록을 상수로 두고 지우는 헬퍼를 썼다 — 펼치기·접기·빼기가 같은
  배열 하나를 본다.
- **e2e 단언을 3턴 흐름의 **끝**에 두었다.** 계획은 "1턴 뒤"라고 적었는데, 사용량은
  `result`와 함께 오므로 `.turn-info`를 기다리는 것은 곧 그 턴이 끝나기를 기다리는 것이다.
  1턴 직후에 두었더니 1턴이 끝나버려 2턴이 예약 상태가 되지 못했고 기존 단언(대기 버블)이
  깨졌다. 실제로 한 번 밟고 옮겼다.
- **`opencode.parse.test.ts`의 픽스처 개수가 셋이 아니라 넷이었다.** 계획을 쓸 때 앞의
  세 줄만 보고 적었다. 사실에 맞춰 넷으로 고쳤다.
- **가짜 claude의 모델 이름은 `claude-fake-5[1m]`다.** 진짜 모델 이름을 박으면 픽스처가
  실제 모델을 흉내내는 것처럼 읽힌다. `[1m]` 변형 표기는 남겼다 — 그 형태가 화면에서
  깨지지 않는지가 확인 대상이다.
- **화면 스크린샷으로 눈 확인은 못 했다.** e2e 창의 도크가 낮아 대화록이 거의 접혀 있고,
  요소 스크린샷이 스크롤 컨테이너 안에서 계속 엉뚱한 영역을 잡았다. 대신 e2e가 진짜
  Electron 창에서 줄의 텍스트(`claude-fake-5[1m]`·`컨텍스트 5%`)와 `title`의 `$0.3870`,
  그리고 **화면에 `$`가 없다**는 것까지 단언한다. CSS는 이미 화면에서 확인한
  `.applied-chip`과 같은 모양의 두 규칙이다.
