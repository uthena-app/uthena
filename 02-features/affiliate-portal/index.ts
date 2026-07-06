// Public surface of the affiliate-portal feature module.
//
// P1.7 ships the placeholder SHELL — `AffiliateShell` +
// `AffiliateSidebarActive`. P13.3 Slice 1 ships the dashboard
// aggregator + the three KPI/header/banner components. P13.4
// ships the daily performance chart + its query. P13.5 Slice 1
// ships the link-generator surface — `DefaultLinkHero` +
// `AllLinksTable` + `LinksStatsRow` + the `CopyLinkButton` +
// `RefreshDefaultLinkButton` client islands + the
// `getMyAffiliateLinks` query + `ensureDefaultLinkAction`.

export { AffiliateShell } from './AffiliateShell'
export { AffiliateSidebarActive } from './AffiliateSidebarActive'
export { DashboardHeader } from './components/DashboardHeader'
export { OnboardingBanner } from './components/OnboardingBanner'
export { KpiCards } from './components/KpiCards'
export { PerformanceChart } from './components/PerformanceChart'
export { LinksStatsRow } from './components/LinksStatsRow'
export { DefaultLinkHero } from './components/DefaultLinkHero'
export { AllLinksTable } from './components/AllLinksTable'
export { CopyLinkButton } from './components/CopyLinkButton'
export { RefreshDefaultLinkButton } from './components/RefreshDefaultLinkButton'
export { LinkAnalyticsPanel } from './components/LinkAnalyticsPanel'
export { HourlyClicksChart } from './components/HourlyClicksChart'
export { GeoBreakdownList } from './components/GeoBreakdownList'
export { DeviceBreakdownList } from './components/DeviceBreakdownList'
export { MiniShopHero } from './components/MiniShopHero'
export { TrustStrip } from './components/TrustStrip'
export { FeaturedPick } from './components/FeaturedPick'
export { CuratedCollection } from './components/CuratedCollection'
export { AboutCard } from './components/AboutCard'
export { MiniShopFooter } from './components/MiniShopFooter'
export { MiniShopEmptyState } from './components/MiniShopEmptyState'
export { MiniShopEditLink } from './components/MiniShopEditLink'
export { SettingsHub } from './components/SettingsHub'
export { ProfileSection } from './components/ProfileSection'
export { NotificationsSection } from './components/NotificationsSection'
export { MiniShopPreview } from './components/MiniShopPreview'
export { getAffiliateDashboard } from './queries/getAffiliateDashboard'
export { getAffiliateDailyPerformance } from './queries/getAffiliateDailyPerformance'
export { getMyAffiliateLinks } from './queries/getMyAffiliateLinks'
export { getMiniShop } from './queries/getMiniShop'
export {
  getAffiliateHourlyClicks,
  getAffiliateGeoBreakdown,
  getAffiliateDeviceBreakdown,
} from './queries/getAffiliateLinkAnalytics'
export { getMyAffiliateSettings } from './queries/getMyAffiliateSettings'
export type {
  AffiliateSettings,
  AffiliateSettingsProfile,
  AffiliateSettingsPrefs,
  AffiliateSettingsStatus,
} from './queries/getMyAffiliateSettings'
export { ensureDefaultLinkAction } from './actions/links/ensureDefaultLinkAction'
export { updateAffiliateProfileAction } from './actions/settings/updateAffiliateProfileAction'
export { updateAffiliateNotificationPrefsAction } from './actions/settings/updateAffiliateNotificationPrefsAction'
export type {
  UpdateAffiliateProfileResult,
} from './actions/settings/updateAffiliateProfileAction'
export type {
  UpdateAffiliateNotificationPrefsResult,
} from './actions/settings/updateAffiliateNotificationPrefsAction'
export type {
  AffiliateRow,
  AffiliateProfile,
  AffiliateDefaultLink,
  AffiliateSummary,
  AffiliateDashboard,
} from './queries/getAffiliateDashboard'
export type {
  AffiliateDailyPerformancePoint,
} from './queries/getAffiliateDailyPerformance'
export type {
  AffiliateLinkRow,
  AffiliateLinksStats,
  MyAffiliateLinks,
} from './queries/getMyAffiliateLinks'
export type {
  AffiliateHourlyClicksPoint,
  AffiliateGeoBreakdownRow,
  AffiliateDeviceBreakdownRow,
} from './queries/getAffiliateLinkAnalytics'
export type {
  ShopAffiliate,
  ShopProfile,
  CuratedProduct,
  MiniShop,
} from './queries/getMiniShop'
export type {
  EnsureDefaultLinkResult,
} from './actions/links/ensureDefaultLinkAction'
