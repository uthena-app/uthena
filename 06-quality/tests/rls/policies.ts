// The policy-list fixture — every (table, operation, role, expect)
// combination the RLS test framework verifies.
//
// **How this is structured.** Every entry maps to a single
// RLS-policy `create policy` statement somewhere in
// `04-platform/migrations/`. The `note` field carries the policy
// name + a one-line summary; the runner's report prints the note
// so a future reader can trace the test back to the SQL.
//
// **Coverage strategy.** For each table the migration creates, the
// fixture covers the FOUR most security-critical cases:
//   1. **anon read** — should almost always be deny; tables with
//      a public_read policy test allow.
//   2. **customer read of own** — should be allow; tests the
//      "self can read own row" guarantee.
//   3. **customer write** — should be deny; tests the "customers
//      don't write to platform tables" guarantee.
//   4. **admin all** — should be allow; tests the "admin can do
//      anything" guarantee.
//
// Tables with more nuanced policies (products published vs draft,
// partner-owns-product, append-only ledgers) get additional rows.
// The fixture is intentionally not exhaustive — it covers the
// invariants that matter for security, not every (role × op)
// combination.
//
// **Out of scope for the fixture (deferred to the live runner).**
// Per-row filters (e.g. "customer can read own cart_items row but
// not another customer's") are exercised at runtime by the seed
// data + the live runner's `filter` field. The fixture records
// the filter as a string but doesn't try to encode it as data —
// the live runner is the only place that needs the typed shape.

import type { RlsPolicyTest } from './types'

/** Tables with a public-read policy (anon can SELECT). */
const PUBLIC_READ: readonly string[] = [
  'categories',
  'products', // partial: only status='published'
  'product_files', // partial: only published
  'product_assets', // partial: only published
  'product_pricing',
  'coupons', // partial: only active
  'platform_settings', // partial: only public keys
  'collections',
]

/** Tables that are admin-only (no public read, no self read). */
const ADMIN_ONLY: readonly string[] = [
  'admin_audit_log',
  'partner_admin_notes',
  'affiliate_admin_notes',
  'customer_admin_notes',
  'risk_signals',
  'reports',
  'dmca_takedowns',
]

/** Tables that are append-only (no UPDATE/DELETE policies). */
const APPEND_ONLY: readonly string[] = [
  'admin_audit_log',
  'payout_ledger',
  'file_downloads',
  'processed_webhooks',
]

/** Tables where the user can read their own row. */
const SELF_READ: readonly string[] = [
  'profiles',
  'cart_items',
  'orders',
  'order_items',
  'refunds',
  'library_grants',
  'notification_preferences',
  'api_tokens',
]

