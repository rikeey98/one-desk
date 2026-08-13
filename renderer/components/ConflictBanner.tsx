/** agent와 사람이 같은 항목을 고쳤을 때 뜬다 (설계 §7). */
export function ConflictBanner({ onReload, onOverwrite }: {
  onReload: () => void
  onOverwrite: () => void
}) {
  return (
    <div role="alert" className="conflict-banner">
      <span>이 항목이 그 사이 바뀌었습니다.</span>
      <button type="button" onClick={onReload}>다시 불러오기</button>
      <button type="button" onClick={onOverwrite}>덮어쓰기</button>
    </div>
  )
}
