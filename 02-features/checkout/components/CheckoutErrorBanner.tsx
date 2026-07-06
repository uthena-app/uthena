// CheckoutErrorBanner.tsx — inline error display on /checkout when the
// "create session" action returns a typed error. Server component —
// just renders the text in a banner. Used by the page after the form
// action result.

export function CheckoutErrorBanner({ error }: { error: string }) {
  return (
    <div
      role="alert"
      style={{
        background: 'var(--danger-soft)',
        border: '1px solid var(--danger-line)',
        color: 'var(--danger)',
        borderRadius: 10,
        padding: '10px 12px',
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      {error}
    </div>
  )
}
