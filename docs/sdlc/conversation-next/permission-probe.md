# 실측: 권한 요청 카드 (`--permission-prompt-tool`)

- 측정일: 2026-11-06
- 환경: Windows 11, claude 2.1.312(구독 로그인), 모델 haiku, 임시 폴더에서 33회 실행(API 환산 약 0.04달러)
- 대상: `intent.md` 1번(권한 요청 카드)의 "가능한 길"이 실제로 도는지
- 상태: 기록이다. 구현은 없고, 규칙을 바꿀지는 사용자가 정한다.

측정 도구는 세션의 임시 폴더에서 쓰고 버렸다. 최소 MCP stdio 서버, 그리고 `core/mcp/host.ts`와 같은 모양의 HTTP 서버에
승인 도구 하나를 올리고, 실제 `core/mcp/bridge.mjs`를 Electron의 Node로 띄워 claude에 붙였다.

## 결론

1. **된다.** `--permission-prompt-tool mcp__<서버>__<도구>`는 지금의 턴 구조(`-p`, stdin 닫음, stream-json)에 그대로 붙는다.
2. **`acceptEdits`와 같이 쓰면 안 된다.** 작업 폴더 안의 `rm -rf`가 승인 도구를 거치지 않고 실행된다. 묻는 모드는
   `--permission-mode manual`에 `--allowedTools` 허용 목록을 주는 조합이어야 한다.
3. **CLI는 기본 30분까지 기다린다.** MCP 서버 설정의 `timeout`(ms)으로 늘리거나 줄일 수 있고, 늘리면 실제 브리지로 35분을
   기다려도 정상으로 끝난다.
4. **승인 호출은 CLI가 한 번에 하나만 보낸다.** 병렬 도구도 순서대로 묻는다.
5. **OpenCode에는 이 길이 없다.** `intent.md` 1번대로 `run`은 ask를 자동 거부한다(이번에 재지 않았다).

## 호출 모양

승인 도구는 인자 셋을 받는다.

```json
{ "tool_name": "Bash", "input": { "command": "...", "description": "..." }, "tool_use_id": "toolu_..." }
```

- `tool_use_id`는 스트림의 `tool_use` 블록 id와 같다. 대화록의 도구 줄과 카드를 이 값으로 잇는다.
- 스트림의 `tool_use`가 승인 호출보다 먼저 온다(c15 9ms, c16 8ms 차이).
- 기다리는 동안 스트림에는 아무것도 오지 않는다. 대기 상태는 승인 도구 쪽에서만 보인다.
- `permission_suggestions`는 오지 않았다(c10). "항상 허용"의 규칙은 앱이 만들어야 한다.
- 승인 도구는 `init`의 `tools`에 없다. 같은 서버의 다른 도구는 있다(c1, c12). 모델이 직접 부를 수 없다.
- `--allowedTools`에 승인 도구를 넣지 않아도 불린다(c1).

## 응답

| 사례 | 돌려준 값 | 결과 |
|---|---|---|
| c1 | `allow` + `updatedInput` 원본 | 실행. exit 0 |
| c5 | `allow`만 | 실행. `updatedInput`이 없어도 된다 |
| c6 | `allow` + 고친 `command` | **고친 명령이 실행된다.** 스트림의 `tool_use`에는 원래 명령이 남는다 |
| c2 | `deny` + `message` | `tool_result`가 `is_error`이고 글자가 `message` 그대로다. exit 0, `subtype: success`, `permission_denials`에 남는다 |
| c9 | `deny` + `interrupt: true` | 턴이 바로 끝난다. exit 1, `subtype: error_during_execution`, `result` 글자 없음 |
| c15 | `allow` + `updatedPermissions`(`addRules`, `destination: "session"`, `Bash(node:*)`) | **두 번째 `node` 명령은 묻지 않는다** |
| c10 | `allow` + `updatedPermissions: []` | 두 번 다 묻는다 |

c9를 그대로 쓰면 지금의 `judgeStatus`는 그 턴을 `failed`로 기록한다.

## 무엇이 승인 도구에 닿는가

| 사례 | 모드 | `--allowedTools` | 시도 | 승인 호출 | 결과 |
|---|---|---|---|---|---|
| c3 | `acceptEdits` | 읽기·편집 | `echo hi > b.txt` | **없음** | 실행됨 |
| c23 | `acceptEdits` | 읽기·편집 | `rm x.txt` | **없음** | 지워짐 |
| c24 | `acceptEdits` | 읽기·편집 | `rm -rf sub` | **없음** | 지워짐 |
| c25 | `acceptEdits` | 읽기·편집 | `mv x.txt z.txt` | **없음** | 옮겨짐 |
| c26 | `acceptEdits` | 읽기·편집 | `sed -i` | **없음** | 고쳐짐 |
| c29 | `acceptEdits` | 읽기·편집 | `mkdir`·`touch`·`cp` | **없음** | 실행됨 |
| c16 | `acceptEdits` | 읽기·편집 | `node -e` | 있음 | |
| c30 | `acceptEdits` | 읽기·편집 | `git init` | 있음 | |
| c27 | `acceptEdits` | 읽기·편집 | `echo > ../outside.txt` | 있음 | 작업 폴더 밖은 묻는다 |
| c28 | `acceptEdits` | 읽기·편집 | `rm ../outside.txt` | 있음 | 작업 폴더 밖은 묻는다 |
| c20 | `acceptEdits` | 읽기·편집 | Write `.claude/settings.local.json` | 있음 | 보호 경로는 묻는다 |
| c31 | `manual` | 읽기·편집 | Write `a.txt`, 이어서 `rm x.txt` | Write 없음, `rm` 있음 | 원하는 동작이다 |
| c32 | `manual` | 읽기·편집 | `ls; rm x.txt` | 있음 | 이어 붙인 명령도 묻는다 |
| c33 | `manual` | 읽기·편집 | Write `.git/hooks/pre-commit` | 있음 | 허용 목록에 Write가 있어도 보호 경로는 묻는다 |
| c4 | `manual` | 읽기 | Glob, 이어서 Write | Glob 없음, Write 있음 | |
| c17 | `manual` | 없음 | `pwd`, `ls` | 없음 | 읽기 명령은 묻지 않는다 |
| c11 | `manual` | `Bash(echo:*)` | `echo > out.txt` | 있음 | 리다이렉트가 있으면 규칙에 안 맞는다 |

