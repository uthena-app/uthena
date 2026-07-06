// Client-safe entry point for the search feature.
//
// Use this from client components to avoid pulling in server-only
// modules. The main `index.ts` barrel re-exports `searchPublishedProducts`
// from `./queries`, which has `import 'server-only'`. Importing that
// barrel from a client component causes the build to fail because
// the server-only directive is evaluated in client context.
//
// Consumers:
//   - Client components: import from `@features/search/client`.
//   - Server components + route handlers: import from `@features/search`
//     (the main barrel, which re-exports queries too).

export { SearchOverlay } from './SearchOverlay'
export { SearchTrigger } from './SearchTrigger'
export { SEARCH_TRIGGER_OPEN_EVENT } from './searchEvents'
