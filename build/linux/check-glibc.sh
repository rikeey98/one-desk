#!/usr/bin/env bash
# 주어진 파일·폴더 안의 x86-64 ELF가 요구하는 glibc·libstdc++ 버전이 리눅스 배포판 하한(RHEL 8) 안인지 본다
# (docs/sdlc/linux-glibc-floor/). build-native.sh가 다시 빌드한 직후에, check-appimage.sh가 패키지 전체에 부른다.
#
#   bash build/linux/check-glibc.sh <파일 또는 폴더>...
#
# 하한은 RHEL 8이다 — glibc 2.28, libstdc++는 GCC 8.5의 것(GLIBCXX_3.4.25·CXXABI_1.3.11). 약한 참조(WEAK)는 없어도 로더가
# 멈추지 않으므로 세지 않는다(Electron 실행 파일이 `GLIBC_2.18`을 약하게 요구한다). 다른 아키텍처의 ELF(better-sqlite3가 품은
# linux-arm64 사전 빌드)는 이 패키지에서 로드되지 않으므로 건너뛴다.
set -euo pipefail

CEILING=(GLIBC_2.28 GLIBCXX_3.4.25 CXXABI_1.3.11)

fail() { echo "check-glibc: $*" >&2; exit 1; }
[ $# -ge 1 ] || fail "사용법: $0 <파일 또는 폴더>..."

# 강한 참조마다 한 줄: "<가족>\t<버전>\t<파일>"
needs() {
  readelf -V --wide "$1" | awk -v file="$1" -v OFS='\t' '
    /^Version [a-z]+ section/ { inneed = ($2 == "needs") }
    inneed && /Name: (GLIBC|GLIBCXX|CXXABI)_[0-9.]+/ && !/Flags: WEAK/ {
      for (i = 1; i <= NF; i++) if ($i == "Name:") { split($(i + 1), v, "_"); print v[1], v[2], file }
    }'
}

all=$(mktemp)
trap 'rm -f "$all"' EXIT
count=0
while IFS= read -r -d '' f; do
  # ELF(7f 45 4c 46)이고 e_machine(18번째 바이트부터 2바이트, little-endian)이 x86-64(0x3e)인 것만
  [ "$(od -An -tx1 -N4 "$f" | tr -d ' \n')" = 7f454c46 ] || continue
  [ "$(od -An -tx1 -j18 -N2 "$f" | tr -d ' \n')" = 3e00 ] || continue
  needs "$f" >>"$all"
  count=$((count + 1))
done < <(find "$@" -type f -size +63c -print0)
[ "$count" -gt 0 ] || fail "x86-64 ELF를 하나도 찾지 못했습니다: $*"

bad=0
for limit in "${CEILING[@]}"; do
  family=${limit%_*}
  max=${limit#*_}
  top=$(awk -F'\t' -v f="$family" '$1 == f { print $2 }' "$all" | sort -V | tail -1)
  echo "check-glibc: ${family} 최고 요구 ${top:-없음} (하한 ${max})"
  over=$(awk -F'\t' -v f="$family" '$1 == f { print $2 "\t" $3 }' "$all" | sort -u |
    while IFS=$'\t' read -r ver file; do
      [ "$(printf '%s\n%s\n' "$ver" "$max" | sort -V | tail -1)" = "$max" ] || echo "  ${family}_${ver}  ${file}"
    done)
  if [ -n "$over" ]; then
    echo "check-glibc: ${limit}보다 높은 것을 요구합니다 — RHEL 8에서 시작하지 못합니다:" >&2
    echo "$over" >&2
    bad=1
  fi
done
[ "$bad" -eq 0 ] || exit 1
echo "check-glibc: x86-64 ELF ${count}개가 RHEL 8(glibc 2.28) 안에서 돈다"
