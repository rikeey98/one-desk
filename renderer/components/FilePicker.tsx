import { useEffect, useRef } from 'react'
import { IconFile } from './icons'
import type { FileHit } from '@shared/models'

/**
 * `@` 파일 참조 피커 (docs/sdlc/input-triggers/ FR-2·FR-7). OpenCode Desktop의 모양이다 — 그룹 머리
 * `파일`, 줄마다 파일 아이콘 + 흐린 디렉토리 + 파일명. 미리보기는 없다.
 *
 * `CommandPicker`와 같은 방식으로 최상위 레이어(popover)에 뜨고 자리도 같은 anchor를 쓴다(`command-picker`
 * 클래스). 껍데기를 공유하지 않는 것은 `/` 피커의 DOM을 한 글자도 바꾸지 않기 위해서다(NFR-5).
 *
 * option의 접근성 이름은 **상대 경로 그대로**다(`aria-label`). 경로에는 id에 못 쓰는 글자가 있어 option id는
 * 순번으로 만든다.
 */
export function FilePicker({ id, optionId, files, selectedIndex, loading, reason, truncated, onPick }: {
  id: string
  optionId: (index: number) => string
  files: FileHit[]
  selectedIndex: number
  loading: boolean
  /** 파일을 못 찾는 이유(git 저장소가 아님 등). 있으면 목록 대신 보인다 */
  reason: string | null
  truncated: boolean
  onPick: (file: FileHit) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => { root.current?.togglePopover?.(true) }, [])

  return (
    <div className="command-picker file-picker" ref={root} popover="manual">
      <div className="command-picker-header">
        <span>파일 · ↑↓ 선택 · Enter/Tab 삽입 · Esc 닫기</span>
      </div>
      {loading && <div role="status">불러오는 중…</div>}
      {reason && <div role="alert">{reason}</div>}
      {!loading && !reason && files.length === 0 && <div role="status">일치하는 파일이 없습니다</div>}
      {truncated && <div role="status" className="file-picker-note">파일이 많아 일부에서만 찾습니다</div>}
      {files.length > 0 && <div className="file-picker-group" aria-hidden="true">파일</div>}
      <div role="listbox" id={id} aria-label="파일 참조">
        {files.map((file, index) => {
          const cut = file.path.lastIndexOf('/') + 1
          return (
            <button
              type="button"
              role="option"
              id={optionId(index)}
              aria-selected={selectedIndex === index}
              key={file.path}
              className="command-option file-option"
              // 이름을 명시한다 — 디렉토리와 파일명이 두 칸이라 접근성 계산이 사이에 공백을 넣을 수 있다
              // (jsdom 실측 `notes/ a.txt`). e2e는 이 이름을 exact로 잡는다.
              aria-label={file.path}
              title={file.path}
              ref={(node) => { if (selectedIndex === index) node?.scrollIntoView?.({ block: 'nearest' }) }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(file)}
            >
              <IconFile className="file-option-icon" />
              <span className="file-option-path">
                {cut > 0 && <span className="file-option-dir">{file.path.slice(0, cut)}</span>}
                <span className="file-option-name">{file.path.slice(cut)}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
