#!/bin/sh
# one-desk — WSL 안에서 agent·git·셸을 띄우는 런처 (docs/sdlc/wsl-support/ spec FR-10).
#
# 두 가지만 한다.
#   1. 새 프로세스 그룹을 만들고 그 id를 pidfile에 쓴다 — 취소가 `kill -- -<pgid>`로 트리째 끝내게(FR-18).
#      이미 그룹 리더가 아니면 setsid로 자기를 다시 띄운다(util-linux setsid는 리더가 아닐 때 fork 없이 exec한다).
#   2. 로그인 셸을 거쳐 명령을 exec한다 — `-l`이 ~/.profile의 PATH·환경변수를 읽는다. 인자는 셸 문자열에
#      끼지 않는다: `exec "$0" "$@"`로 그대로 간다(FR-33). 셸은 bash로 고정한다 — $SHELL이 fish·zsh면 문법이 다르다.
#
# stdin·stdout·stderr는 건드리지 않는다 — wsl.exe가 파이프를 그대로 잇고 claude의 JSON 스트림이 그 위로 흐른다.
#
# 쓰임: /bin/sh launcher.sh <pidfile> <cmd> [args...]
pidfile="$1"
shift
if [ "$(ps -o pgid= -p $$ | tr -d ' ')" != "$$" ]; then
  exec setsid /bin/sh "$0" "$pidfile" "$@"
fi
echo "$$" > "$pidfile"
exec bash -lc 'exec "$0" "$@"' "$@"
