import { stripRemoteFontSources } from '../../drawing/guards'

/**
 * Excalidraw를 불러오기 **전에** 돌아야 하는 것 둘 (docs/sdlc/drawings/ spec FR-29·FR-30). `DrawingCanvas`가 이 모듈을 Excalidraw보다
 * 먼저 import한다 — ESM은 import 순서대로 평가되고, Excalidraw는 모듈을 불러오는 순간 글꼴을 등록하며 그 주소를 만든다(plan 0단계 1).
 * 모듈 본문에서 대입하면 늦다.
 *
 * 1. 글꼴 주소 — 렌더러 산출물 안의 `excalidraw-assets/`(빌드가 복사한다, `build/viteExcalidrawAssets.ts`). **문서 주소 기준의 절대
 *    URL**이어야 한다: Excalidraw는 `./`·`/`로 시작하는 값을 `location.origin`으로 푸는데 file: 문서의 origin은 `"null"`이다. 해시
 *    (`#drawing/…`)는 URL 해석에서 버려진다.
 * 2. 원격 대체 글꼴 걷기 — Excalidraw는 글꼴마다 로컬 다음에 esm.sh를 원본으로 붙이고, Chromium은 그것을 등록할 때마다 CSP 위반으로
 *    알린다(그림 칸을 열 때마다 231줄, plan 0단계 3). `FontFace`의 원본 목록에서 그것만 걷는다 — 다른 원본은 그대로다.
 */
declare global {
  interface Window { EXCALIDRAW_ASSET_PATH?: string | string[] }
}

window.EXCALIDRAW_ASSET_PATH = new URL('excalidraw-assets/', document.baseURI).href

const NativeFontFace = window.FontFace
if (NativeFontFace && !(NativeFontFace as { oneDeskFiltered?: boolean }).oneDeskFiltered) {
  class FilteredFontFace extends NativeFontFace {
    static oneDeskFiltered = true
    constructor(family: string, source: string | BufferSource, descriptors?: FontFaceDescriptors) {
      super(family, typeof source === 'string' ? stripRemoteFontSources(source) : source, descriptors)
    }
  }
  window.FontFace = FilteredFontFace
}

export {}
