# 4단계 — MCP 서버 설계

**날짜:** 2026-08-12
**상태:** 승인됨
**근거 문서:** 전체 설계 §7(권한 모델) · §8(MCP 서버), 실측 노트 Q16 · Q22 · Q25~Q28

---

## 1. 범위

agent가 실행 중에 one-desk의 데이터를 직접 읽고 쓰는 통로를 만든다. 지금까지 맥락은 **실행 전에 조립돼 프롬프트로 한 번 전달될 뿐**이었고, agent가 작업 중 알게 된 것을 앱에 남길 방법이 없었다.

### 들어가는 것

- `127.0.0.1`의 임의 포트에 HTTP MCP 서버 하나
- run에 묶인 토큰 — 발급·인증·폐기
- 도구 아홉 개 (읽기 5, 쓰기 4)
- 권한 단계에 따른 도구 등록 제어
- 커맨드 배선 — `--mcp-config`, `--strict-mcp-config`, `--allowedTools`
- `permission.ts`의 실측 불일치 교정 (§7)
- 이월 항목 둘 — `console.error` → 주입식 `onError`, `resume`의 catch 좁히기 (§9)

### 빠지는 것

**감사 기록을 위한 새 배관.** 전체 설계 §8이 "모든 MCP 호출은 run 로그(JSONL)에 기록된다"고 적었는데, **이미 그렇게 된다.** 어댑터의 `parseLine`이 `tool_use`/`tool_result` 블록을 파싱해 `stream.jsonl`에 쓰고 있고, MCP 호출은 `mcp__onedesk__update_issue`라는 이름으로 그 경로를 지난다. 입력과 결과 요약이 함께 남으므로 "이 이슈가 왜 done이 되었는가"를 run까지 거슬러 올라갈 수 있다.

**한계를 명시해 둔다.** 기록의 출처가 agent의 stdout이므로, **stdout 파싱이 실패하면 기록은 사라지지만 DB 변경은 남는다.** 서버가 스스로 호출을 적는 방식이었다면 이 틈이 없었을 것이다. 지금 그것을 만들지 않는 이유는 로그가 이미 두 벌이 되고(호스트 로그 + run 로그), 둘이 어긋났을 때 어느 쪽이 진실인지 정하는 비용이 얻는 것보다 크기 때문이다. 이 틈이 실제로 문제가 되면 그때 호스트 쪽에 붙인다.

**OpenCode 어댑터의 MCP 배선.** 5단계 몫이다. 노트 Q23이 실측한 대로 `opencode run`에는 `--mcp-config`가 없어 설정 파일 경로를 run별로 넘길 방법 자체가 다르다.

**UI 변경 없음.** 렌더러는 이 단계에서 아무것도 달라지지 않는다.

---

## 2. 아키텍처

```
core/mcp/
├─ host.ts        node:http 서버, 토큰 맵, 요청당 서버 인스턴스 조립
├─ tools.ts       도구 아홉 개의 등록 (권한에 따라 쓰기 도구를 뺀다)
└─ configFile.ts  run별 mcp.json을 0600으로 쓰고 지운다
```

노트 Q28이 실측한 구조를 그대로 쓴다.

```
HTTP 요청 도착
   │
   ├─ Authorization 헤더에서 토큰 추출
   ├─ 토큰 → { runId, workspaceId, permission } 조회
   │    └─ 없으면 401. 여기서 끝.
   │
   ├─ buildServer(ctx)   ← permission에 따라 쓰기 도구를 등록하거나 안 한다
   ├─ 새 Transport 생성 (stateless)
   └─ handleRequest()
```

**요청마다 토큰을 보고 그 토큰에 맞는 서버 인스턴스를 새로 만든다.** 도구 필터링을 `tools/list` 응답에서 하지 않고 애초에 등록하지 않는다. 그래서 이름을 아는 agent가 직접 호출해도 `Tool not found`로 거부된다 — Q28이 curl로 확인했다.

인스턴스 생성 비용이 걱정될 수 있으나 도구 등록은 객체 몇 개를 만드는 일이다. 얻는 것은 **권한이 절대 섞이지 않는다**는 보장이다.

