// Public surface of the admin/platform-settings feature. The
// app/admin/dmca-agent and app/admin/settings routes import from
// `@features/admin/platform-settings`.

export {
  getPlatformSetting,
  getDmcaAgentForAdmin,
} from './queries/getPlatformSetting'
export type {
  PlatformSettingKey,
  PlatformSettingRow,
} from './queries/getPlatformSetting'

export { getPlatformSettingsGeneral } from './queries/getPlatformSettingsGeneral'
export type { PlatformSettingsGeneral } from './queries/getPlatformSettingsGeneral'

export { getPlatformSettingsFlags } from './queries/getPlatformSettingsFlags'
export type { FeatureFlag, FeatureFlags } from './lib/featureFlags'

export { getMaintenanceState } from './queries/getMaintenanceState'
export type { MaintenanceState } from './lib/maintenance'

export { updateDmcaAgentAction } from './actions/updateDmcaAgent'
export type { UpdateDmcaAgentResult } from './actions/updateDmcaAgent'

export { updatePlatformSettingsGeneralAction } from './actions/updatePlatformSettingsGeneral'
export type { UpdatePlatformSettingsGeneralResult } from './actions/updatePlatformSettingsGeneral'

export { updateMaintenanceAction } from './actions/updateMaintenanceAction'
export type { UpdateMaintenanceResult } from './actions/updateMaintenanceAction'

export {
  addPlatformFlagAction,
  updatePlatformFlagAction,
  removePlatformFlagAction,
} from './actions/updatePlatformSettingsFlags'
export type { UpdateFlagsResult } from './actions/updatePlatformSettingsFlags'

export { writePlatformSettingsAuditLog } from './actions/writePlatformSettingsAuditLog'

export { DmcaAgentForm } from './components/DmcaAgentForm'
export { GeneralSettingsForm } from './components/GeneralSettingsForm'
export { FeatureFlagsTab } from './components/FeatureFlagsTab'
export { MaintenanceToggle } from './components/MaintenanceToggle'

// P14.15 — Maintenance helpers re-exported for the middleware.
// `middleware.ts` imports from here so the Edge runtime can read
// the cookie + render the 503 page without a DB hit.
export {
  MAINTENANCE_COOKIE_ENABLED,
  MAINTENANCE_COOKIE_MESSAGE,
  MAINTENANCE_DEFAULT_MESSAGE,
  MAINTENANCE_PATH_EXEMPT_PREFIXES,
  formatMaintenanceMessage,
  parseMaintenanceEnabledCookie,
  parseMaintenanceMessageCookie,
} from './lib/maintenance'