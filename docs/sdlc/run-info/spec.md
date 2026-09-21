# Spec: 대화에 실행 정보 표시 — 모델·사용량·컨텍스트

- 출처: `intent.md` (승인됨 2026-09-21)
- 작성자: 권용현
- 상태: 승인됨 (2026-09-21)
- 작성일: 2026-09-21

## 1. 범위

턴마다 **무엇으로 돌았고 얼마나 썼는지**를 대화록에 한 줄로 보인다. 값은 두 CLI가 이미
보내오는 것을 정규화해 run에 저장한 것이다.

**빠지는 것** (intent의 결정과 그에 딸린 것들)

- **effort 선택·표시** — 어느 CLI도 되돌려 주지 않아 "앱이 고르고 넘긴다"가 선행돼야 한다.
  별도 intent로 연다. 이 작업은 **CLI에 새 인자를 넘기지 않는다.**
- **요금제 소진율**(`rate_limit_event`) — 대화가 아니라 앱 전역 상태이고 개인 구독 정보다.
  **파싱조차 하지 않는다**(§7).
- **대화 헤더의 누계 줄** — 턴마다의 조건이 먼저다. 저장된 값이 있으므로 나중에 붙일 수
  있다(§4의 컬럼이 그 준비다).
- 사용량에 따른 경고·차단·자동 요약 같은 **행동**. 이 작업은 관측이고 표시다.

## 2. 기능 요구사항

### 표시

- **FR-1.** 끝난 턴에는 사용자 프롬프트 바로 아래에 실행 정보 한 줄이 보인다. 한 줄은
  **모델 · 토큰 · 컨텍스트** 세 조각을 이 순서로 담는다.
  예: `claude-opus-5[1m] · 12.4k↑ 1.2k↓ · 컨텍스트 5%`
- **FR-2.** **모르는 조각은 그리지 않는다.** 0이나 `-`로 채우지 않는다. 세 조각을 모두
  모르면 **줄 자체를 그리지 않는다** — 그래서 이 기능 이전의 run은 화면이 이전과 같다.
- **FR-3.** 컨텍스트 조각은 **창 크기를 아는 경우에만 비율**로 보인다(`컨텍스트 5%`).
  모르면 토큰 수만 보인다(`컨텍스트 53.3k`). 창 크기를 모르는데 비율을 지어내지 않는다.
- **FR-4.** 한 줄은 **보기 전용**이다. 버튼이 아니고 클릭해도 아무 일도 없다. 정확한
  수치와 비용은 `title`(호버)로 읽는다 — 화면에 돈을 상시 띄우지 않는다(intent의 "깔끔하게",
  고른 미리보기에 비용이 없다).
- **FR-5.** `pending`(예약된) 턴에는 줄이 없다. 아직 아무것도 쓰지 않았다.
- **FR-6.** 실행 중인 턴은 값이 도착하는 대로 보인다. 도착 전에는 줄이 없다(FR-2와 같은
  규칙이다 — 없는 것은 그리지 않는다).
- **FR-7.** 앱을 껐다 켜도, 인박스에서 대화를 다시 열어도 같은 값이 보인다. 화면은
  **로그가 아니라 run 레코드**에서 읽는다.

### 값의 출처와 정규화

- **FR-8.** 어댑터가 CLI 방언을 `RunUsage` 하나로 정규화한다. `RunManager`·IPC·렌더러는
  claude와 opencode의 차이를 모른다(전체 설계 §329).
- **FR-9.** **모델은 관측값을 우선한다.** claude는 `system/init`의 `model`을 쓴다 —
  사용자가 모델 칸을 비워 CLI 기본값으로 돌렸어도 실제로 쓰인 것이 보인다(intent의 핵심
  요구). OpenCode는 스트림에 모델이 없으므로 **우리가 `-m`으로 넘긴 `run.model`**을 쓰고,
  그것도 비었으면 모델 조각을 그리지 않는다(FR-2).
