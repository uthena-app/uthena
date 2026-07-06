// RecentInvoices.tsx — read-only list of invoices from the last
// 12 months (P5.7). Each row carries its own PDF link out to the
// Stripe-hosted invoice PDF when available; falls back to the
// hosted invoice URL when the PDF isn't generated yet (very fresh
// drafts), and renders a muted dash when neither URL is present.

import { RecentInvoice, formatDate, formatMoney } from '@features/subscriptions'
import styles from './RecentInvoices.module.css'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', open: 'Open', paid: 'Paid', uncollectible: 'Uncollectible', void: 'Void',
}

export function RecentInvoices({ invoices }: { invoices: RecentInvoice[] }) {
  return (
    <section className={styles.card} aria-label="Invoices from the last 12 months">
      <header className={styles.header}>
        <h2 className={styles.h2}>Last 12 months</h2>
        <p className={styles.subtitle}>Invoices issued during the last 12 months.</p>
      </header>
      {invoices.length === 0 ? (
        <p className={styles.empty}>No invoices yet — your first one will appear here after your first billing cycle.</p>
      ) : (
        <ul className={styles.list}>
          {invoices.map((inv) => (
            <li key={inv.id} className={styles.row}>
              <div className={styles.colDate}>
                <p className={styles.date}>{formatDate(inv.created_at)}</p>
                <p className={styles.num}>{inv.number ?? inv.id}</p>
              </div>
              <div className={styles.colAmount}>
                <p className={styles.amount}>{formatMoney(inv.amount_paid_cents || inv.amount_due_cents, inv.currency)}</p>
                <p className={styles.status}>{STATUS_LABELS[inv.status] ?? inv.status}</p>
              </div>
              {inv.invoice_pdf ? (
                <a
                  href={inv.invoice_pdf}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.link}
                  aria-label={`Download invoice ${inv.number ?? inv.id} as PDF`}
                >
                  Download PDF
                </a>
              ) : inv.hosted_invoice_url ? (
                <a
                  href={inv.hosted_invoice_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.link}
                  aria-label={`View invoice ${inv.number ?? inv.id}`}
                >
                  View
                </a>
              ) : (
                <span className={styles.linkMuted} aria-label="No invoice PDF available">—</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}