#!/usr/bin/env bash
# 리눅스 패키지의 네이티브 모듈 둘(better-sqlite3·node-pty)을 glibc 2.28(RHEL 8) 위에서 다시 빌드한다 (docs/sdlc/linux-glibc-floor/).
# 릴리스 CI의 리눅스 빌드가 pnpm install 직후 manylinux_2_28 컨테이너(AlmaLinux 8 + gcc-toolset) 안에서 부른다 — 저장소를 같은
# 경로에 올리고(pnpm의 node_modules는 심볼릭 링크다) 러너의 Node를 읽기 전용으로 빌려 준다:
#
#   docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e NODE_DIR="$node_dir" \
#     -v "$PWD:$PWD" -w "$PWD" -v "$node_dir:$node_dir:ro" <manylinux_2_28 이미지> bash build/linux/build-native.sh
#
# 러너(ubuntu-latest)에서 컴파일한 것은 그 glibc에 링크돼 `GLIBC_2.34`를 요구하고(node-pty의 forkpty는 2.34에서 libutil에서 libc로
# 옮겨 왔다), better-sqlite3 13이 패키지에 품은 linux-x64 사전 빌드도 `GLIBC_2.34`·`GLIBCXX_3.4.29`라 RHEL 8(glibc 2.28,
# libstdc++ GCC 8)에서는 앱이 시작조차 못 한다. gcc-toolset은 시스템 libstdc++에 없는 것만 정적으로 넣으므로 여기서 만든 것은
# RHEL 8의 libstdc++로 돈다(GCC 8은 better-sqlite3의 `-std=c++20`을 모른다 — 툴셋이 필요한 이유다).
#
# 둘 다 N-API라 Node 헤더(--nodedir)로 빌드한 것이 Electron에서 그대로 돈다 — Electron 헤더도, 네트워크도 필요 없다.
set -euo pipefail

fail() { echo "build-native: $*" >&2; exit 1; }

node_dir=${NODE_DIR:?NODE_DIR — 공식 Node 설치 폴더(bin/node와 include/node가 있는 곳)를 주세요}
here=$(cd "$(dirname "$0")" && pwd)
[ -f package.json ] && [ -d node_modules ] || fail "저장소 루트(pnpm install을 마친 곳)에서 부르세요"
[ -f "$node_dir/include/node/node_api.h" ] || fail "$node_dir에 Node 헤더가 없습니다"
gyp=$node_dir/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js
[ -f "$gyp" ] || fail "npm에 딸린 node-gyp가 없습니다: $gyp"

export PATH="$node_dir/bin:$PATH"
# node-gyp는 python3를 쓴다 — manylinux 이미지의 시스템 python3(3.6)는 너무 오래됐다
for py in /opt/python/cp312-cp312/bin/python3 /opt/python/cp311-cp311/bin/python3; do
  if [ -x "$py" ]; then export PYTHON=$py; break; fi
done
echo "build-native: $(ldd --version | head -1) · $(g++ --version | head -1) · node $(node --version) · ${PYTHON:-python3}"

rebuild() {
  (cd "$1" && shift && node "$gyp" rebuild --release --nodedir="$node_dir" --jobs max "$@")
}

# better-sqlite3 — 진입점(lib/binding.js)이 prebuilds/<플랫폼>-<arch>.node를 build/Release보다 먼저 집으므로 그 자리를 갈아 끼운다.
# 패키지에 사전 빌드가 있으면 binding.gyp가 빌드를 건너뛰므로 force_build로 연다(패키지 자신의 build-release 스크립트와 같다).
bs3=$(cd node_modules/better-sqlite3 && pwd -P)
rebuild "$bs3" --force_build=1
# pnpm은 node_modules의 파일을 저장소에서 하드 링크한다 — 제자리에서 덮어쓰면 pnpm 저장소(CI가 캐시한다)의 원본까지 바뀐다.
rm -f "$bs3/prebuilds/linux-x64.node"
cp "$bs3/build/Release/better_sqlite3.node" "$bs3/prebuilds/linux-x64.node"
rm -rf "$bs3/build"

# node-pty — 진입점(lib/utils.js)이 build/Release를 먼저 본다. 리눅스에는 pty.node 하나뿐이다(spawn-helper는 macOS 것이다).
pty=$(cd node_modules/node-pty && pwd -P)
rebuild "$pty"
find "$pty/build" -mindepth 1 -maxdepth 1 ! -name Release -exec rm -rf {} +
find "$pty/build/Release" -mindepth 1 -maxdepth 1 ! -name pty.node -exec rm -rf {} +

bash "$here/check-glibc.sh" "$bs3/prebuilds/linux-x64.node" "$pty/build/Release/pty.node"
# 이 컨테이너가 곧 RHEL 8의 glibc·libstdc++다 — 여기서 뜨고 돌면 RHEL 8에서도 뜬다. 이미지가 LD_LIBRARY_PATH에 얹은
# gcc-toolset 폴더는 빼고 돌린다(RHEL 8 사용자에게는 없다).
env -u LD_LIBRARY_PATH node "$here/smoke-native.mjs" "$PWD/node_modules"
