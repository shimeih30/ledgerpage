import { describe, expect, it } from 'vitest'
import { createMainWindowOptions } from '../../src/main/window/mainWindowOptions'

describe('createMainWindowOptions', () => {
  const options = createMainWindowOptions('/fake/preload/index.js')

  it('enables contextIsolation', () => {
    expect(options.webPreferences?.contextIsolation).toBe(true)
  })

  it('disables nodeIntegration', () => {
    expect(options.webPreferences?.nodeIntegration).toBe(false)
  })

  it('enables the renderer sandbox', () => {
    expect(options.webPreferences?.sandbox).toBe(true)
  })

  it('keeps webSecurity enabled', () => {
    expect(options.webPreferences?.webSecurity).toBe(true)
  })

  it('does not allow running insecure content', () => {
    expect(options.webPreferences?.allowRunningInsecureContent).toBe(false)
  })

  it('disables the webview tag', () => {
    expect(options.webPreferences?.webviewTag).toBe(false)
  })

  it('sets the preload script to exactly the path provided', () => {
    expect(options.webPreferences?.preload).toBe('/fake/preload/index.js')
  })

  it('does not show the window before it is ready', () => {
    expect(options.show).toBe(false)
  })
})
