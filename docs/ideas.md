# 아이디어 창고

떠오른 생각을 잊지 않게 던져 두는 곳이다. **할 일 목록이 아니다** — 하기로 정한 것도, 우선순위도 없다.
`docs/backlog.md`(하기로 했지만 아직 손대지 않은 작업)와 다르다. 꺼내 쓰기로 하면 백로그나
`docs/sdlc/<기능>/`로 옮기고 여기서는 지운다. 버리기로 한 것도 지운다.

항목마다 한 줄 요약, 떠오른 날, 그때 나눈 생각과 열린 질문만 적는다.

## 무한 캔버스 (tldraw 같은 flow 그리기) — 2026-09-30

자유롭게 그리고 잇는 보드를 앱 안에 둔다.

- 라이브러리 후보: Excalidraw(MIT), tldraw(v4부터 상용 배포에 라이선스 키 필요로 알고 있음 — 확인 안 함).
  어느 쪽이든 렌더러 번들이 1~2MB 는다.
- **열린 질문: agent와 연결되나?** 혼자 쓰는 화이트보드면 메모의 한 종류(보드 JSON 저장)로 끝난다.
  맥락에 담아 agent에 넘기거나 agent가 그려 주게 하려면 텍스트 변환·MCP 도구까지 필요해 몇 배 커진다.

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

## WSL2 안의 repo 지원 — 2026-10-12

Windows에서 WSL2 안의 폴더(`\\wsl.localhost\Ubuntu\home\...`)를 repo로 등록해 쓴다.

- 지금도 등록은 된다(경로 검사가 `statSync(...).isDirectory()`뿐이라 UNC 경로가 통과한다). 그러나 그 뒤는 전부
  **Windows 프로세스가 UNC cwd로 도는 것**이다 — agent는 WSL 안의 claude가 아니라 `claude.exe`, git도 Windows git이라
  9P 위에서 느리고 소유자가 달라 `dubious ownership`으로 `ls-files`가 거부될 수 있다(그러면 `@` 피커·파일 칸·코드 칸이 빈다).
  터미널은 pwsh가 UNC cwd에서 뜨고, 셸을 `wsl.exe`로 바꾸면 그 경로에서 bash가 뜰 것이다(실측 안 함).
- 제대로 하려면 "repo마다 WSL 안에서 띄운다"는 별도 설계다 — 실행 파일 탐색(`core/runner/executable.ts`)·spawn·
  taskkill·`git ls-files`·파일 읽기/쓰기·node-pty가 전부 Windows 프로세스 전제라, repo에 `wsl: { distro }` 같은
  속성을 두고 그 repo의 모든 프로세스를 `wsl.exe -d <distro> --cd <linux 경로>`로 감싸야 한다.
- **열린 질문**: 어디까지 WSL 안에서 돌리나? agent·git·셸만 WSL이고 파일 읽기/쓰기는 UNC로 두면 realpath 판정
  (`core/files/read.ts`)과 경로 표기(Linux `/home/...` vs UNC)가 갈린다. 취소(taskkill)는 `wsl.exe`만 죽이고 안의
  프로세스가 남을 수 있다 — Windows 트리 종료 함정과 같은 모양이다.
