# LinkedIn Carousel Export Guide

## Quick Export (2 minutes)

1. **Open carousel in Chrome**
   ```bash
   open apps/linkedin-generator/carousel.html
   ```

2. **Print to PDF**
   - Press `Cmd+P` (Mac) or `Ctrl+P` (Windows)
   - **Paper size**: Custom → `1080 × 1080 px` (square)
   - **Margins**: None
   - **Scale**: 100%
   - **Background graphics**: ✅ Enabled
   - Click "Save as PDF"

3. **Upload to LinkedIn**
   - Create new post
   - Attach PDF
   - LinkedIn auto-splits into 6 carousel slides

## What You're Exporting

**6-slide LinkedIn carousel** showcasing Escribano's engineering discipline:

| Slide | Title | Message |
|-------|-------|---------|
| 1 | Hook | "What AI-built code actually looks like" + proof grid |
| 2 | Structure | Clean architecture tree (explicit directories) |
| 3 | Interfaces | Typed ports (CaptureSource, IntelligenceService) |
| 4 | Decisions | ADR-009 (Always-On Recorder architecture) |
| 5 | Validation | Research spike + 3 merged PRs (#25, #29, #30) |
| 6 | Output | Real artifact from the pipeline |

## Design System

- **Format**: 1080×1080px (1:1 square, LinkedIn standard)
- **Theme**: Dark editorial (matches escribano.work landing)
- **Typography**: Cormorant Garamond + Spectral + DM Sans + Monaco
- **Accents**: Amber/olive muted palette

## Print Settings (Detailed)

### Chrome (Recommended)
1. File → Print (or `Cmd+P`)
2. **Destination**: "Save as PDF"
3. **Layout**: Portrait
4. **Paper size**: Custom
   - Width: `1080 px`
   - Height: `1080 px`
5. **Margins**: None
6. **Scale**: 100% (default)
7. **Background graphics**: Enabled
8. **Headers/footers**: None (default)
9. Click "Save"

### Safari
1. File → Export as PDF
2. Should auto-detect correct dimensions
3. Ensure "Show details" is OFF
4. Save

### Firefox
1. File → Print (or `Ctrl+P`)
2. **Printer**: "Print to File"
3. **Format**: PDF
4. **Paper size**: Custom → 1080×1080 px
5. Click "Print"

## Troubleshooting

**Issue**: Slides appear stretched vertically in LinkedIn preview
- **Cause**: LinkedIn's carousel preview is conservative with spacing
- **Expected**: Looks fine once uploaded; carousel posts render correctly

**Issue**: Text is cut off at bottom of slides
- **Cause**: Print scale is not 100%
- **Fix**: Ensure "Scale" is set to 100% in print dialog

**Issue**: Colors are washed out
- **Cause**: "Background graphics" is disabled
- **Fix**: Ensure "Background graphics" is enabled in print settings

**Issue**: Slides split across pages
- **Cause**: "Fit to page" is enabled
- **Fix**: Ensure "Fit to page" is OFF

## Files

```
apps/linkedin-generator/
├── carousel.html       # Main carousel (359 lines)
├── carousel.css        # Styling (795 lines)
├── README.md           # Design system + customization
├── EXPORT.md           # This file
└── sources/
    ├── AGENTS.md       # Architecture tree
    ├── src/0_types.ts  # Interfaces
    ├── docs/adr/009-always-on-recorder.md  # Decision
    ├── docs/SCREENCAPTUREKIT-POC-SPIKE.md  # Research
    └── README.md       # Output artifact
```

## Customization

### Update Content
Edit `carousel.html` directly:
- Slide 1: Lines 11-49
- Slide 2: Lines 51-99
- ... etc

All content is hardcoded for maximum PDF compatibility.

### Change Colors
Edit `:root` in `carousel.css`:
```css
--terracotta: #E8A838;  /* Accent color */
--olive: #4A9E7A;       /* Success/info color */
```

### Adjust Slide Dimensions
Edit `@page` rule in `carousel.css`:
```css
@media print {
  @page {
    size: 1080px 1350px;  /* Change dimensions here */
  }
}
```

## Browser Compatibility

**Best**: Chrome 120+
**Good**: Safari 17+, Firefox 120+
**Avoid**: Edge, older browsers (PDF rendering may be inconsistent)

## Technical Notes

- ✅ No JavaScript (pure HTML/CSS)
- ✅ Print-optimized with `@media print` rules
- ✅ Self-contained (single CSS file, no external assets except fonts)
- ✅ Responsive typography for readability
- ✅ Dark mode colors with exact color matching

## Post Strategy

**Suggested LinkedIn post caption**:

---

Escribano is an AI-built codebase. But what does that actually mean?

Not chaos. Not shortcuts. Not 800 lines in index.js.

It's a screen recording tool that runs entirely locally. Built by AI agents. Structured like a real project:
- Explicit architecture
- Typed ports (swappable implementations)
- Written ADRs
- Research spikes before decisions
- Real shipped artifacts

The secret isn't "better prompts." It's **explicit constraints**. Structure, interfaces, documentation, and validation.

This carousel walks through how one AI-built project maintained engineering discipline.

Swipe for the 5 things that kept drift from winning.

---

