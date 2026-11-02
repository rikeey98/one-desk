import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, normalize, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'

/**
 * Excalidraw의 글꼴을 앱에 싣는다 (`docs/sdlc/drawings/` spec FR-29).
 *
 * Excalidraw는 글꼴을 `window.EXCALIDRAW_ASSET_PATH` + `fonts/…`에서 받고, 그 값이 없으면 `https://esm.sh/…`에서 받는다 — 앱의 CSP가
 * 그것을 막고 앱은 오프라인에서도 돌아야 한다. 글꼴은 import가 아니라 문자열 경로라 번들러가 따라가지 못하므로 폴더째 옮긴다.
 * 개발 서버는 같은 경로를 node_modules에서 바로 주고, 빌드는 렌더러 산출물 안으로 복사한다.
 *
 * 복사는 `readdirSync` + `copyFileSync`다 — `fs.cpSync`는 Windows의 Node 22에서 원본 경로에 한글이 있으면 프로세스째 죽는다(CLAUDE.md).
 */
export const EXCALIDRAW_ASSET_DIR = 'excalidraw-assets'

function copyDir(from: string, to: string): number {
  mkdirSync(to, { recursive: true })
  let count = 0
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name)
    const dst = join(to, entry.name)
    if (entry.isDirectory()) count += copyDir(src, dst)
    else if (entry.isFile()) { copyFileSync(src, dst); count += 1 }
  }
  return count
}

export function excalidrawAssets(): Plugin {
  const fonts = resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts')
  let outDir = ''
  return {
    name: 'one-desk-excalidraw-assets',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use(`/${EXCALIDRAW_ASSET_DIR}/fonts/`, (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0] ?? '').replace(/^\/+/, '')
        const file = normalize(join(fonts, rel))
        // 글꼴 폴더 밖(`..`)은 주지 않는다
        if (!file.startsWith(fonts + sep) || !existsSync(file) || !statSync(file).isFile()) { next(); return }
        res.setHeader('Content-Type', 'font/woff2')
        createReadStream(file).pipe(res)
      })
    },
    writeBundle() {
      if (!existsSync(fonts)) throw new Error(`Excalidraw 글꼴 폴더가 없습니다: ${fonts}`)
      copyDir(fonts, join(outDir, EXCALIDRAW_ASSET_DIR, 'fonts'))
    }
  }
}
