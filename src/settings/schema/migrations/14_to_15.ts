import { SettingMigration } from '../setting.types'

/**
 * Migration from version 14 to version 15
 * - Add insightsOptions: configuration for the insights sidebar, which
 *   surfaces passages related to the note being read or written.
 */
export const migrateFrom14To15: SettingMigration['migrate'] = (data) => {
  const newData = { ...data }
  newData.version = 15

  if (newData.insightsOptions === undefined) {
    newData.insightsOptions = {
      liveUpdate: true,
      debounceMs: 1500,
      maxResults: 5,
      hideLinkedNotes: true,
      excludePatterns: [],
      createBlockIds: false,
    }
  }

  return newData
}
