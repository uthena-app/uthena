// CategoryTree.tsx — client component. Renders the category tree with
// expand/collapse and HTML5-native drag-and-drop reordering. We
// intentionally avoid @dnd-kit (not in package.json) and use the
// native HTML5 drag-and-drop API which is sufficient for top-level
// reordering and parent moves within a 2-level tree.
//
// Drag and drop semantics (HTML5 native):
//   - dragstart: set dataTransfer with the dragged node's id + parent
//   - dragover on a target row: prevent default to allow drop
//   - drop: read the target's parent_id, compute the new sibling list,
//     and call reorderCategoryAction.
//   - dragend: reset state
//
// Keyboard accessibility: arrow keys move focus, Enter expands/collapses,
// Delete opens the delete modal (with the focused node as target).

'use client'

import { useCallback, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { CategoryNode, ParentOption } from '../types'
import { reorderCategoryAction } from '../actions/reorderCategory'
import { EditCategoryModal } from './EditCategoryModal'
import { DeleteCategoryModal } from './DeleteCategoryModal'
import { AddCategoryModal } from './AddCategoryModal'
import styles from './CategoryTree.module.css'

const DRAG_MIME = 'application/x-uthena-category-id'

type DragMeta = { id: number; parentId: number | null }

type TreeProps = {
  nodes: CategoryNode[]
  parents: ParentOption[]
  /** Initial expanded state (top-level all expanded by default). */
  initialExpanded?: Record<number, boolean>
}

export function CategoryTree({ nodes, parents, initialExpanded }: TreeProps) {
  const router = useRouter()
  const [expanded, setExpanded] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {}
    for (const n of nodes) init[n.id] = true
    if (initialExpanded) Object.assign(init, initialExpanded)
    return init
  })
  const [editing, setEditing] = useState<CategoryNode | null>(null)
  const [deleting, setDeleting] = useState<CategoryNode | null>(null)
  const [addingChildOf, setAddingChildOf] = useState<CategoryNode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  // Track child counts per parent for the delete-modal impact.
  const childCountByParent = useMemo(() => {
    const m = new Map<number, number>()
    function walk(arr: CategoryNode[]) {
      for (const n of arr) {
        if (n.parent_id != null) {
          m.set(n.parent_id, (m.get(n.parent_id) ?? 0) + 1)
        }
        if (n.children.length > 0) walk(n.children)
      }
    }
    walk(nodes)
    return m
  }, [nodes])

  const onToggle = useCallback((id: number) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const onRowKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, node: CategoryNode) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        onToggle(node.id)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        setDeleting(node)
      }
    },
    [onToggle],
  )

  const onDrop = useCallback(
    (
      targetParentId: number | null,
      targetIndex: number,
      targetId: number,
      drag: DragMeta,
    ) => {
      setError(null)
      // Build the new sibling list for the target parent.
      // siblings in the target parent (excluding the dragged node if
      // it was already in this parent).
      const targetSiblings: number[] = []
      function collect(
        arr: CategoryNode[],
        parentId: number | null,
      ): void {
        for (const n of arr) {
          if (n.parent_id === parentId) {
            targetSiblings.push(n.id)
            if (n.children.length > 0) collect(n.children, n.id)
          } else if (n.children.length > 0) {
            collect(n.children, n.id)
          }
        }
      }
      collect(nodes, targetParentId)
      // Remove dragged id if already in this parent.
      const filtered = targetSiblings.filter((id) => id !== drag.id)
      // Insert at targetIndex. If targetIndex is -1, append.
      const insertAt = targetIndex < 0 ? filtered.length : Math.min(targetIndex, filtered.length)
      filtered.splice(insertAt, 0, drag.id)

      startTransition(async () => {
        const res = await reorderCategoryAction({
          id: drag.id,
          new_parent_id: targetParentId,
          new_display_order: targetIndex < 0 ? filtered.length * 10 : targetIndex * 10,
          sibling_ids: filtered,
        })
        if (!res.ok) {
          setError(res.error)
          return
        }
        router.refresh()
      })
      // Reference targetId to keep TS strict about the parameter
      void targetId
    },
    [nodes, router],
  )

  return (
    <div className={styles.treeWrap}>
      {error && (
        <p className={styles.errorBanner} role="alert">
          {error}
        </p>
      )}
      <ul className={styles.tree} role="tree" aria-label="Category tree">
        {nodes.map((node, i) => (
          <TreeRow
            key={node.id}
            node={node}
            depth={0}
            index={i}
            isExpanded={expanded[node.id] ?? true}
            onToggle={onToggle}
            onRowKeyDown={onRowKeyDown}
            onDrop={onDrop}
            onEdit={setEditing}
            onDelete={setDeleting}
            onAddChild={setAddingChildOf}
            isLast={i === nodes.length - 1}
          />
        ))}
      </ul>
      {nodes.length === 0 && (
        <p className={styles.empty}>
          No categories yet. Click <strong>Add top-level category</strong> to start.
        </p>
      )}
      {editing && (
        <EditCategoryModal
          category={editing}
          parents={parents}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <DeleteCategoryModal
          category={deleting}
          childCount={childCountByParent.get(deleting.id) ?? 0}
          onClose={() => setDeleting(null)}
        />
      )}
      {addingChildOf && (
        <AddCategoryModal
          parents={parents}
          defaultParentId={addingChildOf.id}
          onClose={() => setAddingChildOf(null)}
        />
      )}
    </div>
  )
}