`sessionIdGenerator: undefined`(stateless)를 쓴다. stateful 모드는 서버가 세션 ID를 발급하고 클라이언트가 그것을 실어 보내는 구조인데, **우리는 토큰이 이미 세션 역할을 하므로** 중복이고 서버가 상태를 들고 있을 이유가 없다.

### 경계

`core/`는 `electron`을 import하지 않는다 — `node:http`만 쓴다. 저장은 전부 기존 리포지토리를 주입받아 부른다. SQL이 도구 아홉 곳에 흩어지면 리포지토리를 둔 이유가 사라진다.

### 의존성

`@modelcontextprotocol/sdk`와 `zod`를 런타임 의존성으로 더한다 (2개 → 4개). zod는 SDK가 도구 스키마에 요구하기도 하지만, **agent가 넘긴 인자를 런타임에 검증한다는 것 자체가 이 단계에 필요한 일**이다. `core/execution.ts`의 `assertFound`에 이미 "4단계에서 MCP를 통해 agent가 임의 id를 넘길 수 있다"는 주석이 달려 있다.

---

## 3. 토큰 생명주기

토큰은 32바이트 난수(`randomBytes(32).toString('base64url')`)다. 호스트가 `token → { runId, workspaceId, permission }` 맵을 소유한다 — 요청을 풀려면 어차피 그 맵이 필요하고, 다른 곳에 두면 두 자리가 어긋난다.

**폐기를 한 번이라도 빠뜨리면 끝난 run의 토큰으로 계속 workspace를 읽고 쓸 수 있다.** 3a가 슬롯 누수로 같은 모양의 급소를 겪었고, 해법이 이미 코드에 있다.

| 시점 | 자리 | 하는 일 |
|---|---|---|
| 발급 | `launch()` — `queue.enqueue` 직전 | 토큰 발급, 설정 파일 작성 |
| 폐기 | `finish()`의 `finally` | `queue.release(runId)`와 같은 자리 |
| 폐기 | `beginRun()`의 catch (유령 run) | `queue.release(runId)`와 같은 자리 |
| 폐기 | `shutdown()` | 맵 전체를 비운다 |

**슬롯을 돌려주는 모든 자리가 토큰을 폐기하는 자리다.** 이 대응을 깨지 않는 것이 규칙이다. 새 종료 경로를 만들 때 `release` 옆에 `revoke`가 없으면 그것이 결함이다.

발급을 `enqueue` 앞에 두는 이유는 대기 중인 run도 설정 파일이 준비돼 있어야 하고, 슬롯을 얻는 순간 곧바로 프로세스를 띄우기 때문이다. 대기 중 토큰이 살아 있는 것은 문제가 아니다 — 그 토큰을 쥔 프로세스가 아직 없다.

---

## 4. 지연 기동

`launch()`가 큐에 넣기 전에 `ensureListening()`을 `await`한다. 순서가 정해져 있다.

```
runs.create  →  preflight  →  ensureListening → 토큰 발급 → 설정 파일  →  queue.enqueue
```

MCP 준비가 preflight 뒤에 오는 이유는 실행 파일조차 없는 run이 포트를 열게 하지 않기 위해서다. 그리고 둘 다 `enqueue` 앞이므로, 어느 쪽이 실패해도 슬롯을 잡았다 놓는 낭비 없이 `startedAt`이 null인 실패로 끝난다 (§8).

`createCore`는 동기로 남는다. `electron/main.ts`와 `core/index.test.ts`가 그대로이고, **앱을 여는 것만으로는 포트가 열리지 않는다** — 3a가 세운 "앱을 여는 행위가 agent 실행을 부르지 않는다"와 결이 같다.

동시에 두 run이 시작해도 서버가 하나만 뜨도록 **기동 프로미스를 캐시해 멱등하게** 만든다. 두 번째 호출자는 첫 번째의 프로미스를 그대로 기다린다.

서버 핸들에 `unref()`를 건다. `shutdown()`은 동기이므로 닫히기를 기다릴 수 없는데, `unref`가 걸려 있으면 남은 핸들이 프로세스 종료를 막지 않는다.

포트는 `listen(0, '127.0.0.1')`로 OS가 고른다. 충돌이 원천적으로 불가능하고 외부 네트워크에서 닿지 않는다.

---

