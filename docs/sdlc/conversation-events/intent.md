# Intent: 대화가 버리는 데이터를 살린다

- 작성자: 권용현 (Claude가 초안)
- 상태: 승인 위임됨 (2026-09-27 — 사용자: "추천해준대로 쭉 수행해줘")
- 작성일: 2026-09-27
- 선행: `docs/sdlc/conversation-timeline/` (이 데이터를 그릴 자리가 거기서 생긴다)

## 문제

OpenCode Desktop의 대화가 보여주는 것 — 셸 명령의 출력, Grep이 몇 개를 찾았는지, 줄 번호가
있는 편집 diff, 생각(추론) 블록, 하위 에이전트의 작업, "재시도 중"·"압축됨"·"권한 거부" 같은
공지 — 을 one-desk가 못 그리는 이유는 화면이 아니라 **어댑터가 데이터를 버리기 때문**이다.
2026-09-27 조사·검증(claude 2.1.280, opencode 1.18.30 바이너리와 소스)으로 확인한 것:

- **도구 출력이 200자로 잘려 저장된다.** `summarize()`가 tool_result를 200자로 자르고 로그에는
  그것만 남는다. 원문은 영구히 없다. 반면 `tool_use.input`은 Write 본문까지 통째로 저장된다.
- **구조화된 결과를 버린다.** claude의 user 줄에는 `tool_use_result`(Edit의 `structuredPatch`·
  `originalFile`, Grep의 `numFiles`, Bash의 `stdout`/`stderr`)가 오고, opencode의 완료된
  tool_use에는 `state.metadata`(edit의 `diff`/`filediff`, glob/grep의 `count`/`matches`)가
  온다. 둘 다 버린다 — 줄 번호 diff와 Write 이전 내용(claude)이 여기 있다. **남은 5단계 과제인
  diff 뷰어의 기반이 이것이다**(설계 2026-09-06 §10-1의 "OpenCode는 before를 뜰 수 없다"도
  edit에 한해서는 `filediff`로 풀린다).
- **생각을 버린다.** claude의 thinking 블록은 signature(3~5KB) 때문에 통째로 버린다
  (`claudeCode.ts`). opencode는 `run --thinking`을 붙여야 reasoning 줄이 나온다.
- **하위 에이전트가 평평하게 섞인다.** claude 스트림의 `parent_tool_use_id`를 보지 않아, 하위
  에이전트의 Edit/Write가 메인 턴의 것으로 기록된다(스냅샷·diff 설계에도 걸린다).
- **공지를 버린다.** system의 init 외 하위 타입(`compact_boundary`, `api_retry`,
  `permission_denied`)과 result의 `permission_denials`를 버린다. 권한 때문에 막힌 도구가 화면에
  전혀 드러나지 않고, 왜 느린지(재시도), 왜 컨텍스트가 줄었는지(압축) 설명이 없다.
- **로그가 정규화된 이벤트만 담는다.** 원본 stdout 줄을 저장하지 않으므로, 파서를 넓혀도
  이미 끝난 대화에는 소급되지 않는다.

## 원하는 결과

- 대화록에서 셸 명령의 출력(끝부분), Grep·Glob의 건수, 편집의 줄 번호 diff, 새로 쓴 파일의
  내용을 볼 수 있다.
- 생각 블록이 접힌 한 줄("생각 · 4초")로 보이고 펼치면 본문이 나온다.
- 하위 에이전트 호출이 카드 하나로 묶이고, 그 안의 도구 호출이 카드 아래로 들어간다.
- "재시도 중(2번째)", "대화가 압축됨", "권한 때문에 막힘: Bash" 같은 공지가 타임라인에 선다.
- 앞으로 파서가 좋아지면 지난 대화에도 적용할 재료(원본 줄)가 남는다.

## 결정 (2026-09-27, 사용자 위임으로 Claude가 추천안을 택함)

- **E1 원본 stdout 줄을 run마다 `raw.jsonl`로 함께 저장한다.** 상한을 둔다(run당 크기 상한을
  넘으면 그 뒤는 쓰지 않고 표식 한 줄). 지난 대화를 다시 파싱하는 기능은 이 기능이 아니다 —
  재료만 남긴다.
- **E2 도구 결과는 요약(200자, 지금 그대로)에 더해 원문 출력(끝부분 상한, OpenCode처럼 64KB)과
  구조화된 세부(diff·건수·원본 파일 등, 필드별 상한)를 싣는다.** 요약 필드를 지우지 않아 기존
  소비자가 깨지지 않는다.
- **E3 생각은 텍스트만 저장한다(signature는 버린다).** 두 CLI 공통의 `reasoning` 이벤트.
  CLAUDE.md의 "thinking 블록은 의도적으로 버린다" 결정을 이 조건으로 고친다.
- **E4 이벤트에 `parentToolUseId`를 싣는다**(claude). opencode `run`은 하위 세션의 part를
  내보내지 않으므로 부모의 task 도구 한 줄만 남는다 — 그대로 둔다.
- **E5 공지 이벤트를 하나 둔다**(`notice`: 압축·재시도·권한 거부·모델 대체 등 종류별).
- **E6 토큰 단위 스트리밍(`--include-partial-messages`)은 이 기능이 아니다.** 메시지 단위로
  흐르는 지금으로 충분하고, 로그·IPC 양이 급증한다.
- **E7 메시지 uuid를 이벤트에 싣는다**(claude). 되돌리기·분기(별도 과제)의 재료다. 저장만 한다.

## 영향 범위

- shared: `events.ts`(RunEvent 필드·종류 추가 — 선택 필드로, 기존 로그와 호환).
- core: `runner/adapters/{claudeCode,opencode,common}.ts`, `runner/manager.ts`(원본 줄 기록),
  `runner/logWriter.ts`, 픽스처.
- renderer: 타임라인의 도구 행·공지·생각·하위 에이전트 카드(`conversation-timeline`이 만든
  자리를 채운다).
- 마이그레이션 없음. 로그 파일 형식은 줄 단위 JSON 그대로이고 필드가 늘 뿐이다.

## 제약

- 로그 크기: 필드마다 상한을 두고 잘랐다는 표식을 남긴다. 렌더러 스토어의 run당 2000개 상한과
  IPC push 양을 함께 본다.
- 도구 출력·파일 내용·생각은 신뢰할 수 없는 입력이다 — 화면은 평문(또는 timeline의 안전한
  마크다운)으로만 그린다.
- 기존 로그 파일(필드가 없는 줄)을 읽어도 깨지지 않는다.
- 헤드리스 제약(`ask` 금지, `stdin.end()` 등)과 어댑터 판정 규칙은 그대로다.

## 성공 기준

- 픽스처(실측 줄)로 각 새 필드·이벤트를 파싱하는 테스트, 상한에서 잘리는 테스트.
- 지난 로그(필드 없는 줄)를 읽는 호환 테스트.
- 대화록에서 셸 출력·Grep 건수·편집 diff·생각·하위 에이전트 카드·공지가 보인다(캡처).
- `pnpm test`·`pnpm typecheck`·`pnpm lint`·`pnpm test:e2e` 통과.
