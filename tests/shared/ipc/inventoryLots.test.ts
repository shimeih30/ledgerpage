import { describe, expect, it } from 'vitest'
import * as inventoryLotsContract from '../../../src/shared/ipc/inventoryLots'

/**
 * A dedicated structural test against the shared contract module
 * itself (src/shared/ipc/inventoryLots.ts) -- distinct from
 * registerInventoryLotHandlers.test.ts's own "no mutation channel
 * registered" check and noDatabaseAccess.test.ts's own "no mutation
 * preload/global method" check, both of which test downstream
 * consumers of this module rather than the module's own exports
 * directly.
 */
describe('shared/ipc/inventoryLots.ts contract', () => {
  const EXPECTED_CHANNEL_VALUES = [
    'inventory-lots:list-for-item',
    'inventory-lots:get',
    'inventory-lots:list-movements',
    'stock:list-summaries',
    'stock:get-summary'
  ]

  it('exports exactly 5 channel constants, all read-shaped', () => {
    const exportedChannelValues = Object.entries(inventoryLotsContract)
      .filter(([name]) => name.endsWith('_CHANNEL'))
      .map(([, value]) => value)

    expect(exportedChannelValues).toHaveLength(5)
    expect(exportedChannelValues.sort()).toEqual([...EXPECTED_CHANNEL_VALUES].sort())
  })

  it('no exported channel constant name or value suggests a mutation', () => {
    const channelEntries = Object.entries(inventoryLotsContract).filter(([name]) =>
      name.endsWith('_CHANNEL')
    )
    for (const [name, value] of channelEntries) {
      expect(name).not.toMatch(
        /CREATE|RECORD|ADJUST|RESERVE|RELEASE|REVERSE|CONSUME|QUARANTINE|ACTIVATE|UPDATE|DELETE|MUTATE/
      )
      expect(String(value)).not.toMatch(
        /create|record|adjust|reserve|release|reverse|consume|quarantine|activate|update|delete|mutate/i
      )
    }
  })

  it('exports no LedgerPageInventoryLotsApi method matching a mutation-shaped name', () => {
    // LedgerPageInventoryLotsApi is a type-only export (erased at
    // runtime), so this is enforced structurally by
    // registerInventoryLotHandlers.ts/preload/index.ts actually
    // implementing that interface -- confirmed here by checking the
    // module's own runtime exports contain no mutation-named function
    // at all, type-only or otherwise.
    const runtimeExportNames = Object.keys(inventoryLotsContract)
    for (const name of runtimeExportNames) {
      if (name.endsWith('_CHANNEL')) {
        continue
      }
      expect(name).not.toMatch(
        /^(createOpeningLot|recordReceipt|recordAdjustment|reserveStock|releaseReservation|reverseMovement|consumeStock|setLotQuarantined|setLotActive|updateInventoryLot|deleteInventoryLot|updateStockMovement|deleteStockMovement)$/
      )
    }
  })

  it('does not export any of the 13 explicitly prohibited mutation function names', () => {
    const runtimeExportNames = Object.keys(inventoryLotsContract)
    const prohibited = [
      'createOpeningLot',
      'recordReceipt',
      'recordAdjustment',
      'reserveStock',
      'releaseReservation',
      'reverseMovement',
      'consumeStock',
      'setLotQuarantined',
      'setLotActive',
      'updateInventoryLot',
      'deleteInventoryLot',
      'updateStockMovement',
      'deleteStockMovement'
    ]
    for (const name of prohibited) {
      expect(runtimeExportNames).not.toContain(name)
    }
  })
})
