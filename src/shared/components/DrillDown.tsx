// src/shared/components/DrillDown.tsx
//
// Generic drill-down shell: overview → level 2 → … → item list.
//
// Pages never write their own breadcrumb/card/flat-list logic — they only
// supply grouping functions. The component holds the full flat items array
// in a useMemo and groups in-memory. **Do not "optimise" this to lazy-load
// per level**; fetching on card-click turns one page load into 1+N queries
// per user session, which is how read counts quietly triple (see
// docs/firestore-cost-controls.md, C1/C3).

import React, { useCallback, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  InputAdornment,
  Link,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  ArrowBack as ArrowBackIcon,
  ChevronRight as ChevronRightIcon,
  Search as SearchIcon,
  ViewAgenda as ViewAgendaIcon,
  ViewList as ViewListIcon,
} from '@mui/icons-material'

export interface DrillGroup<T> {
  label: string
  subLabel?: string
  chips?: string[]
  items: T[]
}

export interface DrillLevelSpec<T> {
  title: string
  group: (items: T[]) => Array<DrillGroup<T>>
}

export interface DrillDownProps<T> {
  /** The fully-fetched flat array. Grouping is in-memory; no re-queries. */
  items: T[]
  /** One entry per drill step. The last level's groups hold the leaf items. */
  levels: Array<DrillLevelSpec<T>>
  /** Stable row identity (e.g. `(row) => row.id`). */
  itemKey: (item: T) => string
  /** Row renderer for a leaf item in the last level. */
  renderItem: (item: T) => React.ReactNode
  /** Haystack per item for search filtering (e.g. name + code + faculty). */
  searchText?: (item: T) => string
  searchPlaceholder?: string
  /** Singular label for items (e.g. "subject", "record"). Pluralised with "s" by default. */
  itemUnit?: string
  /** Extra toolbar content (filters, actions, export). */
  toolbar?: React.ReactNode
  /** Shown when the filtered list is empty. */
  emptyState?: React.ReactNode
  /** Start drilled in (true, default) or in flat-list view. */
  defaultDrill?: boolean
  /** Loading state while the caller fetches `items`. */
  loading?: boolean
  /** Error message to display above the content. */
  error?: string | null
  /** Optional title override for the top of the shell. */
  title?: string
}

const DEFAULT_EMPTY = (
  <Typography variant="body2" color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
    No items match the current filters.
  </Typography>
)

/**
 * Apply a case-insensitive substring filter across every item's search haystack.
 * Runs BEFORE grouping so card counts reflect the filter.
 */
function filterItems<T>(items: T[], query: string, haystack?: (item: T) => string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  if (!haystack) return items
  return items.filter((item) => (haystack(item) || '').toLowerCase().includes(q))
}