- **FR-10.** **사용량은 턴 전체의 합이고, 컨텍스트 점유는 마지막 요청의 프롬프트 크기다.**
  둘은 다른 수다(§3-2). 한 줄에서 앞 조각(`12.4k↑ 1.2k↓`)이 합, 뒤 조각(`컨텍스트 …`)이
  점유다.
- **FR-11.** 사용량이 도착하지 않아도 run은 정상으로 끝난다. 파싱 실패는 `raw` 이벤트로
  흘리고 실행을 실패시키지 않는다(전체 설계 §11).

### 저장

- **FR-12.** 값은 run 레코드에 남는다(마이그레이션 `0006`, 컬럼 추가만 — §4).
- **FR-13.** 비용은 **화면에 상시 띄우지 않더라도 저장한다.** 값이 공짜로 오고, 나중에
  집계하려 할 때는 이미 늦다.
- **FR-14.** 기존 run은 컬럼이 전부 NULL이다. 마이그레이션은 백필하지 않는다 — 없던 값을
  지어낼 방법이 없다.

## 3. 정규화 계약

### 3-1. `RunUsage`

`shared/events.ts`에 둔다. 모든 필드가 nullable이다 — **모르는 것과 0은 다르다.**

| 필드 | 뜻 | Claude Code | OpenCode |
|---|---|---|---|
| `model` | 실제로 돈 모델 | `system/init`의 `model` (`claude-opus-5[1m]`) | 없음 → `null` |
| `inputTokens` | 비캐시 입력 합 | `result.usage.input_tokens` | `step_finish.part.tokens.input`의 합 |
| `outputTokens` | 출력 합 | `result.usage.output_tokens` | `…tokens.output`의 합 |
| `cacheReadTokens` | 캐시에서 읽음 | `cache_read_input_tokens` | `…tokens.cache.read`의 합 |
| `cacheWriteTokens` | 캐시에 씀 | `cache_creation_input_tokens` | `…tokens.cache.write`의 합 |
| `reasoningTokens` | 추론 토큰 | `usage.output_tokens_details.thinking_tokens` | `…tokens.reasoning`의 합 |
| `costUsd` | 비용 | `total_cost_usd` | `step_finish.part.cost`의 합 |
| `contextTokens` | **마지막 요청의 프롬프트 크기** | 마지막 `iterations[]`의 `input + cache_read + cache_creation` | 마지막 `step_finish`의 `input + cache.read + cache.write` |
| `contextWindow` | 모델의 창 크기 | `result.modelUsage[…].contextWindow` (실측 1,000,000) | 없음 → `null` |

### 3-2. 왜 `contextTokens`를 따로 두는가 — 실측 근거

2026-09-21 실측에서 한 턴의 `usage`는 이랬다.

```
input_tokens: 2 · cache_read_input_tokens: 15,428 · cache_creation_input_tokens: 37,917
```

**`input_tokens`만 보면 2토큰짜리 대화로 보인다.** 실제로 모델이 읽은 프롬프트는
2 + 15,428 + 37,917 = **53,347토큰**이고, 이것이 창(1,000,000) 대비 5.3%다. 캐시를 빼면
컨텍스트 점유를 통째로 놓친다 — 캐시는 "안 센 토큰"이 아니라 "싸게 읽은 토큰"이다.

그리고 **합과 점유는 섞으면 안 된다.** 한 턴이 여러 번 모델을 부르면(도구를 쓰는 턴은
거의 항상 그렇다) `result.usage`는 그 횟수만큼 더해진 값이라, 그것으로 창 대비 비율을
그리면 **100%를 넘는 숫자가 태연히 나온다.** 그래서 점유는 마지막 요청 하나만 본다 —
claude는 `usage.iterations[]`의 마지막, opencode는 마지막 `step_finish`.

### 3-3. 이벤트

