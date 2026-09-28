# Spec: 요금제 사용량(5시간·7일 한도)을 사이드바에 보인다

- 출처: 사용자 요청(2026-09-28) — "claude code일 경우 내 계정의 남은 사용량을 표시해 줄 수 있어?"
- 바꾸는 설계: `docs/sdlc/run-info/spec.md` §7 "`rate_limit_event`를 파싱하지 않는다" — **파싱은 하되
  저장하지 않는다**로 좁힌다. run-info intent가 "판단을 미룬다"고 남긴 것을 이번에 정한다.
- 작성자: 권용현 (초안: Claude)
- 상태: 구현 (2026-09-28, 사용자가 "저장 안 함 · 사이드바 하단" 모양을 승인)

## 1. 실측 (claude 2.1.283, 구독 로그인, 2026-09-28)

모델을 부른 턴마다 stdout에 한 줄이 온다.

```json
{"type":"rate_limit_event","rate_limit_info":{
  "status":"allowed","resetsAt":1790608200,"rateLimitType":"five_hour",
  "overageStatus":"rejected","overageDisabledReason":"out_of_credits","isUsingOverage":false,
  "unifiedWindows":{"five_hour":{"utilization":0.06,"resetsAt":1790608200},
                    "seven_day":{"utilization":0.02,"resetsAt":1791180000}}},
 "uuid":"…","session_id":"…"}
```

- `utilization`은 0~1, `resetsAt`은 **epoch 초**다.
- 모델을 부르기 전에 끊는 probe(슬래시 커맨드·모델 확인)에는 오지 않는다 — 실행이 있어야 값이 생긴다.
- Bedrock·API 키 환경에서는 구독 한도가 없다 — 이 줄이 없으면 화면에도 없다.
- opencode에는 해당 개념이 없다.

## 2. 결정

- **FR-1. 저장하지 않는다.** core가 메모리에 마지막 값 하나만 쥔다. DB·`stream.jsonl`·`raw.jsonl` 어디에도 쓰지
  않는다(`RAW_LOG_EXCLUDED_TYPES`는 그대로). 앱을 다시 켜면 다음 실행까지 값이 없다.
- **FR-2. 싣는 것은 최소다** — 창마다 `utilization`·`resetsAt`(ms로 바꿔), 그리고 지금 막혔는지(`status`가
  `rejected`)뿐이다. 초과 사용(overage)·크레딧 상태는 싣지 않는다.
- **FR-3. RunEvent가 아니다.** 이벤트로 만들면 manager가 `stream.jsonl`에 쓰고 run 이벤트로 렌더러에 흘린다.
  어댑터의 선택 메서드 `parsePlanUsage(line)`가 읽고, manager가 옵션 `onPlanUsage`(필수 — 배선 한 줄을 지우면
  컴파일이 깨진다)로 넘긴다. 콜백이 던지면 삼켜 `onError`로 보낸다(스트림 data 핸들러 안이다). `parseLine`은 이
  줄에 여전히 아무 이벤트도 내지 않는다.
- **FR-4. 앱 전역 상태다** — 대화가 아니라 계정의 것이라 사이드바 하단, MCP 줄 아래에 선다. 읽기 + 구독 둘 다
  둔다(MCP 상태와 같은 이유 — 창이 먼저 떠도 늦게 떠도 맞는 값).
- **FR-5. 표시** — `요금제 5h 6% · 7d 2%`. `title`에 창마다 리셋 시각과 마지막 확인 시각. 막혔으면 `한도 도달`을
  붙이고 경고색. 80%를 넘는 창은 경고색(컨텍스트 링과 같은 문턱). **리셋 시각이 지난 창은 `—`다** — 그 뒤의
  사용량을 모르므로 옛 수치를 보이면 거짓이다. 값이 없으면 줄이 없다.
- **FR-6. 여러 run이 동시에 돌면 마지막으로 도착한 값이 이긴다.** 같은 계정의 값이라 가장 새것이 맞다.

## 3. 우려

1. 다른 장치·터미널에서 쓴 사용량도 계정 한도에 들어가 반영된다 — 앱이 세는 것이 아니다. `title`이 "마지막 확인"을
   적어 낡은 정도를 알린다.
2. run-info §7의 "파싱하지 않는다"는 이 spec이 뒤집었다. 저장·로그 금지는 그대로다.
