# Vriddhi — pitch & print collateral

Sales and outreach assets for Vriddhi (the academic operating system for Indian
colleges). All assets use the brand system from `brand/` (teal `#14B8A6` family,
slate `#0F172A`, hero mark) and the official logo lockups from
`brand/logo/png/`.

Every piece exists in **English** and **Kannada (ಕನ್ನಡ)**:

| File | What it is | Format |
| --- | --- | --- |
| `Vriddhi_Pitch_Deck.pptx` | 12-slide 16:9 investor/partner pitch deck (English) | PowerPoint |
| `Vriddhi_Pitch_Deck_KN.pptx` | Same deck, fully in Kannada | PowerPoint |
| `Vriddhi_Booklet.pdf` | 10-page A4 product booklet, English | PDF, print-ready |
| `Vriddhi_Booklet_KN.pdf` | Same booklet, fully in Kannada | PDF, print-ready |
| `Vriddhi_Brochure.pdf` | A4 landscape tri-fold brochure, English | PDF, print-ready |
| `Vriddhi_Brochure_KN.pdf` | Same brochure, fully in Kannada | PDF, print-ready |

## Slide / page map

**Pitch deck (12):** title · the problem · the solution · platform overview ·
AI engine · India-first (languages + UUCMS) · every role · business model ·
why Vriddhi · traction & roadmap · the ask · contact.

**Booklet (10):** 1 cover · 2 welcome + contents · 3 why · 4 platform · 5
faculty · 6 students · 7 AI & languages · 8 built for Indian universities ·
9 platform, security & getting started · 10 contact.

**Brochure (tri-fold):** print both sides of one A4 sheet and fold into thirds.
Front side: front cover | inside left (what is Vriddhi + modules) | inside
right (AI engine + six languages). Back side: inside flap (why colleges
switch) | back cover (contact) | inside centre (Karnataka-ready + get
started).

## Regenerating

```bash
python3 -m venv /home/user/.venv
/home/user/.venv/bin/pip install python-pptx fpdf2 pillow pypdfium2 fonttools matplotlib uharfbuzz
cd marketing
/home/user/.venv/bin/python build_pitch_deck.py     # EN deck
/home/user/.venv/bin/python build_kn_deck.py        # KN deck
/home/user/.venv/bin/python build_booklet.py        # EN booklet
/home/user/.venv/bin/python build_kn_booklet.py     # KN booklet
/home/user/.venv/bin/python build_brochure.py       # EN brochure
/home/user/.venv/bin/python build_kn_brochure.py    # KN brochure
```

### How the builders work

- `build_pitch_deck.py` / `build_kn_deck.py` — python-pptx, 16:9, real logo
  PNGs + hero mark from `brand/`. The KN deck sets **Noto Sans Kannada** on
  every run (covers Latin too); PowerPoint shapes the text at render time
  (Nirmala UI fallback on Windows).
- `build_booklet.py` / `build_brochure.py` — fpdf2, A4, Inter TTFs from
  `brand/tools/fonts/`.
- `build_kn_booklet.py` / `build_kn_brochure.py` — fpdf2 vector chrome + a
  **shaped-Kannada text layer** produced by `kn_text.py`. fpdf2 cannot shape
  Indic scripts, so each page's text is shaped with uharfbuzz (Noto Sans
  Kannada), drawn as vector outlines with matplotlib, rasterised at 288 dpi
  with a transparent background, and overlaid on the fpdf2 page.
  `kn_text.py` also resolves composite glyphs (e.g. ಮ್, ಸ್) and caches the
  converted contours per glyph.
- `fonts/` — Noto Sans Kannada (variable + instanced Regular/SemiBold/Bold).
- `pdf_helpers.py` — shared fpdf2 page/chrome helpers (palette, rounded
  rects, kickers, headers, footers, logo paths).

## Before you send

- **Contact details** (`hello@vriddhi.in`, `www.vriddhi.in`) are placeholders
  in **all six** deliverables — search the builder scripts for `vriddhi.in`,
  update, and rebuild.
- English PPTX typefaces **Inter**; Kannada PPTX typefaces **Noto Sans
  Kannada**. Recipients without those fonts get a system fallback — for
  pixel-exact presentations, export to PDF first (the PDFs here are already
  pixel-exact).
- Business-model slide intentionally states no prices — tailor plans per
  conversation.
- The tri-fold brochure prints **double-sided** on A4 landscape; trim marks
  are not included (full-bleed panels are designed to the sheet edge).

## Storage (audit P4-14)

The generated binaries here (the two PPTX decks, four PDFs and the ZIP —
~13 MB) do not belong in git long-term: they are reproducible from the
builder scripts plus `fonts/`. The plan is to upload them to a GitHub
Release and `git rm` them from the tree (from a machine with release-upload
access, e.g.):

```bash
gh release create assets/marketing-kit-v1 marketing/*.pdf marketing/*.pptx \
  marketing/*.zip --title "Marketing kit (pitch & print collateral)"
```