export default function DrillDown<T>({
  items,
  levels,
  itemKey,
  renderItem,
  searchText,
  searchPlaceholder = 'Search…',
  itemUnit = 'item',
  toolbar,
  emptyState,
  defaultDrill = true,
  loading = false,
  error = null,
  title,
}: DrillDownProps<T>) {
  // Breadcrumb path is an array of LABELS, not indices. When data refreshes
  // under the user (e.g. a new semester appears), we re-walk the levels and
  // drop stale labels silently rather than crashing.
  const [path, setPath] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'drill' | 'flat'>(defaultDrill ? 'drill' : 'flat')

  const pluralUnit = `${itemUnit}s`

  const filtered = useMemo(
    () => filterItems(items, query, searchText),
    [items, query, searchText],
  )

  // Walk the levels from the root, applying the current breadcrumb path.
  // At depth `d`, groups come from levels[d].group(itemsPassedThrough);
  // the chosen group's items are then fed into level d+1, etc.
  const walk = useMemo(() => {
    const groupsPerLevel: Array<Array<DrillGroup<T>>> = []
    let carry: T[] = filtered
    let activeGroup: DrillGroup<T> | null = null
    let activeGroupIndex = -1

    for (let depth = 0; depth < levels.length; depth++) {
      const groups = levels[depth].group(carry)
      groupsPerLevel.push(groups)

      const wanted = path[depth]
      const idx = wanted ? groups.findIndex((g) => g.label === wanted) : -1
      if (idx >= 0) {
        activeGroup = groups[idx]
        activeGroupIndex = idx
        carry = groups[idx].items
      } else {
        // Path doesn't match current data (stale label after refresh) —
        // drop everything below this depth.
        activeGroup = null
        activeGroupIndex = -1
        break
      }
    }

    return {
      groupsPerLevel,
      activeGroup,
      activeGroupIndex,
      currentDepth: activeGroup ? path.length : 0,
      leafItems: activeGroup ? activeGroup.items : carry,
    }
  }, [filtered, levels, path])

  // Sync path state if a label went stale — drop the broken tail.
  const validPath = useMemo(() => {
    const rebuilt: string[] = []
    let carry: T[] = filtered
    for (let depth = 0; depth < levels.length; depth++) {
      const wanted = path[depth]
      if (!wanted) break
      const groups = levels[depth].group(carry)
      const match = groups.find((g) => g.label === wanted)
      if (!match) break
      rebuilt.push(wanted)
      carry = match.items
    }
    return rebuilt
  }, [filtered, levels, path])

  React.useEffect(() => {
    if (validPath.length !== path.length) {
      setPath(validPath)
    }
  }, [validPath, path.length])

  const currentLevelIndex = validPath.length
  const isAtLeaf = currentLevelIndex >= levels.length - 1 && validPath.length === levels.length
  const isFlat = view === 'flat'

  const handleDrillIn = useCallback((label: string) => {
    setPath((prev) => [...prev, label])
  }, [])

  const handleBreadcrumb = useCallback((depth: number) => {
    setPath((prev) => prev.slice(0, depth))
  }, [])

  const handleBack = useCallback(() => {
    setPath((prev) => prev.slice(0, -1))
  }, [])

  const handleViewChange = useCallback((_: unknown, next: 'drill' | 'flat' | null) => {
    if (next === null) return
    setView(next)
    if (next === 'flat') setPath([]) // reset drill path when flipping to flat
  }, [])

  // ─── Rendering helpers ──────────────────────────────────────────────────

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress size={28} />
      </Box>
    )
  }

  const headerTitle = title ?? (levels[0]?.title || 'Drill down')

  return (
    <Box>
      {/* Header */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 2, alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {headerTitle}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {filtered.length} {filtered.length === 1 ? itemUnit : pluralUnit}
            {query && <> · filtered by “{query}”</>}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          {searchText && (
            <TextField
              size="small"
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{ minWidth: 220 }}
            />
          )}
          <ToggleButtonGroup
            size="small"
            value={view}
            exclusive
            onChange={handleViewChange}
            aria-label="View mode"
          >
            <ToggleButton value="drill" aria-label="Drill-down view">
              <Tooltip title="Drill-down view">
                <ViewAgendaIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="flat" aria-label="Flat list">
              <Tooltip title="Flat list">
                <ViewListIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </Stack>

      {toolbar && <Box sx={{ mb: 2 }}>{toolbar}</Box>}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
      )}

      {/* Breadcrumbs (drill view only) */}
      {!isFlat && validPath.length > 0 && (
        <Card variant="outlined" sx={{ mb: 2 }}>
          <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton size="small" onClick={handleBack} aria-label="Go back">
              <ArrowBackIcon fontSize="small" />
            </IconButton>
            <Breadcrumbs separator={<ChevronRightIcon fontSize="small" />} aria-label="Breadcrumb">
              <Link
                component="button"
                variant="body2"
                underline="hover"
                color="inherit"
                onClick={() => handleBreadcrumb(0)}
                sx={{ cursor: 'pointer' }}
              >
                {levels[0]?.title || 'All'}
              </Link>
              {validPath.map((label, i) => {
                const isLast = i === validPath.length - 1
                return isLast ? (
                  <Typography key={label} variant="body2" color="text.primary" sx={{ fontWeight: 600 }}>
                    {label}
                  </Typography>
                ) : (
                  <Link
                    key={label}
                    component="button"
                    variant="body2"
                    underline="hover"
                    color="inherit"
                    onClick={() => handleBreadcrumb(i + 1)}
                    sx={{ cursor: 'pointer' }}
                  >
                    {label}
                  </Link>
                )
              })}
            </Breadcrumbs>
          </Box>
        </Card>
      )}

      {/* Content */}
      {isFlat || validPath.length === 0 ? (
        isFlat ? (
          <FlatItemList<T>
            items={filtered}
            itemKey={itemKey}
            renderItem={renderItem}
            emptyState={emptyState || DEFAULT_EMPTY}
            itemUnit={itemUnit}
          />
        ) : (
          <GroupGrid<T>
            groups={walk.groupsPerLevel[0] || []}
            onDrill={handleDrillIn}
            pluralUnit={pluralUnit}
            isLeaf={levels.length === 1}
            renderItem={renderItem}
            itemKey={itemKey}
            emptyState={emptyState || DEFAULT_EMPTY}
          />
        )
      ) : isAtLeaf ? (
        <FlatItemList<T>
          items={walk.leafItems}
          itemKey={itemKey}
          renderItem={renderItem}
          emptyState={emptyState || DEFAULT_EMPTY}
          itemUnit={itemUnit}
        />
      ) : (
        <GroupGrid<T>
          groups={walk.groupsPerLevel[currentLevelIndex] || []}
          onDrill={handleDrillIn}
          pluralUnit={pluralUnit}
          isLeaf={currentLevelIndex === levels.length - 1}
          renderItem={renderItem}
          itemKey={itemKey}
          emptyState={emptyState || DEFAULT_EMPTY}
        />
      )}
    </Box>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────

