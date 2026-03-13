# LinkedIn Carousel Generator

Export Escribano's AI-built codebase narrative as a LinkedIn carousel PDF.

## Quick Start

1. **Open in browser**
   ```bash
   open carousel.html
   ```

2. **Export to PDF**
   - Chrome: File → Print → Save as PDF
   - Safari: File → Export as PDF
   - Firefox: File → Print → Save as PDF

3. **Upload to LinkedIn**
   - Create new post
   - Attach PDF (LinkedIn auto-splits into carousel slides)

## Design System

**Inherited from** `apps/landing/assets/css/style.css`

- **Colors**: Dark graphite palette, muted amber/olive accents
- **Typography**: Cormorant Garamond (headlines), + Spectral (body) + DM Sans (labels) + SF Mono (code)
- **Ratio**: 1080×1080px (1:1 square, LinkedIn carousel standard)
- **Slides**: 6 total

## Slide Structure

| # | Title | Focus | Source |
|---|---|
| 1 | Hook | Expectation vs Reality | Custom |
| 2 | Structure | Architecture tree | `AGENTS.md:141` |
| 3 | Interfaces | Typed ports | `src/0_types.ts:364,381` |
| 4 | Decisions | ADR documentation | `docs/adr/009-always-on-recorder.md:1` |
| 5 | Discipline | Research + PRs | `docs/SCREENCAPTUREKIT-POC-SPIKE.md:1` + PRs #25, #29, #30 |
| 6 | Output | Shipped artifact | `README.md:16` |

## Print Settings

**Chrome recommended**:
- Layout: Portrait
- Margins: None
- Scale: 100%
- Background graphics: Enabled
- Headers/footers: None

## File Structure

```
apps/linkedin-generator/
├── carousel.html      # Main carousel file
├── carousel.css       # Styling
└── README.md           # This file
```

## Customization

### Fonts
Fonts are loaded via Google Fonts CDN. If offline export is needed:
1. Download fonts locally
2. Update `@import` in `carousel.css` to reference local files

### Colors
All colors use CSS custom properties defined in `:root`. Modify in `carousel.css`:
```css
:root {
  --terracotta: #E8A838;  /* Change accent color */
  --olive: #4A9E7A;      /* Change success color */
}
```

### Content
All slide content is hardcoded in `carousel.html`. To update:
1. Edit text directly in HTML
2. Ensure source references match actual repo content
3. Keep captions under ~20 words per slide

## Technical Notes

- **No JavaScript required**: Pure HTML/CSS for maximum PDF compatibility
- **Print-optimized**: Uses `@media print` rules for consistent PDF output
- **Self-contained**: All styles inline, single CSS file
- **Landing-inspired**: Visual language matches escribano.work

## Browser Compatibility

Tested for PDF export in:
- Chrome 120+
- Safari 17+
- Firefox 120+

Edge and other browsers may have inconsistent PDF rendering.

## Print Instructions (Detailed)

The carousel CSS forces exact 1080×1350px page dimensions for LinkedIn carousel format.

### Steps to Export PDF

1. **Open in Chrome/Safari**: http://localhost:8888/carousel.html
2. **Print**: `Cmd+P` (Mac) or `Ctrl+P` (Windows)
3. **Critical settings**:
   - **Paper size**: Custom → `1080 × 1350 px`
   - **Margins**: None
   - **Scale**: 100%
   - **Background graphics**: ✅ Enabled
4. **Save as PDF**

### What the CSS Does

```css
@media print {
  @page {
    size: 1080px 1350px;  /* Forces exact LinkedIn carousel size */
    margin: 0;             /* No margins */
  }
  
  .slide {
    width: 1080px;         /* Explicit dimensions */
    height: 1350px;
    page-break-after: always;  /* One slide per page */
    overflow: hidden;       /* No content overflow */
  }
}
```

### Troubleshooting

**Issue**: Slides split across pages
- **Fix**: Ensure "Fit to page" is OFF in print settings

**Issue**: Text cut off at bottom
- **Fix**: Content is padded to avoid footer overlap (120px reserved)

**Issue**: Colors look washed out
- **Fix**: Ensure "Background graphics" is enabled in print dialog