## 5. 도구 아홉 개

**workspace는 인자가 아니라 토큰에서 온다.** agent가 넘길 수 있는 자리에 두면 경계가 사라진다.

| 구분 | 도구 | 인자 | 반환 |
|---|---|---|---|
| 읽기 | `list_repos` | — | `{id, name, path}[]` |
| 읽기 | `list_issues` | `status?`, `repoId?` | 요약 목록 |
| 읽기 | `get_issue` | `id` | 본문 + `repoIds` |
| 읽기 | `list_memos` | `repoId?` | 요약 목록 |
| 읽기 | `get_memo` | `id` | 본문 + `repoIds` |
| 쓰기 | `create_issue` | `title`, `body`, `repoIds?` | 만들어진 이슈 |
| 쓰기 | `update_issue` | `id`, `status?`, `body?` | 갱신된 이슈 |
| 쓰기 | `create_memo` | `title`, `body`, `repoIds?` | 만들어진 메모 |
| 쓰기 | `update_memo` | `id`, `title?`, `body?` | 갱신된 메모 |

맥락으로 이미 첨부한 항목을 다시 조회할 수 있어야 하는 이유는 전체 설계 §8에 있다 — agent가 작업 중 관련된 다른 이슈를 찾아봐야 할 수 있고, 향후 자율 실행에서는 이 읽기 도구들이 진입점이 된다.

zod 스키마가 인자를 검증하고, 저장은 기존 리포지토리가 한다. `closedAt`이 `status`에서 파생되는 것도, `repoIds`의 workspace 소속을 검증하는 것도 이미 리포지토리에 있다.

### 발견한 구멍 — `get`/`update`는 workspace를 보지 않는다

`issues.list()`는 `workspaceId`를 받지만 **`issues.get(id)`와 `issues.update({id, …})`는 id만 본다.** `update`는 이슈 자신의 workspace를 소유자로 삼아 태그를 검증할 뿐, 부르는 쪽이 그 workspace에 속하는지는 묻지 않는다. memo도 대칭으로 같다.

지금까지는 렌더러만 불렀으니 무해했다. **MCP는 agent가 임의의 id를 넘기는 첫 경로다.** 그대로 두면 workspace A의 토큰으로 B의 이슈를 읽고 고칠 수 있다 — 전체 설계 §8이 "agent는 자신의 workspace 밖 데이터를 읽을 수도 수정할 수도 없다"고 약속한 바로 그 자리다.

**MCP 계층에서 막는다.** 리포지토리 시그니처를 바꾸면 IPC와 렌더러까지 번지고, 이것은 데이터 규칙이 아니라 경계의 문제다. id를 받는 네 도구(`get_issue`, `update_issue`, `get_memo`, `update_memo`)가 **공통 가드 하나**를 지나게 해서 도구별로 잊는 일이 없게 한다. 소속이 다르면 존재를 알리지 않고 `찾을 수 없습니다`로 떨군다 — 다른 메시지를 주면 id의 존재 여부가 새어나간다.

---

## 6. 권한이 도구 등록을 통제한다

| 권한 | 등록되는 도구 |
|---|---|
| `read_only` | 읽기 5개 |
| `edit` | 아홉 개 전부 |
| `full` | 아홉 개 전부 |

세 단계 중 읽기 전용만 도구를 덜어내라는 것이 전체 설계 §8의 명시적 카브아웃이다. "파일은 수정하지 못하는데 이슈 상태는 바꿀 수 있다면 읽기 전용이라는 표현을 신뢰할 수 없게 된다."

**이 서버측 필터링은 선택이 아니라 유일한 수단이다.** 노트 Q22가 실측했다 — `--tools "Read"`로 빌트인 도구를 제한해도 `mcp__*` 도구는 그대로 전부 남았다. CLI 플래그로는 MCP 도구를 읽기 전용으로 만들 수 없다.

---

## 7. 커맨드 배선

`ResolvedRunSpec`에 `mcp: { serverName, url, token } | null`을 더한다. `null`이면 어댑터가 MCP 블록 전체를 건너뛴다 — 기존 테스트가 그대로 산다.

```
--mcp-config <0600 임시 파일>  --strict-mcp-config
--allowedTools … ,mcp__onedesk
```

