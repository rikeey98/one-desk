/**
 * agent CLI를 한 번 띄워 출력만 받아오는 통로.
 *
 * **주입받는 이음매다.** 실제 구현은 `exec.ts`에 있고, 테스트는 이 함수를 스텁으로
 * 갈아끼운다 — 그래야 `claude auth logout`을 실제로 하지 않고도 "로그인 안 됨"
 * 화면을 검증할 수 있다(spec 수용 기준 2).
 */
export type RunCli = (input: {
  executable: string
  args: string[]
  timeoutMs?: number
}) => Promise<CliOutput>

export interface CliOutput {
  /** 프로세스 종료 코드. 띄우지 못했으면 null */
  code: number | null
  stdout: string
  stderr: string
  /** 띄우지 못했거나 시간이 초과된 경우의 사유. 정상 종료면 null */
  failure: string | null
}
