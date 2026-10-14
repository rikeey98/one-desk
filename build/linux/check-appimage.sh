#!/usr/bin/env bash
# 만들어진 AppImage가 사용자의 LD_LIBRARY_PATH에 깨지지 않고(docs/sdlc/linux-launch-env/) 배포판 하한 RHEL 8에서 도는지
# (docs/sdlc/linux-glibc-floor/) 본다. 릴리스 CI의 리눅스 빌드가 electron-builder 다음에 부른다 — afterPack 훅이나
# build-native.sh가 돌지 않아도 빌드는 초록이라 산출물로 확인하는 수밖에 없다.
#
#   bash build/linux/check-appimage.sh <AppImage 또는 풀어 둔 AppDir> [실행 파일 이름=one-desk]
#
# RHEL에서 받은 보고(2026-10-14)를 흉내낸다: 사용자의 LD_LIBRARY_PATH에 XML_SetHashSalt가 없는 오래된 libexpat이 있다. 이
# 장비의 libexpat을 복사해 그 이름 하나만 바꿔 만든다. 둘 다 AppRun이 넘기는 값("<AppDir>/usr/lib:<사용자의 값>")으로 띄운다.
# Electron은 ELECTRON_RUN_AS_NODE로 띄운다 — 화면 없이 로더를 전부 지난다.
#   1. 대조 — 진짜 실행 파일(<이름>.bin)을 v0.26.0의 AppRun처럼 바로 띄우면 보고와 같은 오류로 죽는다. 흉내가 효력이 있다는 증명이다.
#   2. 껍데기(<이름>)로 띄우면 앱이 usr/lib만 보고 뜨고, 사용자의 값을 표식으로 받는다. MCP 브리지도 앱이 뜬 값으로 <이름>.bin을
#      띄운다 — 그 배선은 core의 단위 테스트가 본다.
# 배포판 하한(RHEL 8 — docs/sdlc/linux-glibc-floor/)도 산출물로 본다. 러너는 glibc가 더 새것이라 여기서 뜨는 것만으로는 모른다.
#   3. 패키지의 모든 x86-64 ELF가 요구하는 glibc·libstdc++ 버전이 RHEL 8 안이다(check-glibc.sh). build-native.sh가 돌지 않았거나
#      의존성을 올려 더 새 glibc를 요구하게 되면(Electron 자신도 — 지금은 `GLIBC_2.25`) 여기서 걸린다.
#   4. 패키지의 Electron이 껍데기를 거쳐 better-sqlite3·node-pty를 불러 쓴다 — 컨테이너에서 Node 헤더로 빌드한 것이 Electron과 맞는다.
set -euo pipefail

fail() { echo "check-appimage: $*" >&2; exit 1; }

[ $# -ge 1 ] || fail "사용법: $0 <AppImage 또는 AppDir> [실행 파일 이름]"
here=$(cd "$(dirname "$0")" && pwd)
target=$(readlink -f "$1")
name=${2:-one-desk}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [ -d "$target" ]; then
  root=$target
else
  (cd "$work" && "$target" --appimage-extract >/dev/null) || fail "풀지 못했습니다: $target"
  root=$work/squashfs-root
fi

bin=$root/$name.bin
launcher=$root/$name
[ -x "$bin" ] || fail "$name.bin이 없습니다 — afterPack 훅(build/linux/afterPack.mjs)이 돌지 않았습니다"
[ "$(head -c 2 "$launcher")" = '#!' ] || fail "$name이 실행 껍데기가 아닙니다"
cmp -s "$launcher" "$here/launcher.sh" || fail "$name이 build/linux/launcher.sh와 다릅니다"

missing=$(LD_LIBRARY_PATH="$root/usr/lib" ldd "$bin" | grep 'not found' || true)
[ -z "$missing" ] || fail "이 장비에 Electron이 쓰는 라이브러리가 없습니다:
$missing"

ldconfig=$(command -v ldconfig || echo /sbin/ldconfig)
expat=$("$ldconfig" -p | awk '/libexpat\.so\.1 .*x86-64/ { print $NF; exit }')
[ -n "$expat" ] || fail "이 장비에서 libexpat.so.1을 찾지 못했습니다"
old=$work/old-expat
mkdir "$old"
cp "$(readlink -f "$expat")" "$old/libexpat.so.1"
python3 - "$old/libexpat.so.1" <<'PY'
import sys
path = sys.argv[1]
data = bytearray(open(path, 'rb').read())
needle = b'XML_SetHashSalt\x00'
at = data.find(needle)
assert at > 0 and data.find(needle, at + 1) < 0, 'XML_SetHashSalt가 정확히 한 번 있어야 합니다'
data[at:at + len(needle)] = b'XML_SetHashSalX\x00'
open(path, 'wb').write(data)
PY

apprun="$root/usr/lib:$old"

# 1. 대조
if out=$(LD_LIBRARY_PATH=$apprun ELECTRON_RUN_AS_NODE=1 "$bin" -e 0 2>&1); then
  fail "대조가 떴습니다 — 흉내낸 libexpat이 효력이 없어 이 확인은 아무것도 보지 못합니다"
fi
grep -q 'XML_SetHashSalt' <<<"$out" || fail "대조가 다른 이유로 죽었습니다: $out"
echo "1. 대조: 껍데기 없이는 뜨지 못한다 — ${out%%$'\n'*}"

# 2. 껍데기
got=$(LD_LIBRARY_PATH=$apprun ELECTRON_RUN_AS_NODE=1 "$launcher" \
  -e 'process.stdout.write(JSON.stringify([process.env.LD_LIBRARY_PATH, process.env.ONE_DESK_ORIG_LD_LIBRARY_PATH]))') \
  || fail "껍데기로도 뜨지 못했습니다"
want="[\"$root/usr/lib\",\"$old\"]"
[ "$got" = "$want" ] || fail "껍데기가 넘긴 값이 다릅니다: $got (기대: $want)"
echo "2. 껍데기: 앱은 usr/lib만 보고 뜨고, 사용자의 값은 표식으로 받는다"

# 3. 배포판 하한
bash "$here/check-glibc.sh" "$root" || fail "패키지가 RHEL 8(glibc 2.28)에서 시작하지 못합니다 — build/linux/build-native.sh가 돌았는지 보세요"
echo "3. 하한: 패키지의 실행 파일과 네이티브 모듈이 RHEL 8의 glibc·libstdc++ 안이다"

# 4. 네이티브 모듈
LD_LIBRARY_PATH=$apprun ELECTRON_RUN_AS_NODE=1 "$launcher" "$here/smoke-native.mjs" "$root/resources/app.asar.unpacked/node_modules" ||
  fail "패키지의 Electron이 네이티브 모듈을 불러 쓰지 못했습니다"
echo "4. 네이티브 모듈: 패키지의 Electron이 better-sqlite3·node-pty를 불러 쓴다"
