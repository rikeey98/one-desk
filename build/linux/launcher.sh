#!/bin/sh
# one-desk의 리눅스 실행 껍데기 (docs/sdlc/linux-launch-env/).
#
# electron-builder의 afterPack 훅(build/linux/afterPack.mjs)이 Electron 실행 파일을 `<이름>.bin`으로 옮기고 이 파일을 원래
# 이름으로 둔다 — AppImage의 AppRun은 `$APPDIR/<이름>`을 exec하므로 이것이 먼저 돈다.
#
# **Electron은 사용자의 LD_LIBRARY_PATH 없이 띄운다.** 그 값이 가리키는 폴더에 오래된 라이브러리가 있으면 Electron이 시작조차
# 못 한다 — 설계 도구가 들고 오는 libexpat 2.0이 먼저 잡혀 `symbol lookup error: … undefined symbol: XML_SetHashSalt`(RHEL에서
# 받은 보고, 2026-10-14). 사용자의 값은 ONE_DESK_ORIG_LD_LIBRARY_PATH에 남기고, 앱이 사용자 대신 띄우는 프로세스(claude·git·
# 터미널 셸)에는 core가 그 값을 되돌려 준다(core/runner/userEnv.ts). 표식은 늘 남긴다 — 빈 값은 "사용자가 두지 않았다"이다.
#
# AppRun은 LD_LIBRARY_PATH 앞에 "<AppDir>/usr/lib"을 붙여 이것을 부른다 — 그 앞자리만 떼면 사용자가 실행한 값이 글자 그대로
# 남는다(빈 칸 = 현재 디렉토리까지). AppRun 없이 불렸으면(linux-unpacked) 값 전체가 사용자의 것이다.
self=$(readlink -f "$0") || { echo "one-desk: 실행 파일의 위치를 알 수 없습니다: $0" >&2; exit 1; }
here=${self%/*}
orig=${LD_LIBRARY_PATH-}
for dir in "$here" "${APPDIR-}"; do
  [ -n "$dir" ] || continue
  case $orig in
    "$dir/usr/lib") orig=; break ;;
    "$dir/usr/lib:"*) orig=${orig#"$dir/usr/lib:"}; break ;;
  esac
done
ONE_DESK_ORIG_LD_LIBRARY_PATH=$orig
export ONE_DESK_ORIG_LD_LIBRARY_PATH
# AppImage가 넣어 둔 라이브러리(usr/lib)는 지금처럼 앞에 둔다 — 걷어 내는 것은 사용자의 값뿐이다.
if [ -d "$here/usr/lib" ]; then
  LD_LIBRARY_PATH=$here/usr/lib
  export LD_LIBRARY_PATH
else
  unset LD_LIBRARY_PATH
fi
exec "$self.bin" "$@"
