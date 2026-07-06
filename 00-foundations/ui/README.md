# 00-foundations/ui/

React component primitives. These are the building blocks every feature uses. If a component is used in 2+ features, it goes here. If it's used in 1 feature, it stays in that feature.

## Files (one component per file)

The convention: one component per file, file named after the component. Co-locate styles if the component has them.

- `Button.tsx` — primary, secondary, ghost, danger variants. Sizes: sm, md, lg.
- `Input.tsx` — text input with label, helper, error states
- `PasswordInput.tsx` — Input with show/hide toggle and strength meter
- `Textarea.tsx` — multiline text input
- `Select.tsx` — dropdown
- `Checkbox.tsx` + `Radio.tsx` + `RadioCard.tsx` — radio cards for the role chooser pattern
- `Card.tsx` — surface container with optional hover state
- `Modal.tsx` — dialog (also `ConfirmModal`, `DrawerModal`)
- `Toast.tsx` — `ToastProvider` + `useToast()` hook (`success` / `info` / `error` / `dismiss`). Stacks at bottom-right; auto-dismisses; portal-mounted; a11y (`role=status|alert` + `aria-live`).
- `Tabs.tsx` — accessible tabs with keyboard nav
- `Tooltip.tsx` — hover hints
- `Badge.tsx` — semantic + accent variants (defined in design/tokens)
- `Avatar.tsx` — user avatar with initials fallback
- `EmptyState.tsx` — empty-state pattern (icon + title + description + action). Two variants: `card` (dashed-border surface, default) and `plain` (no surface, for inside-modal / inside-row empties). RSC.
- `ErrorState.tsx` — error-state pattern (same shape as EmptyState, danger palette). For "this section of data failed to load" inside list pages — NOT a route-level error boundary (that's `00-foundations/ui/error/`). RSC.
- `Skeleton.tsx` — loading placeholder. Variants: `text` (stacked bars via `count`), `rect` (custom-shape), `avatar` (circle), `card` (composite: rect + text lines). Honors `prefers-reduced-motion`. RSC.
- `error/` — error-boundary helpers shared by every error.tsx (route-level, global, per-route). Exports: `ERR_ID_ALPHABET` + `ERR_ID_LENGTH` + `generateErrorId()` + `makeErrorReference()` (the opaque `ERR-{id}` reference per error-500.md §Security), `WarnGlyph` (the warn-triangle icon), and `RouteError` + `RouteErrorConfig` (the shared client component used by per-route error.tsx files). The shared helpers avoid the DRY violation that bit the P0.23 tick (ERR_ID_ALPHABET + WarnGlyph were duplicated in app/error.tsx and app/global-error.tsx).
- `Pagination.tsx` — page navigation
- `StatCard.tsx` — number + label + delta
- `Stepper.tsx` — multi-step wizard navigation
- `Dropzone.tsx` — file upload area
- `Sidebar.tsx` — app shell sidebar (admin, partner, affiliate)
- `Avatar.tsx`, `Banner.tsx`, `Breadcrumb.tsx`, `DataTable.tsx`, `EmptyState.tsx`, `FormField.tsx`, `Tag.tsx`, `Toggle.tsx`, `Tooltip.tsx` — see the per-file list at the top of this README for the full set

The full component list lives in the directory. Check before adding — it probably exists.

## Component design rules

### Every component takes className

```tsx
export function Button({ className, ...props }: ButtonProps) {
  return <button className={cn('btn btn-primary', className)} {...props} />;
}
```

This lets the parent add layout classes (`mt-4`, `w-full`) without prop drilling.

### Every component is accessible by default

- Use semantic HTML (`<button>`, not `<div onClick>`)
- All interactive elements are keyboard-navigable (Tab, Enter, Space, arrow keys as appropriate)
- All form controls have associated labels (use `aria-label` or wrap in `<label>`)
- All images have alt text
- Focus styles are visible (the design system handles this)
- Color contrast meets WCAG AA (4.5:1 for body, 3:1 for large text)

### Every component is forwardRef'd

```tsx
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ className, ...props }, ref) {
    return <button ref={ref} className={cn('btn btn-primary', className)} {...props} />;
  }
);
```

This lets parents do `ref={buttonRef}` for focus management.

### No business logic in primitives

A Button doesn't know what it's submitting. A Card doesn't know what data it's displaying. A Modal doesn't know what it's confirming.

Business logic lives in `02-features/[name]/`. Primitives are dumb, presentational, and reusable.

## Adding a new primitive

1. Check that the component isn't already in this folder (search the directory)
2. Check that the component is used in ≥ 2 features (if not, keep it in the feature that uses it)
3. Create the file: `ComponentName.tsx`
4. Use the conventions above (className, accessibility, forwardRef)
5. Add it to the list at the top of this README
6. Add tests in `00-foundations/test/` (component tests using React Testing Library)

## Variant system

Components use a "variant" prop for visual variations. The variants are documented in the component's JSDoc:

```tsx
type ButtonProps = {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; // default: 'primary'
  size?: 'sm' | 'md' | 'lg';                              // default: 'md'
  // ...
};
```

The mapping from variant → CSS class is in the component file. Components don't read from a context or a theme to decide their appearance — they take it as a prop.

## The cn() utility

We use a small `cn()` helper (similar to `clsx` or `classnames`) to merge class names conditionally. It strips falsy values and joins the rest with spaces:

```tsx
className={cn('btn', isActive && 'btn-active', className)}
```

`cn()` is defined in `00-foundations/ui/cn.ts`. It uses `clsx` under the hood. Import it as `import { cn } from '00-foundations/ui/cn'`.

## Don't use Material UI, Chakra, Radix (yet), Mantine, etc.

We have a custom design system. We don't need a third-party component library. We can pull in Radix for specific primitives (dialog, popover, combobox) if the accessibility wins are worth it — but not before we have the design tokens locked.

If you think we need a third-party component library, write an ADR (in `01-specs/decisions/`) and request human approval. Don't just add the dependency.
