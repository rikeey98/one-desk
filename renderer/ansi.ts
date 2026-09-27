/**
 * 터미널 제어열 걷기 (`docs/sdlc/conversation-events/` spec FR-43).
 *
 * **화면에서만 걷는다.** 로그와 이벤트의 출력은 CLI가 준 그대로다 — 무엇을 보였는지를 나중에
 * 다시 보려면 원문이 남아야 한다. 셸 출력 블록이 그리기 직전에 부른다.
 *
 * 색·커서(CSI), 창 제목·하이퍼링크(OSC), DCS·PM·APC 문자열, 문자 집합 지정 같은 두세 글자
 * escape, 8비트 CSI를 걷는다. 줄바꿈·탭·`\r`은 제어열이 아니라 글자라 그대로 둔다.
 */

const ESC = '\\u001b'
/** 문자열 끝(ST) — `ESC \` */
const ST = `${ESC}\\\\`

/**
 * **문자열 본문에는 ESC가 없다**(OSC는 BEL도). 본문을 `[\s\S]*?`로 두면 끝나지 않은 시작점마다 입력
 * 끝까지 훑은 뒤 실패해 제곱 시간이 된다 — `ESC ]`를 3만 번 반복한 65,536자 출력에 약 0.6초(리뷰 반영
 * 2026-09-27). 도구 출력은 신뢰할 수 없는 입력이고 펼친 셸 줄은 도는 턴에서 매초 다시 그려진다. 본문이
 * 다음 ESC에서 멈추면 선형이고, 터미널도 문자열 안의 ESC에서 문자열을 끝낸다. 끝나지 않은 머리는
 * 아래의 두 글자 escape가 걷는다.
 */
const PATTERN = new RegExp(
  [
    // OSC: ESC ] … (BEL | ST) — 창 제목, OSC 8 하이퍼링크
    `${ESC}\\][^\\u001b\\u0007]*(?:\\u0007|${ST})`,
    // DCS·SOS·PM·APC: ESC P|X|^|_ … ST
    `${ESC}[PX^_][^\\u001b]*${ST}`,
    // CSI: ESC [ 매개변수 중간 글자 끝 글자 — 색(SGR)·커서 이동·지우기
    `${ESC}\\[[0-?]*[ -/]*[@-~]`,
    // 8비트 CSI
    `\\u009b[0-?]*[ -/]*[@-~]`,
    // 중간 글자가 있는 escape — 문자 집합 지정 ESC ( B
    `${ESC}[ -/]+[0-~]`,
    // 두 글자 escape — ESC 7, ESC =, ESC c …
    `${ESC}[0-~]`,
    // 끝에서 잘려 짝이 없는 ESC
    ESC
  ].join('|'),
  'g'
)

export function stripAnsi(text: string): string {
  return text.replace(PATTERN, '')
}