`RunEvent`에 `{ type: 'usage'; usage: RunUsage }`를 더한다. 기존 `result`에 얹지 않는다 —
**OpenCode에는 `result`가 없어** 어댑터가 `text` 줄마다 합성하고 있고(전체 설계 §7), 거기에
토큰을 실으면 같은 수치가 텍스트마다 되풀이된다. 별도 이벤트면 claude는 `result` 줄에서,
opencode는 `step_finish` 줄에서 각자 자연스럽게 낸다.

`RunManager`는 `session`·`result`를 다루는 자리에서 `usage`를 하나 더 접는다. **병합 규칙은
필드마다 다르다** — 이것이 두 CLI를 하나의 manager로 다루는 핵심이다.

| 필드 | 병합 | 왜 |
|---|---|---|
| `inputTokens`·`outputTokens`·`cacheReadTokens`·`cacheWriteTokens`·`reasoningTokens`·`costUsd` | **더한다** | opencode는 스텝마다 오고 claude는 턴에 한 번 온다. **하나를 더하면 그 하나가 되므로 한 규칙이 둘을 모두 맞춘다** |
| `model`·`contextTokens`·`contextWindow` | **마지막 non-null이 이긴다** | 합이 아니라 상태다. claude는 `model`을 `init`에서, 수치를 `result`에서 따로 준다. `contextTokens`는 마지막 요청의 크기이므로 덮어쓰는 것이 곧 정답이다 |

**null은 어느 쪽도 덮지 않는다.** 모르는 값이 아는 값을 지우면 안 된다.

이 규칙 덕분에 **어댑터는 누적을 모른다.** claude 어댑터는 `init`에서 모델만 담은 `usage`를,
`result`에서 수치를 담은 `usage`를 낸다. opencode 어댑터는 `step_finish`마다 그 스텝의
수치를 낸다. `parseLine`은 한 줄만 보고 앞 줄을 기억하지 못한다는 기존 제약(전체 설계 §7)이
그대로 지켜진다. `RunOutcome`에 `usage`가 실려 `markFinished`로 저장된다.

## 4. 데이터 모델

`run` 테이블에 컬럼 아홉을 더한다. **전부 nullable, 기본값 없음, 컬럼 추가만 한다.**
테이블을 다시 만들면 `DROP TABLE run`이 `run_context_item`의 cascade를 태워 맥락 기록이
전부 지워진다(`CLAUDE.md`).

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `actual_model` | text | `run.model`(우리가 요청한 값)과 **다른 컬럼이다.** 요청과 실제를 뭉치면 "비워서 돌렸는데 무엇이 돌았나"를 영영 알 수 없게 된다 |
| `input_tokens` | integer | |
| `output_tokens` | integer | |
| `cache_read_tokens` | integer | |
| `cache_write_tokens` | integer | |
| `reasoning_tokens` | integer | |
| `cost_usd` | real | 정가 기준이다(claude가 `costBasis: "list"`로 밝힌다). 청구액이 아니다 |
| `context_tokens` | integer | 마지막 요청의 프롬프트 크기 |
| `context_window` | integer | 모르면 NULL |

`Run` 모델에는 `usage: RunUsage | null`로 실어 보낸다 — 컬럼 아홉을 그대로 펼치면 렌더러가
NULL 조합을 매번 재조립하게 된다. 전부 NULL이면 `null`이고, 그것이 FR-2의 "줄을 그리지
않는다"와 곧바로 맞물린다.

## 5. UI

### 5-1. 마크업

`Transcript.tsx`의 `.turn-user` 바로 다음에 한 줄을 더한다.

```
<div className="turn-info" title="…정확한 수치와 비용…">
  <span className="turn-info-model">claude-opus-5[1m]</span>
  <span className="turn-info-tokens">12.4k↑ 1.2k↓</span>
  <span className="turn-info-context">컨텍스트 5%</span>
</div>
```

- 조각 사이는 CSS로 가른다(`·`). 없는 조각은 **엘리먼트 자체를 그리지 않는다.**
- `title`에는 줄임 없는 수치와 비용을 담는다:
  `입력 12,431 · 출력 1,203 · 캐시 읽기 15,428 · 캐시 쓰기 37,917 · 추론 0 · $0.3870`
