# Agent Commerce Discovery — `/agents.md`, `/.well-known/ucp`

## What this page does

The public agent-commerce discovery surface. The current Shopify storefront exposes `/agents.md`, `/.well-known/ucp`, and an MCP/UCP shopping endpoint. The v2 UCP/agent-commerce plan is intentionally undecided. V2 must preserve these discovery URLs without silent 404s, either by returning a read-only equivalent or by intentionally deprecating them with a documented replacement. This spec owns the public discovery documents, not checkout automation.

## Data this page shows

| Surface | Field | Source | Format |
|---|---|---|---|
| `/agents.md` | agent instructions, read-only browsing URLs, policies, safety rules | static markdown | text/markdown |
| `/.well-known/ucp` | merchant profile, supported protocol versions, service endpoints, capabilities | static or server route | JSON |
| Product JSON compatibility | product lookup/read-only catalog data | products + pricing | JSON, if approved |
| Collection JSON compatibility | collection product list | catalog query | JSON, if approved |

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Read agent instructions | `GET /agents.md` | Returns markdown instructions | public |
| Discover commerce profile | `GET /.well-known/ucp` | Returns JSON profile or deprecation JSON | public |
| Search catalog through agent endpoint | Protocol-specific request if approved | Returns read-only catalog data | public or rate-limited public |
| Create checkout through agent endpoint | Protocol-specific request if approved | Requires explicit buyer approval and follows checkout auth rules | authenticated buyer |

## What this page does NOT do

- No autonomous payment completion
- No bypass of buyer approval
- No exposure of private library/download URLs
- No service-role data access from public agent endpoints
- No guaranteed Shopify-compatible UCP implementation unless approved

## Acceptance criteria

- [ ] `/agents.md` returns 200 and is linked from `robots.txt` or sitemap if approved for indexing
- [ ] `/agents.md` describes the canonical v2 public routes: `/browse`, `/collections/[handle]`, `/products/[slug]`, `/cart`, `/checkout`, `/privacy`, `/terms`, `/refunds`, `/delivery`
- [ ] `/.well-known/ucp` returns either a valid v2 merchant profile or a clear deprecation response; it does not 404 silently at launch
- [ ] Any agent catalog endpoint returns only public, published product data
- [ ] Any agent checkout endpoint requires the same auth, CSRF, rate-limit, and payment approval rules as normal checkout
- [ ] Signed file URLs, library grants, order PII, customer emails, and admin data are never exposed through agent discovery
- [ ] Rate limits are documented and enforced for JSON endpoints
- [ ] No placeholder markers in the diff

## Design reference

N/A — markdown and JSON routes.

## Security

- **Auth required:** NO for discovery; YES for buyer-specific cart/checkout actions
- **Allowed roles:** public discovery, authenticated buyer checkout
- **RLS policies that apply:** product/category public read only; cart/checkout self-only where applicable
- **PII displayed:** NO in discovery/catalog
- **PII in URLs:** NO
- **Audit logged:** checkout/cart mutations are logged according to checkout specs; discovery reads are aggregate metrics only
- **Payment safety:** payment completion requires explicit, contemporaneous buyer approval

## Performance

- **Target p95:** discovery < 100ms, catalog endpoint < 250ms
- **Render strategy:** static markdown/JSON where possible, RSC/API route for dynamic catalog if approved
- **Bundle size budget:** N/A

## Out of scope for v1

- Full UCP parity with Shopify
- Cross-store agent checkout
- Order tracking through agent endpoint

## Open questions for human

1. **UCP parity:** plan intentionally undecided. Preserve `/agents.md` and `/.well-known/ucp` without silent 404s, but do not assume full UCP/MCP shopping endpoints or agent checkout until the human approves that scope.

---

## Implementation notes

- (filled by the building agent)
