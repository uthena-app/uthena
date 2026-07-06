#!/usr/bin/env bash
# check-spec-coverage.sh
# Every route in app/ must have a spec in 01-specs/pages/.
# Fails the build if not. POSIX-portable (macOS bash 3 + zsh).
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../../../" && pwd)"
APP_DIR="$REPO_ROOT/app"
SPECS_DIR="$REPO_ROOT/01-specs/pages"

if [ ! -d "$APP_DIR" ]; then
  echo "[check-specs] No app/ directory found. Skipping."
  exit 0
fi
if [ ! -d "$SPECS_DIR" ]; then
  echo "[check-specs] No 01-specs/pages/ directory found. Skipping."
  exit 0
fi

# Build a list of pages (POSIX find, no mapfile).
PAGES=""
for page in $(find "$APP_DIR" \
    \( -name "page.tsx" -o -name "page.ts" -o -name "page.jsx" -o -name "page.js" \) \
    -not -path "*/node_modules/*" \
    -not -path "*/.next/*" \
  | sort); do
  PAGES="$PAGES
$page"
done

if [ -z "$PAGES" ]; then
  echo "[check-specs] No pages found yet. Skipping."
  exit 0
fi

missing=0
echo "[check-specs] Checking pages against 01-specs/pages/"

for page in $PAGES; do
  rel="${page#$APP_DIR/}"
  base="$(basename "$(dirname "$rel")")"
  if [ "$rel" = "page.tsx" ] || [ "$rel" = "page.ts" ]; then
    candidate="home"
  else
    candidate="$base"
    # crude singular: strip trailing 's' if length > 3
    case "$candidate" in
      *s) if [ "${#candidate}" -gt 3 ]; then candidate="${candidate%s}"; fi ;;
    esac
    # strip dynamic brackets
    candidate="$(echo "$candidate" | tr -d '[]')"
  fi

  found=0

  # 1) Verbatim match (e.g. /terms -> terms.md).
  if [ -f "$SPECS_DIR/${base}.md" ]; then
    echo "  [ok] $rel  -> ${base}.md (matched plural form)"
    found=1
  fi

  # 2) Area-base convention: {top_dir}-{base}.md (e.g. admin/partners
  # -> admin-partners.md). Run BEFORE the singular-strip fallback so
  # /admin/partners doesn't incorrectly match partner.md (the partner
  # portal spec) via the trailing 's' singular strip on `partners`.
  if [ "$found" -eq 0 ]; then
    top_dir="$(echo "$rel" | cut -d/ -f1)"
    if [ -n "$top_dir" ] && [ "$top_dir" != "$rel" ]; then
      area_spec="$SPECS_DIR/${top_dir}-${base}.md"
      if [ -f "$area_spec" ]; then
        echo "  [ok] $rel  -> ${top_dir}-${base}.md (matched area-base pattern)"
        found=1
      fi
    fi
  fi

  # 3) Singular-stripped match (e.g. /customers -> customer.md).
  if [ "$found" -eq 0 ] && [ "$candidate" != "$base" ]; then
    if [ -f "$SPECS_DIR/${candidate}.md" ]; then
      echo "  [ok] $rel  -> $candidate.md"
      found=1
    fi
  fi

  # 4) Parent-of-dynamic-route fallback. /products/[slug]/page.tsx
  # -> product.md, /admin/customers/[id]/page.tsx -> admin.md.
  if [ "$found" -eq 0 ]; then
    parent="$(basename "$(dirname "$(dirname "$rel")")")"
    parent_candidate="$parent"
    case "$parent_candidate" in
      *s) if [ "${#parent_candidate}" -gt 3 ]; then parent_candidate="${parent_candidate%s}"; fi ;;
    esac
    spec="$SPECS_DIR/${parent_candidate}.md"
    if [ -f "$spec" ]; then
      echo "  [ok] $rel  -> $parent_candidate.md (matched parent of dynamic route)"
      found=1
    fi
  fi

  # 5) Nested detail convention. account/orders/[id]/page.tsx
  # -> account-order-detail.md (or singular: account-orders-detail.md).
  if [ "$found" -eq 0 ]; then
    parent="$(basename "$(dirname "$(dirname "$rel")")")"
    parent_candidate="$parent"
    case "$parent_candidate" in
      *s) if [ "${#parent_candidate}" -gt 3 ]; then parent_candidate="${parent_candidate%s}"; fi ;;
    esac
    grandparent="$(basename "$(dirname "$(dirname "$(dirname "$rel")")")")"
    nested_detail="$SPECS_DIR/${grandparent}-${parent}-detail.md"
    nested_detail_singular="$SPECS_DIR/${grandparent}-${parent_candidate}-detail.md"
    if [ -f "$nested_detail" ]; then
      echo "  [ok] $rel  -> ${grandparent}-${parent}-detail.md (matched nested detail pattern)"
      found=1
    elif [ -f "$nested_detail_singular" ]; then
      echo "  [ok] $rel  -> ${grandparent}-${parent_candidate}-detail.md (matched nested detail pattern, singular)"
      found=1
    fi
  fi

  # 6) Full nested path convention (3+ levels deep).
  # account/orders/[id]/refund -> account-orders-refund.md.
  if [ "$found" -eq 0 ]; then
    parent="$(basename "$(dirname "$(dirname "$rel")")")"
    parent_candidate="$parent"
    case "$parent_candidate" in
      *s) if [ "${#parent_candidate}" -gt 3 ]; then parent_candidate="${parent_candidate%s}"; fi ;;
    esac
    grandparent="$(basename "$(dirname "$(dirname "$(dirname "$rel")")")")"
    full_nested="$SPECS_DIR/${grandparent}-${parent}-${base}.md"
    if [ -f "$full_nested" ]; then
      echo "  [ok] $rel  -> ${grandparent}-${parent}-${base}.md (matched full nested path)"
      found=1
    fi
  fi

  # 7) Top-level area pattern (e.g. account/.../refund -> account-refund.md).
  if [ "$found" -eq 0 ]; then
    top_dir="$(echo "$rel" | cut -d/ -f1)"
    if [ -n "$top_dir" ] && [ "$top_dir" != "$rel" ]; then
      top_spec="$SPECS_DIR/${top_dir}-${base}.md"
      if [ -f "$top_spec" ]; then
        echo "  [ok] $rel  -> ${top_dir}-${base}.md (matched top-level area pattern)"
        found=1
      fi
    fi
  fi

  # 8) Stripped-path pattern (e.g. account/orders/[id]/refund/sent
  # -> account-refund-sent.md).
  if [ "$found" -eq 0 ]; then
    stripped_path="$(echo "$rel" | sed 's|\[.*\]||g' | sed 's|/| |g' | tr -s ' ' | tr ' ' '-')"
    stripped_path="${stripped_path%-page.tsx}"
    stripped_path="${stripped_path%-page.ts}"
    stripped_spec="$SPECS_DIR/${stripped_path}.md"
    if [ -f "$stripped_spec" ]; then
      echo "  [ok] $rel  -> ${stripped_path}.md (matched stripped-path pattern)"
      found=1
    fi
  fi

  # 9) Top + last 2 pattern (e.g. account/orders/[id]/refund/sent
  # -> account-refund-sent.md).
  if [ "$found" -eq 0 ]; then
    top_dir="$(echo "$rel" | cut -d/ -f1)"
    if [ -n "$top_dir" ] && [ "$top_dir" != "$rel" ]; then
      last_two="$(echo "$rel" | awk -F/ '{print $(NF-2)"-"$NF}' | sed 's|\[.*\]||g' | sed 's|-page.tsx||' | sed 's|-page.ts||')"
      last_two_spec="$SPECS_DIR/${top_dir}-${last_two}.md"
      if [ -f "$last_two_spec" ]; then
        echo "  [ok] $rel  -> ${top_dir}-${last_two}.md (matched top+last2 pattern)"
        found=1
      fi
    fi
  fi

  if [ "$found" -eq 0 ]; then
    echo "  [x] $rel  -> no spec at $candidate.md (also tried ${base}.md, area-base, parent-of-dynamic-route, nested-detail patterns)"
    missing=$((missing + 1))
  fi
done

if [ $missing -gt 0 ]; then
  echo
  echo "[check-specs] $missing page(s) missing spec coverage."
  echo "Either write the spec in 01-specs/pages/ or remove the page."
  exit 1
fi
echo "[check-specs] All pages have specs."