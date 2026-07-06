# 00-foundations/test/

Test infrastructure. The shared helpers, mocks, and fixtures that every test uses. Tests live with the code they test (`02-features/[name]/tests/`), but the *helpers* live here.

## Files

- **`helpers.ts`** — common test helpers: `createTestUser()`, `createTestPartner()`, `createTestProduct()`, `createTestOrder()`, etc. All of these use a dedicated test database (set up by CI) and clean up after themselves.
- **`mocks.ts`** — mocks for external services: `mockStripe()`, `mockPayPal()`, `mockBunny()`. Use these when you don't want to hit real APIs in tests.
- **`fixtures.ts`** — static test data: a sample product, a sample course structure, a sample license terms file. Use these for unit tests where you don't need a real DB.
- **`db.ts`** — the test database client. Sets up RLS, runs migrations, truncates between tests. (See "The test database" below.)
- **`auth.ts`** — helpers for testing authenticated code: `loginAs(user)`, `loginAsAdmin()`, `loginAsPartner()`. Sets the session cookie in the test request.
- **`assertions.ts`** — domain-specific assertions: `expectOrderToBePaid(order)`, `expectLibraryGrantToExist(userId, productId)`, etc. Less verbose than asserting on raw rows.

## The test database

We use a **separate test database** (not the dev or prod DB). It's reset between every test run. The setup:

1. CI runs migrations against the test DB
2. CI enables RLS on the test DB
3. Each test transactionally wraps its setup and assertions, rolling back at the end
4. Tests can run in parallel safely (we use a `t_test_` prefix on all test-created rows so they never collide)

Local dev:
```bash
# Reset the test DB
pnpm test:db:reset

# Run all tests
pnpm test

# Run tests for one feature
pnpm test -- catalog
```

## Writing tests

**Three layers:**

1. **Unit tests** (`*.test.ts`) — fast, isolated, no DB. Test one function or component.
2. **Integration tests** (`*.integration.test.ts`) — slow, hits the test DB. Test a server action or a feature module.
3. **E2E tests** (`*.e2e.test.ts`) — slowest, hits a real browser via Playwright. Test a user flow.

The convention: name the test file next to the code it tests. `Button.tsx` → `Button.test.tsx` (colocated).

## Test helpers — what they look like

```ts
// helpers.ts
export async function createTestUser(overrides: Partial<Profile> = {}): Promise<Profile> {
  const supabase = createTestDbClient();
  const { data: { user } } = await supabase.auth.admin.createUser({
    email: overrides.email ?? `test-${randomUUID()}@example.com`,
    password: 'test-password-1234',
    email_confirm: true,
  });
  const { data: profile } = await supabase.from('profiles').insert({
    user_id: user.id,
    display_name: overrides.display_name ?? 'Test User',
    role: overrides.role ?? 'customer',
  }).select().single();
  return profile;
}
```

```ts
// In a test
import { createTestUser, createTestOrder } from '00-foundations/test/helpers';

it('refunds eligible orders', async () => {
  const user = await createTestUser();
  const order = await createTestOrder({ userId: user.user_id, daysOld: 3 });
  const result = await refundOrder({ orderId: order.id, userId: user.user_id });
  expect(result.ok).toBe(true);
  expectOrderToBeRefunded(order.id);
});
```

## Mocks

```ts
// mocks.ts
export function mockStripe() {
  const original = stripeClient;
  // Replace the Stripe client with a test double
  // ...
}
```

In tests:
```ts
beforeEach(() => {
  vi.mock('00-foundations/money/stripe', () => mockStripe());
});
```

## Coverage targets

- **Unit tests:** 80% line coverage per file
- **Integration tests:** every server action has at least 3 tests (happy path, validation error, permission error)
- **E2E tests:** every user-facing flow has at least one happy-path test (defined in the page spec's acceptance criteria)

Coverage is enforced in CI. PRs that drop coverage below the target are blocked.

## What does NOT go here

- Page-specific tests (those live in the feature folder, e.g. `02-features/catalog/tests/`)
- Mock data that's only used by one feature (put it in the feature's test file)
- Production secrets or API keys (test mocks only)

If a test helper is only used by one feature, move it to that feature. Keep `00-foundations/test/` for truly shared infrastructure.
