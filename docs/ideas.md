# 아이디어 창고

떠오른 생각을 잊지 않게 던져 두는 곳이다. **할 일 목록이 아니다** — 하기로 정한 것도, 우선순위도 없다.
`docs/backlog.md`(하기로 했지만 아직 손대지 않은 작업)와 다르다. 꺼내 쓰기로 하면 백로그나
`docs/sdlc/<기능>/`로 옮기고 여기서는 지운다. 버리기로 한 것도 지운다.

항목마다 한 줄 요약, 떠오른 날, 그때 나눈 생각과 열린 질문만 적는다.

## 기간 정리 ("이번 주에 뭐 했나") — 2026-09-30

특정 기간 동안 한 일을 정리해 받는다.

- 이슈·메모·대화는 이미 workspace 단위라 v0.18.0의 `since`·`until`·`list_conversations`로 repo를 가로질러 볼 수 있다.
- 빈 것은 **커밋** — MCP `list_commits(since, until)`로 앱이 workspace의 repo마다 `git log`를 돌려 합쳐 주는 안.
  작성자는 내 git 이메일로 거른다.

## workspace 공통 대화 — 2026-09-30

repo 하나를 고르지 않고 workspace 전체를 두고 여는 대화. 기간 정리를 시킬 자리가 지금은 없다
(대화는 작업 디렉토리로 repo를 반드시 골라야 한다).

- 안: 작업 디렉토리를 앱이 관리하는 폴더(`userData/workspaces/<id>/`)로, 실행 패널에 `workspace 전체` 선택지.
  필요하면 repo들을 claude의 `--add-dir`로 얹는다.
- workspace끼리 가로지르는 것(회사 + 개인)은 반대 — workspace가 데이터를 가르는 유일한 경계다.

## 대화 내내 떠 있는 agent 프로세스 — 2026-11-16

지금은 지시마다 claude를 새로 띄우고 앞의 것이 끝나야 다음 것을 띄운다. 그래서 agent가 백그라운드 작업을
돌려 두면 그것이 끝날 때까지 다음 지시가 막힌다(`docs/sdlc/background-wait/`). 일반 Claude Code는 창이
열려 있어 바로 다음 말을 걸 수 있다.

- 안: 대화마다 프로세스 하나를 `--input-format stream-json`으로 띄워 두고 지시를 stdin으로 넣는다.
- 걸리는 것: run = 프로세스 하나라는 전제(성패 판정·슬롯·취소·`reapStale`)가 전부 바뀐다.
