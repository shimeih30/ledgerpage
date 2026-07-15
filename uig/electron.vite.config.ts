import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// NOTE: externalizeDepsPlugin() alone does not reliably externalize the
// 'electron' module under the installed Vite/Rolldown version — it was
// observed bundling the npm 'electron' launcher package (Node-side binary
// path resolution) in place of Electron's runtime-provided API, which
// silently breaks contextBridge/app/BrowserWindow at runtime. 'electron',
// node: builtins, and better-sqlite3 (a native module, which must never
// be bundled — it ships a compiled .node binary resolved at runtime via
// node_modules, not something a JS bundler can inline) are externalized
// explicitly below as a safeguard.
const externalForElectronRuntime = [/^electron$/, /^node:/, /^better-sqlite3$/]

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: externalForElectronRuntime,
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: externalForElectronRuntime,
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    }
  }
})