- 버튼이 아니다. `cursor: default`. `.applied-chip`과 같은 규칙을 따른다.

### 5-2. 숫자 표기

- 1,000 미만은 그대로, 그 이상은 `12.4k`처럼 소수점 한 자리까지 줄인다. 1,000,000 이상은
  `1.2M`.
- 비율은 정수 퍼센트다. 0.5% 미만은 `<1%`로 적는다 — `0%`는 "안 썼다"로 읽힌다.
- 화살표는 입력 `↑`, 출력 `↓`. 캐시는 한 줄에 넣지 않는다(`title`에만).

### 5-3. 두 CLI의 한 줄

| 상황 | 보이는 줄 |
|---|---|
| claude, 모델 지정 없음 | `claude-opus-5[1m] · 12.4k↑ 1.2k↓ · 컨텍스트 5%` |
| opencode, `-m` 지정함 | `opencode/nemotron-… · 3.8k↑ 31↓ · 컨텍스트 6.0k` |
| opencode, 지정 없음 | `3.8k↑ 31↓ · 컨텍스트 6.0k` (모델 조각 없음) |
| 이 기능 이전의 run | (줄 없음) |

## 6. 비기능 요구사항

- **NFR-1.** 경계 셋을 지킨다 — `core/`는 `electron`을 모르고, `renderer/`는 `core/`를
  모르며, IPC 핸들러는 얇다.
- **NFR-2.** CLI 방언은 어댑터 밖으로 나가지 않는다. `cache_creation_input_tokens`·
  `tokens.cache.write` 같은 이름이 `core/runner/adapters/` 밖에 등장하면 위반이다.
- **NFR-3.** 사용량 파싱은 실행 경로에 부담을 주지 않는다 — 줄마다 하는 일은 `JSON.parse`
  결과에서 필드를 읽는 것뿐이고, 추가 조회나 파일 접근이 없다.
- **NFR-4.** 마이그레이션은 컬럼 추가만 한다(§4). 첫 실행에 `0006`이 돌고 기존 데이터는
  그대로다.
- **NFR-5.** 새 컬럼이 늘어도 `Run`을 읽는 기존 코드는 그대로 컴파일된다(추가만 한다).

## 7. 보안·프라이버시

- **`rate_limit_event`를 파싱하지 않는다.** 구독 상태·리셋 시각·크레딧 소진 여부는 개인
  계정 정보이고 이번 범위 밖이다. 어댑터가 모르는 `type`을 무시하는 기존 동작(`default:
  return []`)에 그대로 맡긴다 — **로그 파일에는 원본 줄이 남지 않는다**(로그는 정규화된
  이벤트만 적는다).
- 저장하는 것은 수치뿐이다. 프롬프트 본문·응답은 이 작업으로 새로 저장되지 않는다.
- `cost_usd`는 정가 기준 추정이다. 화면에서 "청구액"이라고 부르지 않는다.

## 8. 확인 필요 항목 (Areas of concern)

사람이 판단하거나 실측으로 확인해야 하는 것들이다.

- **[확인 필요, 지금은 확인할 수단이 없다] OpenCode `tokens.input`의 의미.** 기록된
  픽스처에서 스텝마다 3,815 → 1,765 → 1,862로 오르내린다. **각 요청의 비캐시 입력**으로
  읽었고 그래서 합산이 과금 관점에서 맞다고 보았다. 만약 "세션 누적"이라면 합산은
  과대계상이 된다.

  **다시 측정하려 했으나 막혔다.** 2026-09-21 실측에서 opencode 어댑터 설계 §6-2가 쓰던
  무료 모델 경로가 더 이상 열리지 않는다 — `opencode run --format json -m
  opencode/nemotron-3.5-lightning-free`가 HTTP 403 `FreeTierError`로 끝난다
  (`"OpenCode's free tier can only be used from within OpenCode"`). **설계 문서의 "무료
  모델로 뜬다. 비용이 들지 않는다"는 이제 사실이 아니다.**

  그래서 이 항목은 **기록된 픽스처를 유일한 근거로 삼아 합산 해석을 유지하고**, 열어 둔다.
  값이 틀려도 claude 쪽 표시는 영향이 없고, opencode 쪽은 토큰 수가 과대계상될 뿐 비율을
  그리지 않아(창 크기를 모른다) 거짓 게이지가 되지는 않는다. 유료 provider로 한 번 돌릴
  일이 생기면 그때 확인하고 고친다.
