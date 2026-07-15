import { app, ipcMain } from 'electron'
import { APP_INFO_CHANNEL, type AppInfo } from '../../shared/ipc/appInfo'
import type { NavigationPolicyContext } from '../security/navigationPolicy'
import { isApprovedIpcSender } from '../security/senderValidation'

/**
 * Registers the single IPC handler that exists in Slice 2. It accepts no
 * arguments from the renderer and returns only static application
 * metadata already observable elsewhere — but it still validates the
 * sender frame before responding, to establish the pattern that later,
 * genuinely sensitive handlers will rely on.
 *
 * @param context - the same approved-target context used for navigation,
 *   so "who is allowed to call this" and "where is the app allowed to
 *   navigate" can never silently drift apart.
 */
export function registerAppInfoHandler(context: NavigationPolicyContext): void {
  ipcMain.handle(APP_INFO_CHANNEL, (event): AppInfo => {
    if (!isApprovedIpcSender(event, context)) {
      throw new Error('LedgerPage: rejected app-info request from an unapproved sender')
    }

    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform
    }
  })
}
