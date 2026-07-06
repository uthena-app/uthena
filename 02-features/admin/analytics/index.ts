// Barrel for the admin analytics feature module (P14.16).
//
// Slice 1 ships the schema foundation (analytics_daily table) + the
// 6-KPI read surface + URL-driven range picker + audit-log writer.
// Charts, top-10 lists, funnel, cohort grid, and CSV exports land in
// Slices 2-5 (filed as STUB-127).

export * from './types'
export { getAnalyticsKpi, aggregateKpi } from './queries/getAnalyticsKpi'
export { writeAnalyticsViewAuditLog } from './actions/writeAnalyticsViewAuditLog'
export { AnalyticsKpiCards } from './components/AnalyticsKpiCards'
export { AnalyticsRangePicker } from './components/AnalyticsRangePicker'