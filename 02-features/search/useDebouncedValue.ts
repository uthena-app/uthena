// useDebouncedValue — returns the latest `value`, but only updates
// after `delay` ms of stability. Used by the search overlay to keep
// the input feeling instant while coalescing API calls.
//
// Why not a debounced setter:
// - The input must reflect every keystroke (no lag in the visible
//   text box). The lag belongs on the network call only. Returning
//   the debounced value lets the component split "render every
//   keystroke" from "fetch every debounced value".
// - The hook stays generic so the future /search results page can
//   use it the same way (e.g. for sort/filter URL debounce).

import { useEffect, useState } from 'react'

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}