설정 파일의 내용은 노트 Q26이 실측한 형식이다.

```json
{"mcpServers":{"onedesk":{"type":"http","url":"http://127.0.0.1:<port>/mcp",
 "headers":{"Authorization":"Bearer <token>"}}}}
```

**토큰은 절대 커맨드 인자에 넣지 않는다.** `--mcp-config`는 JSON 문자열도 받지만(Q16), 인자는 `ps aux`로 같은 머신의 다른 사용자에게도 보인다. `0600` 파일에 쓰고 경로만 넘긴 뒤, run이 끝나면 토큰 폐기와 같은 자리에서 지운다.

`--strict-mcp-config`를 함께 준다. 사용자의 개인 MCP 설정이 실행에 딸려 들어오면 우리가 통제하지 못하는 도구가 agent에게 열린다.

### `--allowedTools`에 `mcp__onedesk`를 넣는 것은 세 단계 모두다

노트 Q22의 실측이다 — `--permission-mode`는 MCP 도구를 자동 승인하지 않는다. `acceptEdits`로 실행해도 MCP 호출이 `"Claude requested permissions to use mcp__onedesk__list_issues, but you haven't granted it yet."`로 거부됐다. `--allowedTools "mcp__onedesk"`를 추가하니 통과했다(서버 단위 승인).

빠뜨리면 **agent가 issue/memo를 전혀 수정하지 못하는데 실패가 조용하다.**

### `permission.ts`의 실측 불일치를 함께 고친다

`claudeCodePermissionArgs`의 `read_only`는 지금 `--allowedTools READ_ONLY_TOOLS` 하나뿐이고, 주석은 "이 목록 밖은 전부 차단된다"고 적혀 있다. **Q22의 실측은 반대다.**

| 플래그 | 하는 일 |
|---|---|
| `--tools` | 그 도구를 **존재하지 않게** 만든다. 모델이 아예 못 본다 |
| `--allowedTools` | 존재하는 도구를 **묻지 않고 승인**한다 |
| `--disallowedTools` | 존재하는 도구를 **항상 거부**한다 |

즉 **읽기 전용 run에서 편집 도구가 여전히 존재한다.** 2단계가 남긴 구멍이고, 4단계는 같은 함수에 MCP 접두사를 넣어야 해서 정확히 그 위에 착륙한다. "읽기 전용인데 쓰기 MCP 도구는 뺐다"면서 파일 편집은 열어두는 것은 앞뒤가 맞지 않으므로 여기서 함께 고친다.

```ts
export function claudeCodePermissionArgs(
  permission: Permission,
  mcpToolPrefixes: string[] = []
): string[]
```

여기서 말하는 도구는 **Claude Code의 빌트인 도구**이지 §5의 MCP 도구가 아니다. 빌트인 읽기 6은 `Read, Glob, Grep, WebFetch, WebSearch, TodoWrite`, 빌트인 편집 3은 `Edit, Write, NotebookEdit`이다 (Claude Code 2.1.x 기준, Q22에서 확인).

| 권한 | 인자 |
|---|---|
| `read_only` | `--tools <빌트인 읽기 6>` · `--allowedTools <빌트인 읽기 6 + mcp__onedesk>` · `--disallowedTools Bash,Edit,Write,NotebookEdit` · `--permission-mode acceptEdits` |
| `edit` | `--tools <빌트인 읽기 6 + 편집 3>` · `--allowedTools <그 9 + mcp__onedesk>` · `--disallowedTools Bash` · `--permission-mode acceptEdits` |
| `full` | `--permission-mode bypassPermissions` · `--allowedTools mcp__onedesk` |

**어떤 단계에도 `ask`로 떨어지는 설정이 없다.** 헤드리스에서 `ask`는 곧 무한 대기다. 기존 테스트가 이것을 고정하고 있고 그대로 둔다.

읽기 전용의 `--permission-mode`를 `acceptEdits`로 두는 것은 "편집 도구가 이미 없으므로 승인할 편집도 없다"는 뜻이다. 이름이 오해를 부르지만 `dontAsk`의 의미가 문서화돼 있지 않아(Q22의 [확인 필요] 1번) 검증 없이 바꾸지 않는다. 주석으로 이유를 남긴다.