/** The canonical policy fixture. */
export const ALL_RLS_POLICIES: readonly RlsPolicyTest[] = [
  // ─── profiles ──────────────────────────────────────────────
  {
    table: 'profiles',
    operation: 'select',
    as: 'anon',
    expect: 'deny',
    note: 'profiles: anon cannot read profile rows (PII protection)',
  },
  {
    table: 'profiles',
    operation: 'select',
    as: 'authenticated_customer',
    expect: 'allow',
    filter: '{ user_id: "<self>" }',
    note: 'profiles: customer can read own profile (profiles_self_read mirror via public_read)',
  },
  {
    table: 'profiles',
    operation: 'select',
    as: 'authenticated_partner',
    expect: 'allow',
    filter: '{ user_id: "<self>" }',
    note: 'profiles: partner can read own profile',
  },
  {
    table: 'profiles',
    operation: 'update',
    as: 'authenticated_customer',
    expect: 'allow',
    filter: '{ user_id: "<self>" }',
    note: 'profiles: customer can update own profile (profiles_self_update)',
  },
  {
    table: 'profiles',
    operation: 'update',
    as: 'authenticated_partner',
    expect: 'deny',
    filter: '{ user_id: "<other>" }',
    note: 'profiles: partner cannot update another user profile',
  },
  {
    table: 'profiles',
    operation: 'update',
    as: 'authenticated_customer',
    expect: 'deny',
    filter: '{ user_id: "<self>", role: "admin" }',
    note: 'profiles: customer cannot self-promote to admin (profiles_lock_role trigger, SEC-1) — profiles_self_update gates the row but not the column, so the BEFORE UPDATE trigger from 0066_lock_profile_role.sql is the actual gate here',
  },
  {
    table: 'profiles',
    operation: 'update',
    as: 'authenticated_customer',
    expect: 'deny',
    filter: '{ user_id: "<self>", status: "suspended" }',
    note: 'profiles: customer cannot self-unsuspend / self-change status (profiles_lock_role trigger, SEC-1)',
  },
  {
    table: 'profiles',
    operation: 'update',
    as: 'authenticated_admin',
    expect: 'allow',
    filter: '{ role: "admin" }',
    note: 'profiles: admin CAN change role/status on any row (profiles_lock_role trigger explicitly allows is_admin())',
  },
  {
    table: 'profiles',
    operation: 'delete',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'profiles: customer cannot delete profiles (use delete_my_account RPC)',
  },
  {
    table: 'profiles',
    operation: 'select',
    as: 'authenticated_admin',
    expect: 'allow',
    note: 'profiles: admin can read all (profiles_admin_all)',
  },
  {
    table: 'profiles',
    operation: 'delete',
    as: 'authenticated_admin',
    expect: 'allow',
    note: 'profiles: admin can delete (profiles_admin_all)',
  },
  {
    table: 'profiles',
    operation: 'select',
    as: 'service_role',
    expect: 'allow',
    note: 'profiles: service role bypasses RLS (negative control)',
  },

  // ─── partners ──────────────────────────────────────────────
  {
    table: 'partners',
    operation: 'select',
    as: 'anon',
    expect: 'deny',
    filter: '{ status: "pending" }',
    note: 'partners: anon cannot read pending partner rows',
  },
  {
    table: 'partners',
    operation: 'select',
    as: 'anon',
    expect: 'allow',
    filter: '{ status: "approved" }',
    note: 'partners: anon can read approved partner profiles (partners_public_read_approved)',
  },
  {
    table: 'partners',
    operation: 'update',
    as: 'authenticated_partner',
    expect: 'allow',
    filter: '{ user_id: "<self>" }',
    note: 'partners: partner can update own partner row (partners_self_update)',
  },
  {
    table: 'partners',
    operation: 'update',
    as: 'authenticated_partner_other',
    expect: 'deny',
    note: 'partners: partner cannot update another partner row',
  },
  {
    table: 'partners',
    operation: 'insert',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'partners: customers cannot create partner rows (admin-only)',
  },
  {
    table: 'partners',
    operation: 'select',
    as: 'authenticated_admin',
    expect: 'allow',
    note: 'partners: admin can read all (partners_admin_all)',
  },

  // ─── affiliates ────────────────────────────────────────────
  {
    table: 'affiliates',
    operation: 'select',
    as: 'anon',
    expect: 'deny',
    filter: '{ status: "pending" }',
    note: 'affiliates: anon cannot read pending affiliate rows',
  },
  {
    table: 'affiliates',
    operation: 'update',
    as: 'authenticated_affiliate',
    expect: 'allow',
    filter: '{ user_id: "<self>" }',
    note: 'affiliates: affiliate can update own affiliate row (affiliates_self_update)',
  },
  {
    table: 'affiliates',
    operation: 'insert',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'affiliates: customers cannot self-create affiliate rows (admin-only)',
  },

  // ─── categories ────────────────────────────────────────────
  {
    table: 'categories',
    operation: 'select',
    as: 'anon',
    expect: 'allow',
    note: 'categories: anon can read (categories_public_read)',
  },
  {
    table: 'categories',
    operation: 'insert',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'categories: customer cannot create categories (admin-only via categories_admin_write)',
  },
  {
    table: 'categories',
    operation: 'update',
    as: 'authenticated_admin',
    expect: 'allow',
    note: 'categories: admin can update (categories_admin_write)',
  },
  {
    table: 'categories',
    operation: 'delete',
    as: 'authenticated_partner',
    expect: 'deny',
    note: 'categories: partners cannot delete categories',
  },

  // ─── products ──────────────────────────────────────────────
  {
    table: 'products',
    operation: 'select',
    as: 'anon',
    expect: 'allow',
    filter: '{ status: "published" }',
    note: 'products: anon can read published products (products_public_read_published)',
  },
  {
    table: 'products',
    operation: 'select',
    as: 'anon',
    expect: 'deny',
    filter: '{ status: "draft" }',
    note: 'products: anon cannot read draft products (RLS filter excludes drafts)',
  },
  {
    table: 'products',
    operation: 'select',
    as: 'authenticated_partner',
    expect: 'allow',
    filter: '{ partner_id: "<self>" }',
    note: 'products: partner can read own products in any status (products_partner_read_own)',
  },
  {
    table: 'products',
    operation: 'select',
    as: 'authenticated_partner_other',
    expect: 'deny',
    filter: '{ partner_id: "<other>", status: "draft" }',
    note: 'products: partner cannot read other partner draft products',
  },
  {
    table: 'products',
    operation: 'update',
    as: 'authenticated_partner',
    expect: 'allow',
    filter: '{ partner_id: "<self>" }',
    note: 'products: partner can update own products (products_partner_write_own)',
  },
  {
    table: 'products',
    operation: 'update',
    as: 'authenticated_partner_other',
    expect: 'deny',
    filter: '{ partner_id: "<other>" }',
    note: 'products: partner cannot update other partner products',
  },
  {
    table: 'products',
    operation: 'insert',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'products: customers cannot create products (partners/admin only)',
  },
  {
    table: 'products',
    operation: 'delete',
    as: 'authenticated_partner',
    expect: 'deny',
    filter: '{ partner_id: "<self>" }',
    note: 'products: partner cannot delete own products (soft-delete via status=archived)',
  },
  {
    table: 'products',
    operation: 'select',
    as: 'authenticated_admin',
    expect: 'allow',
    note: 'products: admin can read all (products_admin_all)',
  },

  // ─── product_files ─────────────────────────────────────────
  {
    table: 'product_files',
    operation: 'select',
    as: 'anon',
    expect: 'deny',
    note: 'product_files: anon cannot read file rows (no public_read)',
  },
  {
    table: 'product_files',
    operation: 'select',
    as: 'authenticated_partner',
    expect: 'allow',
    filter: '{ product.partner_id: "<self>" }',
    note: 'product_files: partner can read own product files (product_files_partner_read_own)',
  },
  {
    table: 'product_files',
    operation: 'update',
    as: 'authenticated_partner_other',
    expect: 'deny',
    note: 'product_files: partner cannot update other partner files',
  },
  {
    table: 'product_files',
    operation: 'insert',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'product_files: customers cannot upload files',
  },

  // ─── product_pricing ───────────────────────────────────────
  {
    table: 'product_pricing',
    operation: 'select',
    as: 'anon',
    expect: 'allow',
    note: 'product_pricing: anon can read (product_pricing_public_read)',
  },
  {
    table: 'product_pricing',
    operation: 'insert',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'product_pricing: customer cannot insert pricing rows',
  },
  {
    table: 'product_pricing',
    operation: 'update',
    as: 'authenticated_partner',
    expect: 'allow',
    filter: '{ product.partner_id: "<self>" }',
    note: 'product_pricing: partner can update own product pricing',
  },

  // ─── product_assets ────────────────────────────────────────
  {
    table: 'product_assets',
    operation: 'select',
    as: 'anon',
    expect: 'deny',
    note: 'product_assets: anon cannot read asset rows (no public_read)',
  },
  {
    table: 'product_assets',
    operation: 'select',
    as: 'authenticated_partner',
    expect: 'allow',
    filter: '{ product.partner_id: "<self>" }',
    note: 'product_assets: partner can read own product assets',
  },
  {
    table: 'product_assets',
    operation: 'insert',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'product_assets: customer cannot insert assets',
  },

  // ─── coupons ───────────────────────────────────────────────
  {
    table: 'coupons',
    operation: 'select',
    as: 'anon',
    expect: 'allow',
    filter: '{ status: "active", valid_until: "future" }',
    note: 'coupons: anon can read active coupons (coupons_public_read_active)',
  },
  {
    table: 'coupons',
    operation: 'update',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'coupons: customer cannot update coupons (admin-only via coupons_admin_all)',
  },
  {
    table: 'coupons',
    operation: 'delete',
    as: 'authenticated_partner',
    expect: 'deny',
    note: 'coupons: partner cannot delete coupons',
  },

  // ─── cart_items ────────────────────────────────────────────
  {
    table: 'cart_items',
    operation: 'select',
    as: 'anon',
    expect: 'deny',
    note: 'cart_items: anon cannot read any cart (cart_items_self_read)',
  },
  {
    table: 'cart_items',
    operation: 'select',
    as: 'authenticated_customer',
    expect: 'allow',
    filter: '{ user_id: "<self>" }',
    note: 'cart_items: customer can read own cart (cart_items_self_read)',
  },
  {
    table: 'cart_items',
    operation: 'select',
    as: 'authenticated_customer',
    expect: 'deny',
    filter: '{ user_id: "<other>" }',
    note: 'cart_items: customer cannot read another customer cart',
  },
  {
    table: 'cart_items',
    operation: 'insert',
    as: 'authenticated_customer',
    expect: 'allow',
    filter: '{ user_id: "<self>" }',
    note: 'cart_items: customer can insert into own cart (cart_items_self_write)',
  },
  {
    table: 'cart_items',
    operation: 'update',
    as: 'authenticated_customer',
    expect: 'allow',
    filter: '{ user_id: "<self>" }',
    note: 'cart_items: customer can update own cart lines',
  },
  {
    table: 'cart_items',
    operation: 'delete',
    as: 'authenticated_customer',
    expect: 'allow',
    filter: '{ user_id: "<self>" }',
    note: 'cart_items: customer can delete own cart lines',
  },
  {
    table: 'cart_items',
    operation: 'update',
    as: 'authenticated_partner',
    expect: 'deny',
    note: 'cart_items: partner cannot update customer carts',
  },

  // ─── orders ────────────────────────────────────────────────
  {
    table: 'orders',
    operation: 'select',
    as: 'anon',
    expect: 'deny',
    note: 'orders: anon cannot read any order (orders_self_read)',
  },
  {
    table: 'orders',
    operation: 'select',
    as: 'authenticated_customer',
    expect: 'allow',
    filter: '{ user_id: "<self>" }',
    note: 'orders: customer can read own orders (orders_self_read)',
  },
  {
    table: 'orders',
    operation: 'select',
    as: 'authenticated_customer',
    expect: 'deny',
    filter: '{ user_id: "<other>" }',
    note: 'orders: customer cannot read another customer order',
  },
  {
    table: 'orders',
    operation: 'insert',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'orders: customer cannot insert orders (webhook + service-role only)',
  },
  {
    table: 'orders',
    operation: 'update',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'orders: customer cannot update orders (status mutations are admin/webhook only)',
  },
  {
    table: 'orders',
    operation: 'select',
    as: 'authenticated_admin',
    expect: 'allow',
    note: 'orders: admin can read all (orders_admin_all)',
  },

  // ─── order_items ───────────────────────────────────────────
  {
    table: 'order_items',
    operation: 'select',
    as: 'authenticated_customer',
    expect: 'allow',
    filter: '{ order.user_id: "<self>" }',
    note: 'order_items: customer can read own order items (order_items_self_read)',
  },
  {
    table: 'order_items',
    operation: 'select',
    as: 'authenticated_partner',
    expect: 'allow',
    filter: '{ product.partner_id: "<self>" }',
    note: 'order_items: partner can read own product line items (order_items_partner_read_own)',
  },
  {
    table: 'order_items',
    operation: 'select',
    as: 'authenticated_partner_other',
    expect: 'deny',
    filter: '{ product.partner_id: "<other>" }',
    note: 'order_items: partner cannot read other partner line items',
  },
  {
    table: 'order_items',
    operation: 'insert',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'order_items: customer cannot insert order items',
  },

  // ─── refunds ───────────────────────────────────────────────
  {
    table: 'refunds',
    operation: 'select',
    as: 'authenticated_customer',
    expect: 'allow',
    filter: '{ order.user_id: "<self>" }',
    note: 'refunds: customer can read own refunds (refunds_self_read)',
  },
  {
    table: 'refunds',
    operation: 'insert',
    as: 'authenticated_customer',
    expect: 'allow',
    filter: '{ order.user_id: "<self>" }',
    note: 'refunds: customer can request refund on own order (refunds_self_request)',
  },
  {
    table: 'refunds',
    operation: 'update',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'refunds: customer cannot update refund status (admin-only via refunds_admin_all)',
  },
  {
    table: 'refunds',
    operation: 'select',
    as: 'authenticated_partner',
    expect: 'deny',
    note: 'refunds: partner cannot read refunds (admin-only)',
  },

  // ─── payout_ledger (append-only) ───────────────────────────
  {
    table: 'payout_ledger',
    operation: 'select',
    as: 'authenticated_partner',
    expect: 'allow',
    filter: '{ partner_id: "<self>" }',
    note: 'payout_ledger: partner can read own ledger (payout_ledger_partner_read_own)',
  },
  {
    table: 'payout_ledger',
    operation: 'select',
    as: 'authenticated_partner_other',
    expect: 'deny',
    filter: '{ partner_id: "<other>" }',
    note: 'payout_ledger: partner cannot read other partner ledger',
  },
  {
    table: 'payout_ledger',
    operation: 'update',
    as: 'authenticated_partner',
    expect: 'deny',
    note: 'payout_ledger: append-only — no UPDATE policy for any role',
  },
  {
    table: 'payout_ledger',
    operation: 'delete',
    as: 'authenticated_admin',
    expect: 'deny',
    note: 'payout_ledger: append-only — admin also cannot DELETE (audit log)',
  },
  {
    table: 'payout_ledger',
    operation: 'select',
    as: 'authenticated_admin',
    expect: 'allow',
    note: 'payout_ledger: admin can read all (payout_ledger_admin_read)',
  },
  {
    table: 'payout_ledger',
    operation: 'insert',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'payout_ledger: customer cannot insert (webhook + service-role only)',
  },

  // ─── library_grants ────────────────────────────────────────
  {
    table: 'library_grants',
    operation: 'select',
    as: 'authenticated_customer',
    expect: 'allow',
    filter: '{ user_id: "<self>" }',
    note: 'library_grants: customer can read own library (library_grants_self_read)',
  },
  {
    table: 'library_grants',
    operation: 'select',
    as: 'authenticated_customer',
    expect: 'deny',
    filter: '{ user_id: "<other>" }',
    note: 'library_grants: customer cannot read another customer library',
  },
  {
    table: 'library_grants',
    operation: 'insert',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'library_grants: customer cannot insert (webhook + service-role only)',
  },
  {
    table: 'library_grants',
    operation: 'select',
    as: 'authenticated_partner',
    expect: 'allow',
    filter: '{ product.partner_id: "<self>" }',
    note: 'library_grants: partner can see who bought own product (library_grants_partner_read_own_product)',
  },

  // ─── file_downloads (append-only) ──────────────────────────
  {
    table: 'file_downloads',
    operation: 'select',
    as: 'authenticated_customer',
    expect: 'allow',
    filter: '{ user_id: "<self>" }',
    note: 'file_downloads: customer can read own download history (file_downloads_self_read)',
  },
  {
    table: 'file_downloads',
    operation: 'update',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'file_downloads: append-only — no UPDATE policy for any role',
  },
  {
    table: 'file_downloads',
    operation: 'delete',
    as: 'authenticated_admin',
    expect: 'deny',
    note: 'file_downloads: append-only — admin also cannot DELETE (audit log)',
  },
  {
    table: 'file_downloads',
    operation: 'select',
    as: 'authenticated_admin',
    expect: 'allow',
    note: 'file_downloads: admin can read all (file_downloads_admin_read)',
  },

  // ─── platform_settings ─────────────────────────────────────
  {
    table: 'platform_settings',
    operation: 'select',
    as: 'anon',
    expect: 'allow',
    filter: '{ is_public: true }',
    note: 'platform_settings: anon can read public keys (platform_settings_public_read)',
  },
  {
    table: 'platform_settings',
    operation: 'update',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'platform_settings: customer cannot update (admin-only via platform_settings_admin_write)',
  },
  {
    table: 'platform_settings',
    operation: 'update',
    as: 'authenticated_admin',
    expect: 'allow',
    note: 'platform_settings: admin can update',
  },

  // ─── notification_preferences ──────────────────────────────
  {
    table: 'notification_preferences',
    operation: 'select',
    as: 'anon',
    expect: 'deny',
    note: 'notification_preferences: anon cannot read (PII)',
  },
  {
    table: 'notification_preferences',
    operation: 'select',
    as: 'authenticated_customer',
    expect: 'allow',
    filter: '{ user_id: "<self>" }',
    note: 'notification_preferences: customer can read own (notification_prefs_self_read)',
  },
  {
    table: 'notification_preferences',
    operation: 'update',
    as: 'authenticated_customer',
    expect: 'allow',
    filter: '{ user_id: "<self>" }',
    note: 'notification_preferences: customer can update own (notification_prefs_self_write)',
  },
  {
    table: 'notification_preferences',
    operation: 'update',
    as: 'authenticated_customer',
    expect: 'deny',
    filter: '{ user_id: "<other>" }',
    note: 'notification_preferences: customer cannot update another user prefs',
  },

  // ─── admin_audit_log (admin-only, append-only) ─────────────
  {
    table: 'admin_audit_log',
    operation: 'select',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'admin_audit_log: customer cannot read audit log',
  },
  {
    table: 'admin_audit_log',
    operation: 'select',
    as: 'authenticated_admin',
    expect: 'allow',
    note: 'admin_audit_log: admin can read (admin_audit_log_admin_read)',
  },
  {
    table: 'admin_audit_log',
    operation: 'insert',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'admin_audit_log: customer cannot insert (service-role only)',
  },
  {
    table: 'admin_audit_log',
    operation: 'update',
    as: 'authenticated_admin',
    expect: 'deny',
    note: 'admin_audit_log: append-only — no UPDATE policy for any role',
  },
  {
    table: 'admin_audit_log',
    operation: 'delete',
    as: 'authenticated_super_admin',
    expect: 'deny',
    note: 'admin_audit_log: append-only — even super_admin cannot DELETE (audit log)',
  },

  // ─── consent_log ───────────────────────────────────────────
  {
    table: 'consent_log',
    operation: 'select',
    as: 'anon',
    expect: 'deny',
    note: 'consent_log: anon cannot read consent log (PII)',
  },
  {
    table: 'consent_log',
    operation: 'select',
    as: 'authenticated_customer',
    expect: 'allow',
    filter: '{ user_id: "<self>" }',
    note: 'consent_log: customer can read own consent history',
  },
  {
    table: 'consent_log',
    operation: 'insert',
    as: 'authenticated_customer',
    expect: 'allow',
    filter: '{ user_id: "<self>" }',
    note: 'consent_log: customer can record own consent',
  },
  {
    table: 'consent_log',
    operation: 'update',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'consent_log: customer cannot update (consent is immutable)',
  },

  // ─── processed_webhooks (admin/service-only) ───────────────
  {
    table: 'processed_webhooks',
    operation: 'select',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'processed_webhooks: customer cannot read (admin/webhook handler only)',
  },
  {
    table: 'processed_webhooks',
    operation: 'select',
    as: 'authenticated_admin',
    expect: 'allow',
    note: 'processed_webhooks: admin can read for debugging',
  },
  {
    table: 'processed_webhooks',
    operation: 'insert',
    as: 'authenticated_admin',
    expect: 'deny',
    note: 'processed_webhooks: only webhook handlers (service-role) insert',
  },
  {
    table: 'processed_webhooks',
    operation: 'update',
    as: 'authenticated_admin',
    expect: 'deny',
    note: 'processed_webhooks: append-only',
  },

  // ─── collections (public-read) ─────────────────────────────
  {
    table: 'collections',
    operation: 'select',
    as: 'anon',
    expect: 'allow',
    filter: '{ status: "published" }',
    note: 'collections: anon can read published (collections_public_read_published)',
  },
  {
    table: 'collections',
    operation: 'update',
    as: 'authenticated_partner',
    expect: 'deny',
    note: 'collections: partner cannot update (admin-only — STUB-037)',
  },

  // ─── api_tokens (self-read) ────────────────────────────────
  {
    table: 'api_tokens',
    operation: 'select',
    as: 'anon',
    expect: 'deny',
    note: 'api_tokens: anon cannot read (auth-scoped credentials)',
  },
  {
    table: 'api_tokens',
    operation: 'select',
    as: 'authenticated_customer',
    expect: 'allow',
    filter: '{ user_id: "<self>" }',
    note: 'api_tokens: customer can read own (api_tokens_self_read)',
  },
  {
    table: 'api_tokens',
    operation: 'select',
    as: 'authenticated_customer',
    expect: 'deny',
    filter: '{ user_id: "<other>" }',
    note: 'api_tokens: customer cannot read another user token',
  },
  {
    table: 'api_tokens',
    operation: 'insert',
    as: 'authenticated_customer',
    expect: 'allow',
    filter: '{ user_id: "<self>" }',
    note: 'api_tokens: customer can create own (api_tokens_self_write)',
  },
  {
    table: 'api_tokens',
    operation: 'delete',
    as: 'authenticated_customer',
    expect: 'allow',
    filter: '{ user_id: "<self>" }',
    note: 'api_tokens: customer can revoke own (api_tokens_self_write)',
  },

  // ─── admin-only tables (partner/affiliate/customer notes) ──
  {
    table: 'partner_admin_notes',
    operation: 'select',
    as: 'authenticated_partner',
    expect: 'deny',
    note: 'partner_admin_notes: partner cannot read own admin notes (admin-only)',
  },
  {
    table: 'partner_admin_notes',
    operation: 'select',
    as: 'authenticated_admin',
    expect: 'allow',
    note: 'partner_admin_notes: admin can read all',
  },
  {
    table: 'partner_admin_notes',
    operation: 'insert',
    as: 'authenticated_partner',
    expect: 'deny',
    note: 'partner_admin_notes: partner cannot insert (admin-only)',
  },
  {
    table: 'affiliate_admin_notes',
    operation: 'select',
    as: 'authenticated_affiliate',
    expect: 'deny',
    note: 'affiliate_admin_notes: affiliate cannot read own admin notes',
  },
  {
    table: 'affiliate_admin_notes',
    operation: 'select',
    as: 'authenticated_admin',
    expect: 'allow',
    note: 'affiliate_admin_notes: admin can read all',
  },
  {
    table: 'customer_admin_notes',
    operation: 'select',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'customer_admin_notes: customer cannot read own admin notes',
  },
  {
    table: 'customer_admin_notes',
    operation: 'select',
    as: 'authenticated_admin',
    expect: 'allow',
    note: 'customer_admin_notes: admin can read all',
  },

  // ─── risk_signals (admin-only) ─────────────────────────────
  {
    table: 'risk_signals',
    operation: 'select',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'risk_signals: customer cannot read (admin-only — fraud detection)',
  },
  {
    table: 'risk_signals',
    operation: 'select',
    as: 'authenticated_partner',
    expect: 'deny',
    note: 'risk_signals: partner cannot read',
  },
  {
    table: 'risk_signals',
    operation: 'select',
    as: 'authenticated_admin',
    expect: 'allow',
    note: 'risk_signals: admin can read all',
  },
  {
    table: 'risk_signals',
    operation: 'insert',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'risk_signals: customer cannot insert (service-role / webhooks only)',
  },

  // ─── reports (admin-only) ─────────────────────────────────
  {
    table: 'reports',
    operation: 'select',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'reports: customer cannot read (admin-only)',
  },
  {
    table: 'reports',
    operation: 'select',
    as: 'authenticated_admin',
    expect: 'allow',
    note: 'reports: admin can read all',
  },
  {
    table: 'reports',
    operation: 'insert',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'reports: customer cannot insert (service-role only)',
  },

  // ─── dmca_takedowns (admin-only) ──────────────────────────
  {
    table: 'dmca_takedowns',
    operation: 'select',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'dmca_takedowns: customer cannot read (admin-only)',
  },
  {
    table: 'dmca_takedowns',
    operation: 'select',
    as: 'authenticated_admin',
    expect: 'allow',
    note: 'dmca_takedowns: admin can read all',
  },
  {
    table: 'dmca_takedowns',
    operation: 'insert',
    as: 'authenticated_customer',
    expect: 'deny',
    note: 'dmca_takedowns: customer cannot insert (admin-only)',
  },

  // ─── service_role negative-control sweep ───────────────────
  // Every (operation) the service role performs MUST be allowed
  // through RLS — that's the entire point of the service-role
  // client. If any table silently blocks the service role, the
  // webhooks break.
  {
    table: 'orders',
    operation: 'insert',
    as: 'service_role',
    expect: 'allow',
    note: 'orders: service role can insert (webhook path)',
  },
  {
    table: 'library_grants',
    operation: 'insert',
    as: 'service_role',
    expect: 'allow',
    note: 'library_grants: service role can insert (webhook path)',
  },
  {
    table: 'payout_ledger',
    operation: 'insert',
    as: 'service_role',
    expect: 'allow',
    note: 'payout_ledger: service role can insert (webhook path)',
  },
  {
    table: 'refunds',
    operation: 'update',
    as: 'service_role',
    expect: 'allow',
    note: 'refunds: service role can update (webhook path)',
  },
  {
    table: 'processed_webhooks',
    operation: 'insert',
    as: 'service_role',
    expect: 'allow',
    note: 'processed_webhooks: service role can insert (idempotency log)',
  },
  {
    table: 'admin_audit_log',
    operation: 'insert',
    as: 'service_role',
    expect: 'allow',
    note: 'admin_audit_log: service role can insert (every server action)',
  },
]

/** Tables with at least one policy in the fixture. Used by the
 *  runner to compute the coverage matrix. */
export function tablesInFixture(): readonly string[] {
  const set = new Set<string>()
  for (const test of ALL_RLS_POLICIES) {
    set.add(test.table)
  }
  return [...set].sort()
}

/** Counts the fixture by (table × operation × role) — used by the
 *  runner's dry-run report to print a coverage matrix. */
export function fixtureCoverage(): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const test of ALL_RLS_POLICIES) {
    const key = `${test.table}/${test.operation}/${test.as}`
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

// Re-export the type lists so callers don't have to maintain a
// second source of truth in their imports.
export { PUBLIC_READ, ADMIN_ONLY, APPEND_ONLY, SELF_READ }