function GroupGrid<T>({
  groups,
  onDrill,
  pluralUnit,
  isLeaf,
  renderItem,
  itemKey,
  emptyState,
}: {
  groups: Array<DrillGroup<T>>
  onDrill: (label: string) => void
  pluralUnit: string
  isLeaf: boolean
  renderItem: (item: T) => React.ReactNode
  itemKey: (item: T) => string
  emptyState: React.ReactNode
}) {
  if (groups.length === 0) {
    return <>{emptyState}</>
  }
  if (isLeaf) {
    // Leaf groups: show the items inside each group (grouped flat list).
    return (
      <Stack spacing={2}>
        {groups.map((group) => (
          <Card key={group.label} variant="outlined">
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{group.label}</Typography>
                  {group.subLabel && (
                    <Typography variant="body2" color="text.secondary">{group.subLabel}</Typography>
                  )}
                </Box>
                <Chip size="small" label={`${group.items.length} ${pluralUnit}`} variant="outlined" />
              </Box>
              {group.chips && group.chips.length > 0 && (
                <Stack direction="row" spacing={0.5} useFlexGap sx={{ mb: 1, flexWrap: 'wrap' }}>
                  {group.chips.map((chip) => (
                    <Chip key={chip} label={chip} size="small" variant="outlined" />
                  ))}
                </Stack>
              )}
              <Divider sx={{ my: 1 }} />
              <Stack spacing={1} sx={{ mt: 1 }}>
                {group.items.map((item) => (
                  <Box key={itemKey(item)}>{renderItem(item)}</Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
    )
  }
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(2, 1fr)',
          md: 'repeat(3, 1fr)',
          lg: 'repeat(4, 1fr)',
        },
      }}
    >
      {groups.map((group) => (
        <Card key={group.label} variant="outlined" sx={{ display: 'flex', flexDirection: 'column' }}>
          <CardActionArea onClick={() => onDrill(group.label)} sx={{ flex: 1, p: 2 }}>
            <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                  {group.label}
                </Typography>
                <Chip
                  size="small"
                  label={group.items.length}
                  color="primary"
                  variant="outlined"
                  sx={{ fontWeight: 600 }}
                />
              </Box>
              {group.subLabel && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {group.subLabel}
                </Typography>
              )}
              {group.chips && group.chips.length > 0 && (
                <Stack direction="row" spacing={0.5} useFlexGap sx={{ mt: 1, flexWrap: 'wrap' }}>
                  {group.chips.slice(0, 3).map((chip) => (
                    <Chip key={chip} label={chip} size="small" variant="outlined" />
                  ))}
                  {group.chips.length > 3 && (
                    <Chip size="small" label={`+${group.chips.length - 3}`} variant="outlined" />
                  )}
                </Stack>
              )}
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.5 }}>
                <Button
                  size="small"
                  endIcon={<ChevronRightIcon />}
                  sx={{ textTransform: 'none' }}
                  tabIndex={-1}
                >
                  Open
                </Button>
              </Box>
            </CardContent>
          </CardActionArea>
        </Card>
      ))}
    </Box>
  )
}

function FlatItemList<T>({
  items,
  itemKey,
  renderItem,
  emptyState,
  itemUnit,
}: {
  items: T[]
  itemKey: (item: T) => string
  renderItem: (item: T) => React.ReactNode
  emptyState: React.ReactNode
  itemUnit: string
}) {
  if (items.length === 0) {
    return <>{emptyState}</>
  }
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={1} divider={<Divider flexItem />}>
          {items.map((item) => (
            <Box key={itemKey(item)}>{renderItem(item)}</Box>
          ))}
        </Stack>
      </CardContent>
    </Card>
  )
}