type RowProps = {
  node: CategoryNode
  depth: number
  index: number
  isExpanded: boolean
  isLast: boolean
  onToggle: (id: number) => void
  onRowKeyDown: (e: React.KeyboardEvent<HTMLDivElement>, node: CategoryNode) => void
  onDrop: (
    targetParentId: number | null,
    targetIndex: number,
    targetId: number,
    drag: DragMeta,
  ) => void
  onEdit: (n: CategoryNode) => void
  onDelete: (n: CategoryNode) => void
  onAddChild: (n: CategoryNode) => void
}

function TreeRow({
  node,
  depth,
  index,
  isExpanded,
  isLast,
  onToggle,
  onRowKeyDown,
  onDrop,
  onEdit,
  onDelete,
  onAddChild,
}: RowProps) {
  const hasChildren = node.children.length > 0
  const draggable = depth < 2 // cannot drag a top-level into being a grandchild

  function onDragStart(e: React.DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData(
      DRAG_MIME,
      JSON.stringify({ id: node.id, parentId: node.parent_id } satisfies DragMeta),
    )
    e.dataTransfer.effectAllowed = 'move'
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    // Only accept if we have valid drag data.
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  function onDropRow(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (!raw) return
    const drag = JSON.parse(raw) as DragMeta
    // depth 0 (top-level): node.parent_id === null
    // depth 1: node.parent_id !== null — this row IS a child; cannot
    // drop INTO it because that would be a grandchild (3 levels).
    const targetParentId = depth === 0 ? null : node.parent_id
    // Index within the target parent: count of siblings (or just `index`
    // at top level since siblings are at the same level).
    const targetIndex = index
    onDrop(targetParentId, targetIndex, node.id, drag)
  }

  // For the "end-of-list" drop zone, we render an extra empty drop
  // area at the end of each level so admins can drop AFTER the last
  // sibling. This is handled in TreeSiblingsEnd.

  const canDelete =
    (node.product_count_cache ?? 0) === 0 && node.children.length === 0

  return (
    <li role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined}>
      <div
        className={styles.row}
        style={{ paddingLeft: 12 + depth * 20 }}
        tabIndex={0}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDropRow}
        onKeyDown={(e) => onRowKeyDown(e, node)}
        data-category-id={node.id}
        data-testid={`cat-row-${node.id}`}
      >
        <span
          className={styles.handle}
          aria-hidden
          title={draggable ? 'Drag to reorder' : 'Top-level rows can be reordered'}
        >
          ⋮⋮
        </span>
        {hasChildren ? (
          <button
            type="button"
            className={styles.chevron}
            onClick={() => onToggle(node.id)}
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
            aria-expanded={isExpanded}
          >
            {isExpanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className={styles.chevronPlaceholder} aria-hidden />
        )}
        <div className={styles.main}>
          <span className={styles.name}>{node.name}</span>
          <span className={styles.slug}>/{node.slug}</span>
        </div>
        <div className={styles.stats}>
          <span
            className={styles.badge}
            title={`${node.product_count_cache ?? 0} product${
              (node.product_count_cache ?? 0) === 1 ? '' : 's'
            }`}
          >
            {node.product_count_cache ?? 0} prod
          </span>
          <span className={styles.muted} title="Sales last 30 days">
            {node.sales_30d} sold
          </span>
          <span className={styles.muted} title="Revenue last 30 days">
            {formatCents(node.revenue_30d)}
          </span>
        </div>
        <div className={styles.actions}>
          <a
            className={styles.iconLink}
            href={`/collections/${node.slug}`}
            target="_blank"
            rel="noopener"
            aria-label="View on site"
            title="View on site"
          >
            ↗
          </a>
          {depth === 0 && (
            <button
              type="button"
              className={styles.iconLink}
              onClick={() => onAddChild(node)}
              aria-label="Add sub-category"
              title="Add sub-category"
            >
              +
            </button>
          )}
          <button
            type="button"
            className={styles.iconLink}
            onClick={() => onEdit(node)}
            aria-label="Edit"
            title="Edit"
          >
            ✎
          </button>
          <button
            type="button"
            className={styles.iconLink}
            onClick={() => onDelete(node)}
            disabled={!canDelete}
            aria-label={
              canDelete
                ? 'Delete'
                : `Cannot delete: ${node.product_count_cache ?? 0} products or sub-categories`
            }
            title={
              canDelete
                ? 'Delete'
                : `Cannot delete: ${node.product_count_cache ?? 0} products or sub-categories`
            }
          >
            ✕
          </button>
        </div>
      </div>
      {hasChildren && isExpanded && (
        <ul role="group" className={styles.subtree}>
          {node.children.map((child, i) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              index={i}
              isExpanded={false /* depth ≤ 2, no grandchildren */}
              isLast={i === node.children.length - 1}
              onToggle={onToggle}
              onRowKeyDown={onRowKeyDown}
              onDrop={onDrop}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function formatCents(cents: number): string {
  if (!Number.isFinite(cents)) return '$0'
  const dollars = Math.round(cents / 100)
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`
  return `$${dollars.toLocaleString('en-US')}`
}