**도구 이름의 안정성.** 하드코딩한 목록은 CLI 업데이트로 바뀔 수 있다. 대안(런타임 조회)은 CLI가 API를 주지 않으므로 존재하지 않는다. 방어책은 run의 `system`/`init` 이벤트에 실린 `tools` 배열이 이미 `stream.jsonl`에 남는다는 것이다 — 예상과 다르면 나중에 추적할 수 있다.

---

## 8. 오류 처리

**도구 안에서 던진 오류는 run을 죽이지 않는다.** `isError` 도구 결과로 한국어 메시지를 돌려주면 agent가 읽고 대응한다. 잘못된 id 하나 때문에 몇 분짜리 실행이 통째로 날아가면 안 된다.

**서버가 못 뜨면 run을 실패시킨다.** `ensureListening()`이 거부하거나 설정 파일을 못 쓰면, preflight 실패와 같은 자리에서 `markFinished(failed)`로 떨군다.

MCP 없이 조용히 진행하는 쪽이 부드러워 보이지만 아니다. agent는 이슈를 못 고치는 채로 "성공"으로 끝나고, §8이 경계한 "실패가 조용해서 원인을 찾기 어렵다"가 그대로 재현된다. `startedAt`이 null인 실패로 인박스에 올라오는 편이 정직하다.

**토큰이 없거나, 모르거나, 이미 폐기됐으면 401이다.** 셋을 구분해 알려주지 않는다. `/mcp`가 아닌 경로는 404다.

### 이월된 두 항목

둘 다 4단계가 어차피 손대는 파일이다.

**`core/`의 `console.error`를 주입식 `onError`로 바꾼다.** `execution.ts`에 세 자리가 있다(`finish`의 종료 기록 실패, `beginRun`의 시작 기록 실패, 시작 알림 실패). MCP 호스트도 요청 처리 중 오류를 낼 곳이 필요하고, 같은 통로를 쓰는 것이 맞다. `core/`가 나중에 데몬으로 떨어질 때 목적지를 정하는 것은 부르는 쪽의 몫이다.

`createCore`가 `onError`를 받아 core 전체에 내려준다. 기본값은 지금과 같은 `console.error`로 두어 호출자가 없어도 조용해지지 않게 한다.

**`resume`의 catch를 좁힌다.** 지금은 `runs.get()`의 모든 예외를 "이어서 실행할 원본 run이 없습니다"로 뭉갠다. DB가 잠겼거나 스키마가 깨진 것도 같은 메시지가 되어 조사가 엉뚱한 데로 간다. 리포지토리가 "찾을 수 없습니다"로 던지는 경우만 그 메시지로 바꾸고, 나머지는 그대로 올려보낸다.

---

## 9. 테스트

`core/mcp`는 Electron을 모르므로 node 환경에서 **실제 HTTP로** 검증한다. 임의 포트에 띄우고 진짜 요청을 보낸다. 서버를 가짜로 만들면 검증할 것이 거의 남지 않는다. DB는 인메모리 SQLite(Q39)를 쓴다.

**e2e 하나를 추가한다.** 가짜 CLI 스크립트가 `--mcp-config`로 받은 파일을 읽어 실제 MCP 호출로 이슈를 만들게 한다. 설정 파일 · 토큰 · 포트 · workspace 범위가 한 번에 증명되고, 이것이 없으면 §7의 전달 사슬이 단위 테스트만으로는 초록인 채 끊길 수 있다.

### 이 단계의 "prop 한 줄"

CLAUDE.md가 3a·3b에서 새어나간 자리를 `App.tsx`가 자식에게 내려보내는 prop 한 줄로 기록했다. 4단계는 렌더러를 건드리지 않으므로, 같은 성질의 자리는 **core의 전달 사슬 세 줄**이다.

```
core/index.ts  →  execution        (mcp 호스트를 넘기는 줄)
execution      →  manager.start    (spec.mcp를 넘기는 줄)
manager        →  buildCommand     (spec.mcp를 넘기는 줄)
```

셋 중 하나만 지워도 MCP가 통째로 꺼지는데 각 계층의 단위 테스트는 전부 초록이다. 변이표에 명시적으로 넣는다.

