// Toast — unit tests for the pure logic + the throw-outside-provider
// guard + the provider's children-rendering contract.
//
// We don't render the portal here (vitest is in `node` env, no jsdom
// available — portal would need `document.body`). The portal mount +
// dismissal-timer behavior is verifiable manually via the dev server;
// the foundation guarantee we ship to test is the API surface.
//
// Pattern: mount a `ToastProvider` with `createElement` (no JSX), wrap
// a child that calls `useToast()`, capture the API object via a
// ref-prop, and assert on its outputs. Renders via
// `renderToStaticMarkup` so children-rendering + portal-suppression
// (portal returns null server-side) can both be checked.

import { describe, expect, it } from 'vitest'
import { createElement, createRef, type MutableRefObject } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToastProvider, useToast } from './Toast'

type ToastApi = ReturnType<typeof useToast>
function CaptureApi({ apiRef }: { apiRef: MutableRefObject<ToastApi | null> }) {
  apiRef.current = useToast()
  return null
}

describe('Toast', () => {
  it('exposes success / info / error / dismiss', () => {
    const ref = createRef<ToastApi | null>()
    renderToStaticMarkup(
      createElement(ToastProvider, null, createElement(CaptureApi, { apiRef: ref })),
    )
    expect(ref.current).not.toBeNull()
    expect(typeof ref.current!.success).toBe('function')
    expect(typeof ref.current!.info).toBe('function')
    expect(typeof ref.current!.error).toBe('function')
    expect(typeof ref.current!.dismiss).toBe('function')
  })

  it('success / info / error each return a unique string id', () => {
    const ref = createRef<ToastApi | null>()
    renderToStaticMarkup(
      createElement(ToastProvider, null, createElement(CaptureApi, { apiRef: ref })),
    )
    const a = ref.current!.success('Saved.')
    const b = ref.current!.info('Heads up.')
    const c = ref.current!.error('Boom.')
    expect(typeof a).toBe('string')
    expect(typeof b).toBe('string')
    expect(typeof c).toBe('string')
    expect(a).not.toBe(b)
    expect(b).not.toBe(c)
    expect(a).not.toBe(c)
    // IDs are non-empty and look reasonable.
    expect(a.length).toBeGreaterThan(4)
  })

  it('dismiss is callable with a string id (no throw)', () => {
    const ref = createRef<ToastApi | null>()
    renderToStaticMarkup(
      createElement(ToastProvider, null, createElement(CaptureApi, { apiRef: ref })),
    )
    expect(() => ref.current!.dismiss('whatever')).not.toThrow()
  })

  it('throws when useToast() is called outside a provider', () => {
    // The guard fires inside the hook itself; we mount a tiny
    // component that calls useToast() without a provider wrapper
    // and capture the render-thrown error via a try/catch on
    // renderToStaticMarkup (the render path is the only one that
    // can run a hook).
    function Naked() {
      useToast()
      return null
    }
    expect(() => renderToStaticMarkup(createElement(Naked))).toThrow(/ToastProvider/)
  })

  it('does not render the toast portal in SSR (server-render returns no DOM for the bar)', () => {
    const ref = createRef<ToastApi | null>()
    // Push a toast before render — the entry exists in provider state
    // but the portal is mounted only after `useEffect` runs in the
    // browser, so SSR output must NOT include any visible toast DOM.
    // We use a tiny consumer that pushes synchronously during render.
    function Pusher() {
      const api = useToast()
      api.success('Saved.')
      return null
    }
    const html = renderToStaticMarkup(
      createElement(ToastProvider, null, createElement(Pusher)),
    )
    // Provider renders its children but the portal is suppressed on
    // the server (mounted=false). The HTML is the children + nothing
    // else.
    expect(html).toBe('')
  })

  it('passes children through unchanged', () => {
    const html = renderToStaticMarkup(
      createElement(
        ToastProvider,
        null,
        createElement('div', { 'data-testid': 'child' }, 'Hello'),
      ),
    )
    expect(html).toContain('Hello')
    expect(html).toContain('data-testid="child"')
  })
})