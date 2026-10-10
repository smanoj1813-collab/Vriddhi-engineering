# UI/UX Modernization Guide — Vriddhi Academic Management System

## 🎨 Design System Overview

The Vriddhi platform uses a **light-first design system** with proper dark mode support. All pages should follow this pattern.

### Core Principles

1. **Light Mode First**: Default styles should be for light mode
2. **Dark Mode Variants**: Use `dark:` prefix for dark mode overrides
3. **Semantic Colors**: Use design system CSS classes instead of hardcoded colors
4. **Consistent Spacing**: Use Tailwind's spacing scale
5. **Accessible Contrast**: Ensure WCAG AA compliance in both modes

---

## 🎯 Design System Classes

### Background Colors
```tsx
// ❌ WRONG (dark-mode-only)
className="bg-slate-900"
className="bg-slate-800"

// ✅ CORRECT (light-first with dark variant)
className="bg-slate-50 dark:bg-[#0b0f19]"
className="bg-white dark:bg-[#131b2e]"
```

### Card Containers
```tsx
// ❌ WRONG
className="bg-slate-800/50 border border-slate-700 rounded-xl"

// ✅ CORRECT
className="glass-card"
// or
className="vriddhi-card"
// or
className="bg-white dark:bg-[#131b2e] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm"
```

### Text Colors
```tsx
// ❌ WRONG
className="text-white"
className="text-slate-400"
className="text-slate-300"

// ✅ CORRECT
className="text-slate-900 dark:text-white"
className="text-slate-600 dark:text-slate-400"
className="text-slate-700 dark:text-slate-300"
```

### Input Fields
```tsx
// ❌ WRONG
className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white"

// ✅ CORRECT
className="input-field"
// or
className="w-full px-4 py-2.5 rounded-xl bg-white text-slate-900 border border-slate-200 
           focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20
           dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700"
```

### Buttons
```tsx
// Primary Button
className="btn-primary"
// or
className="px-5 py-2.5 font-medium rounded-xl bg-teal-600 hover:bg-teal-700 text-white shadow-sm"

// Secondary Button
className="btn-secondary"
// or
className="px-5 py-2.5 font-medium rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200
           dark:bg-slate-800 dark:hover:bg-slate-800 dark:text-slate-200 dark:border-slate-700"
```

### Tables
```tsx
// Table Container
className="table-container"
// or
className="glass-card overflow-x-auto"

// Table Header
className="table-header"
// or
className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider
           text-slate-600 bg-slate-50/80 border-b border-slate-200
           dark:text-slate-400 dark:bg-slate-900/60 dark:border-slate-800"

// Table Cell
className="table-cell"
// or
className="px-5 py-4 text-sm text-slate-700 border-b border-slate-100
           dark:text-slate-300 dark:border-slate-800/60"
```

### Page Container
```tsx
// ❌ WRONG
className="min-h-screen bg-slate-900 p-6"

// ✅ CORRECT
className="page-container"
// or
className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8"
```

### Status Badges
```tsx
// Active
className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"

// Inactive
className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"

// Pending
className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
```

---

## 🔧 Common Patterns to Fix

### 1. Loading States
```tsx
// ❌ WRONG
<div className="min-h-screen bg-slate-900 flex items-center justify-center">
  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-400" />
</div>

// ✅ CORRECT
<div className="min-h-[60vh] flex items-center justify-center">
  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 dark:border-teal-400" />
</div>
```

### 2. Modals
```tsx
// ❌ WRONG
<div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
  <h2 className="text-xl font-bold text-white">Title</h2>
</div>

// ✅ CORRECT
<div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-xl">
  <h2 className="text-xl font-bold text-slate-900 dark:text-white">Title</h2>
</div>
```

### 3. Empty States
```tsx
// ❌ WRONG
<div className="text-center py-8 text-slate-500">
  <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
  <p>No data found</p>
</div>

// ✅ CORRECT
<div className="text-center py-8 text-slate-500 dark:text-slate-400">
  <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
  <p>No data found</p>
</div>
```

### 4. Hover States
```tsx
// ❌ WRONG
className="hover:bg-slate-800"

// ✅ CORRECT
className="hover:bg-slate-100 dark:hover:bg-slate-800"
```

---

## 📋 Checklist for Page Modernization

- [ ] Replace `min-h-screen bg-slate-900` with `page-container`
- [ ] Replace `bg-slate-800` cards with `glass-card` or proper light/dark variants
- [ ] Replace `text-white` with `text-slate-900 dark:text-white`
- [ ] Replace `text-slate-400` with `text-slate-600 dark:text-slate-400`
- [ ] Replace hardcoded inputs with `input-field` class
- [ ] Replace hardcoded buttons with `btn-primary` / `btn-secondary` classes
- [ ] Add `dark:` variants for all color classes
- [ ] Use semantic colors (emerald for success, red for error, amber for warning)
- [ ] Ensure proper contrast in both light and dark modes
- [ ] Test in both light and dark themes

---

## 🚀 Status: sweep complete (2026-09-26)

All 31 checklist pages — plus every other surface found by a repo-wide
token scan — are now light-first dual-mode. The final sweep converted 400+
dark-only tokens across ~40 files, removed 233 duplicate `dark:` tokens
left behind by earlier chained-sed passes, and repaired dark-on-dark
combinations (`dark:text-slate-900` next to `dark:text-white`).

### Deliberately dark in BOTH modes (do not "fix" these)
- Modal/page backdrops: `inset-0 bg-slate-900/50-60`, `bg-black/60-80`
- Brand hero banners: `bg-gradient-to-r from-teal-900 via-slate-900 to-slate-900`
  (AIAgentPage, StudentFacultyConnect, StudentMaterials)
- Inverted CTAs: `bg-slate-900 text-white dark:bg-white dark:text-slate-900`
- Camera scanner overlay (ScanInput), desktop-only splash (DesktopViewNotice),
  blocking import overlay (ImportProgressOverlay)
- Student toast pill: `bg-slate-900/90 text-white dark:bg-slate-100/95 dark:text-slate-900`

### Verification tooling
A re-scan should report 0 unintended bare-dark tokens:
- bare `bg/from/via/to-(slate|gray)-(800|900|950)` without a `dark:` pair
- bare `text-white`/`text-slate-200..400`/`text-<color>-300|400` without a `dark:` pair
  (excluding the deliberate-dark list above)
- any duplicate `dark:` token of the same property inside one class segment

---

## 💡 Pro Tips

1. **Use VS Code Search**: Search for `bg-slate-900` or `text-white` to find dark-mode-only code
2. **Test Both Themes**: Always test your changes in both light and dark modes
3. **Use Browser DevTools**: Toggle dark mode in DevTools to test quickly
4. **Follow Existing Patterns**: Look at `SuperAdminDashboard.tsx` for reference
5. **Batch Similar Pages**: Fix pages with similar layouts together

---

## 🎨 Color Palette Reference

### Light Mode
- Background: `#f8fafc` (slate-50)
- Card: `#ffffff` (white)
- Border: `#e2e8f0` (slate-200)
- Text Primary: `#0f172a` (slate-900)
- Text Secondary: `#475569` (slate-600)
- Accent: `#0d9488` (teal-600)

### Dark Mode
- Background: `#0b0f19` (custom dark)
- Card: `#131b2e` (custom dark card)
- Border: `#1e293b` (slate-800)
- Text Primary: `#f8fafc` (slate-50)
- Text Secondary: `#94a3b8` (slate-400)
- Accent: `#14b8a6` (teal-500)

---

**Last Updated:** 2026-08-23  
**Fixed Pages:** 3/31  
**Remaining:** 28 pages