### 변이표

각 줄은 "이 줄을 되돌리면 이 테스트가 빨개진다"는 짝이다. 회귀 테스트를 넣을 때 **대상 코드를 잠시 망가뜨려 실제로 실패하는지 확인한다** (CLAUDE.md).

| # | 약속 | 되돌릴 줄 | 실패해야 하는 테스트 |
|---|---|---|---|
| 1 | 종료 시 토큰 폐기 | `finish()`의 `revoke` | 종료 후 그 토큰으로 호출 → 401 |
| 2 | 유령 run도 폐기 | `beginRun` catch의 `revoke` | `markStarted`가 던진 뒤 토큰 무효 |
| 3 | `read_only`는 쓰기 도구 미등록 | `tools.ts`의 권한 분기 | `tools/list`에 `create_issue`가 없다 |
| 4 | 미등록 도구는 직접 호출도 거부 | (3과 같은 줄) | `read_only` 토큰의 `create_issue` 호출이 실패 |
| 5 | `get_issue`의 workspace 가드 | 공통 가드 | 다른 workspace 이슈가 안 보인다 |
| 6 | `update_issue`의 workspace 가드 | 공통 가드 | 다른 workspace 이슈가 안 바뀐다 |
| 7 | `get_memo`의 workspace 가드 | 공통 가드 | 대칭 |
| 8 | `update_memo`의 workspace 가드 | 공통 가드 | 대칭 |
| 9 | 토큰 없는 요청 거부 | 인증 검사 | 헤더 없이 → 401 |
| 10 | 모르는 토큰 거부 | 인증 검사 | 임의 문자열 → 401 |
| 11 | `--strict-mcp-config`가 붙는다 | 인자 push | `buildCommand` |
| 12 | 세 단계 모두 `mcp__onedesk` 승인 | 접두사 병합 | 권한별 3건 |
| 13 | 토큰이 인자에 안 나온다 | 파일 경로 대신 JSON 문자열 | args 전체를 이어붙여 토큰 문자열 부재 |
| 14 | 설정 파일이 `0600` | mode 인자 | 파일 모드 검사 |
| 15 | 설정 파일이 종료 시 지워진다 | 삭제 호출 | 존재 검사 |
| 16 | `ensureListening`이 멱등 | 기동 프로미스 캐시 | 동시 두 run이 포트 하나를 공유 |
| 17 | **`core/index.ts` → execution** | 전달 한 줄 | 통합: 실제 인자에 `--mcp-config`가 있다 |
| 18 | **execution → `manager.start`** | 전달 한 줄 | 같음 |
| 19 | **manager → `buildCommand`** | 전달 한 줄 | 같음 |
| 20 | `read_only`에 `--tools`가 붙는다 | 인자 push | 권한 테스트 |
| 21 | 어떤 단계에도 `ask` 없음 | (기존 유지) | 기존 테스트 |
| 22 | 서버 기동 실패 시 run이 failed | 실패 분기 | `ensureListening`이 거부하면 `startedAt`이 null인 failed |
| 23 | `resume`이 DB 장애를 뭉개지 않는다 | catch 좁히기 | DB 오류가 원본 메시지로 올라온다 |

---

## 10. 구현 순서

1. `core/mcp/host.ts` — 기동, 토큰 발급·인증·폐기 (도구 없이 401/404만)
2. `core/mcp/tools.ts` — 읽기 5개 + workspace 공통 가드
3. `core/mcp/tools.ts` — 쓰기 4개 + 권한별 등록
4. `core/mcp/configFile.ts` — `0600` 파일 작성과 삭제
5. `permission.ts` 교정 + `mcpToolPrefixes` 인자
6. 어댑터 `buildCommand`의 MCP 블록
7. 전달 사슬 — `core/index.ts` → execution → manager → adapter, 토큰 발급/폐기를 `launch`/`finish`/`beginRun`에 붙인다
8. `onError` 주입, `resume`의 catch 좁히기
9. e2e — 가짜 CLI가 실제 MCP 호출로 이슈를 만든다

1~4는 서로 독립적이고 5~7이 배선이다. **7이 이 단계에서 가장 조용히 깨지는 자리**이므로 여기서 통합 테스트를 함께 쓴다.