지금의 `edit`이 안전한 것은 `--tools`에 Bash가 없어서다. Bash를 `--tools`에 넣는 순간 `acceptEdits`가 위 표대로 동작한다.

`--permission-mode`의 선택지에서 `default`가 사라지고 `manual`이 생겼다. `init`은 `manual`을 `permissionMode: "default"`로 보고한다.
이전 버전에서 `manual`을 받는지는 재지 않았다.

## 병렬과 대기

- **병렬 도구(c7):** 한 메시지의 Bash 호출 둘을 CLI가 순서대로 묻는다. 첫 응답이 온 뒤에야 둘째 승인이 불린다.
  화면은 카드 하나씩만 그리면 된다.
- **짧은 대기(c8):** 30초. 정상.
- **긴 대기, 직접 연결(c14):** 7분. 정상.
- **긴 대기, 실제 브리지(c22):** 6분. 정상.
- **CLI의 한도(c13):** 응답이 없으면 1,800초에 끊는다. 도구는 실패하고 턴은 이어진다.
  `sent no response or progress for 1800s; aborting`. 모델이 그것을 보고 답하므로 exit 0, `subtype: success`다.
- **서버별 한도(c34):** MCP 서버 설정의 `timeout: 20000`이 20초에 끊었다. 전역 환경변수는
  `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`이고 0이면 끈다고 오류 글이 말한다(재지 않았다).
- **한도를 늘린 긴 대기, 실제 브리지(c35):** `timeout: 3600000`을 주고 35분을 기다린 뒤 허용했다. 명령이 실행되고 턴이 정상으로
  끝났다. 브리지의 `fetch`는 기본 5분 제한에 걸릴 줄 알았는데 걸리지 않았다. 왜 안 걸렸는지는 재지 않았다.
- **끊을 때 CLI는 `notifications/cancelled`를 보낸다(c34).** 그러나 `bridge.mjs`의 `chain`이 앞 요청이 끝날 때까지 다음 줄을
  붙잡으므로, 승인을 기다리는 동안 그 알림은 서버에 닿지 않는다(코드로 읽었다. 재지 않았다).

## 재지 않은 것

- WSL 안의 claude. 브리지 구조는 같지만 Linux claude의 버전과 interop을 거친다.
- `--resume`으로 이은 턴에서 `destination: "session"` 규칙이 남는지. 턴마다 프로세스가 새로 뜨므로 남지 않는다고 가정하고 설계한다.
- 하위 에이전트의 도구 호출. 지금은 전체 허용에서만 뜬다.
- 2.1.312가 아닌 버전. 플래그는 도움말에 일부만 나오는 숨은 동작이라 버전이 오르면 다시 재야 한다.
- 실제 앱의 `core/mcp/host.ts`. 측정용 서버는 같은 모양일 뿐이다.

## 설계에 주는 뜻 (제안, 미결정)

- **"ask 금지"의 뜻.** 규칙의 이유는 "답할 사람이 없다"였다. 승인 도구는 답할 사람을 만들므로 규칙을
  "답할 사람이 없는 경로에 ask를 만들지 않는다"로 좁힐 수 있다. 정기 실행과 OpenCode는 여전히 금지다.
- **기존 두 단계는 그대로 둔다.** 읽기 전용의 `--tools` 화이트리스트는 모델이 시도조차 못 하게 하는 벽이다.
  새 단계 `물어보기`를 더하고 `manual` + 읽기·편집 허용 목록 + 승인 도구로 만든다.
- **대기 시간은 앱이 정한다.** CLI 한도에 맡기면 턴이 "성공"으로 끝나고 카드만 남는다. 앱이 먼저 `deny`로 답하거나
  서버 설정의 `timeout`을 길게 잡는다. 기다리는 동안은 실행 슬롯을 쥐고 run 시간 상한도 흐른다.
- **"항상 허용"은 둘로 갈린다.** 턴 안에서는 `updatedPermissions`로 충분하고, 대화 전체에 남기려면 앱이 규칙을 쥐고
  다음 턴의 `--allowedTools`나 승인 도구의 자동 응답으로 되살려야 한다.
- **브리지를 먼저 고친다.** 승인을 기다리는 동안 같은 run의 다른 MCP 호출과 취소 알림이 `chain`에 걸린다.
