// src/shared/utils/schemePackVisibility.ts
// Which university scheme packs the Scheme Packs page offers (HOD round).
//
// The three legacy non-engineering Karnataka presets are HIDDEN, not deleted:
//   • Bengaluru City University — SEP 2024   (BCU_SEP_2024)
//   • Karnatak University Dharwad — NEP CBAE (KUD_NEP_CBAE)
//   • Generic — NEP 2020 (60 + 40)           (GENERIC_NEP_2020)
// This product runs B.E./B.Tech colleges, so the picker lists the engineering
// packs (and any college custom pack) only. The pack objects stay in
// src/shared/types/schemePack.ts and stay in SCHEME_PACK_PRESETS so that:
//   • a college whose colleges/{id}.schemePackId still points at one of them
//     keeps resolving its real rules end-to-end (no silent regrade), and
//   • DEFAULT_SCHEME_PACK (pre-G1 behaviour) is unchanged.
// Plug back = drop the code from HIDDEN_SCHEME_PACK_CODES below.

/** Preset codes kept out of the Scheme Packs picker. */
export const HIDDEN_SCHEME_PACK_CODES: readonly string[] = [
  'BCU_SEP_2024',
  'KUD_NEP_CBAE',
  'GENERIC_NEP_2020',
];

/** True when a preset code (or doc id) is hidden from the picker. */
export function isHiddenSchemePack(codeOrId: string | null | undefined): boolean {
  if (!codeOrId) return false;
  return HIDDEN_SCHEME_PACK_CODES.includes(codeOrId);
}

/**
 * Drop hidden presets from a listed-pack array. Custom college packs are
 * never hidden — only the built-in presets named above, matched on either
 * `code` or `id` (built-in presets use the same string for both).
 */
export function filterVisibleSchemePacks<
  T extends { pack: { code: string; id: string }; origin: 'preset' | 'custom' },
>(items: readonly T[]): T[] {
  return items.filter((item) => {
    if (item.origin !== 'preset') return true;
    return !isHiddenSchemePack(item.pack.code) && !isHiddenSchemePack(item.pack.id);
  });
}