- **[확인 필요] claude `usage.iterations`가 항상 오는가.** 실측(2.1.278)에는 있었다.
  없으면 `contextTokens`는 최상위 `input + cache_read + cache_creation`으로 폴백한다 —
  도구를 여러 번 쓴 턴에서는 과대평가가 되지만, **창을 넘는 값은 그리지 않고 `>99%`로
  적는다**(거짓 100%+보다 낫다).
- **[확인 필요] 실패·중단된 턴에도 `result`가 오는가.** 오지 않으면 그 턴은 사용량이
  NULL로 남는다. FR-2가 이미 그 경우를 덮지만, 취소가 잦다면 사용자는 "취소하면 비용이
  없다"고 오해할 수 있다.
- **[판단 필요] `actual_model`을 그대로 보일 것인가.** `claude-opus-5[1m]`은 정확하지만
  길다. 접두사(`claude-`)를 떼고 `opus-5[1m]`로 줄이면 한 줄이 가벼워지는 대신 표시와
  실제 문자열이 달라진다. **줄이지 않는 쪽을 제안한다** — 이 줄의 존재 이유가 "무엇이
  돌았는지 정확히 아는 것"이고, 줄임은 `title`이 아니라 화면에서 정보를 지운다.
- **[부수 발견, 이 범위 밖] OpenCode의 `error` 줄을 어댑터가 모른다.** 위 403은
  `{"type":"error", …}` 한 줄로 오는데 `parseLine`의 `switch`에 그 분기가 없어 `default`로
  버려진다. 이벤트가 하나도 없이 종료 코드만 1이 되므로 **사용자는 이유 없는 실패를 본다.**
  이 작업의 범위는 아니지만 기록해 둔다 — 별도 수정거리다.

- **[판단 필요] 컨텍스트 비율에 색을 줄 것인가.** 80%를 넘으면 눈에 띄게 하는 것이
  유용하지만, 임계값은 근거 없는 숫자가 되기 쉽고 "행동"(경고)은 범위 밖이다.
  **이번에는 색을 주지 않는 쪽을 제안한다.**

## 9. 성공 기준 (검증 가능한 형태)

- claude로 모델 칸을 비운 채 한 턴을 돌리면 그 턴 줄에 `claude-`로 시작하는 실제 모델이
  보인다. (e2e — 가짜 CLI가 `init.model`을 낸다)
- 같은 턴의 `title`에 캐시 읽기·쓰기 수치가 들어 있다.
- 컨텍스트 창을 모르는 스트림(opencode 픽스처)으로 돌리면 `%`가 없고 토큰 수만 보인다.
- 사용량이 전혀 없는 run(이 기능 이전 데이터를 흉내낸 픽스처)은 `.turn-info`가 아예 없다.
- 한 턴에 `step_finish`가 셋 오는 opencode 픽스처를 정규화하면 `outputTokens`는 셋의 합,
  `contextTokens`는 **마지막 것 하나**로 계산된다. (단위 테스트 — 이 둘을 한 테스트에서
  확인해야 §3-2의 구분이 고정된다)
- `grep -rn "cache_creation_input_tokens\|tokens.cache" --include=*.ts . | grep -v adapters/`
  가 비어 있다 (NFR-2).
- 기존 e2e 전부 통과, 단위 테스트 전부 통과.
