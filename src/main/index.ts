import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

// NOTE: This is the Slice 1 minimal window setup. It exists only to prove the
// app launches and renders a static screen. Slice 2 replaces this with the
// hardened configuration (explicit webPreferences, CSP, navigation
// restrictions, preload allow-list) required before any real capability is
// exposed to the renderer.

function createMainWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
