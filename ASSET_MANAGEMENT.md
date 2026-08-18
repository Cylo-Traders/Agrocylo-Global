# Binary Asset Management Evaluation — Issue #724

This document evaluates the handling of large font and image assets currently committed to the repository, with recommendations for future management.

**Date:** 2026-07-30  
**Current status:** Evaluation (not implemented; maintainer decision required)

---

## Current Asset Inventory

### Fonts: `client/src/fonts/MontserratAlternates/`

| File | Size | Count | Total |
|------|------|-------|-------|
| `.ttf` files | ~200 KB each | 8 | ~1.6 MB |

**Status:** Directly committed to Git

**Usage:** Next.js `src/app/layout.tsx` (hard-coded local import)

```javascript
// Current approach
import localFont from 'next/font/local';
const montserrat = localFont({
  src: [
    { path: '../fonts/MontserratAlternates/MontserratAlternates-Bold.ttf', weight: '700' },
    // ... 7 more entries
  ]
});
```

---

### Hero Images: `client/public/images/`

| File | Format | Size |
|------|--------|------|
| `home-hero.avif` | AVIF | ~1.3 MB |
| `market-hero.avif` | AVIF | ~1.0 MB |

**Status:** Directly committed to Git

**Total image assets:** ~2.3 MB

**Usage:** Next.js pages import via relative URL

---

## Problem Statement

1. **Repository size** — Combined ~4 MB of binary assets increases clone time and storage
2. **Bandwidth** — Every contributor clone downloads these assets
3. **Git history** — Assets can't be easily pruned; they bloat `git log`
4. **Scalability** — If more hero images are added (product listings, regional variants), repo size grows quickly
5. **Maintenance** — No versioning strategy for assets; updates overwrite history

---

## Evaluation: Fonts

### Option A: Keep Local (Current)
**Pros:**
- Works offline
- No external dependencies
- Full control over versions

**Cons:**
- Adds ~1.6 MB to every clone
- Hard to update multiple fonts
- No browser caching across projects

**Cost:** +1.6 MB per clone

---

### Option B: Use Google Fonts via CDN
**Approach:** Replace local `.ttf` files with `next/font/google`

```javascript
import { Montserrat_Alternates } from 'next/font/google';
const montserrat = Montserrat_Alternates({
  weight: ['700', '400'], // select needed weights
  display: 'swap', // FOUT fallback
});
```

**Pros:**
- **Zero repo size impact**
- Automatic browser caching (across sites using Google Fonts)
- Next.js optimizes delivery (generates `@font-face`)
- Reduces repo by ~1.6 MB

**Cons:**
- Requires internet (not offline-usable, but reasonable for a web app)
- Slight latency dependency on Google's CDN
- Montserrat Alternates may not be available on Google Fonts (need to check)

**Cost:** Minimal; same visual result

**Recommendation:** ✅ **Preferred**

---

### Option C: Self-host via external CDN (e.g., Cloudflare, AWS S3)
**Approach:** Upload `.ttf` files to CDN, reference via URL

```css
@font-face {
  font-family: 'Montserrat Alternates';
  src: url('https://cdn.agrocylo.com/fonts/MontserratAlternates-Bold.ttf');
}
```

**Pros:**
- Full control over delivery
- Can version fonts easily
- Removes from Git entirely

**Cons:**
- Adds infrastructure cost (though minimal for fonts)
- Need to maintain CDN setup
- More complex than Google Fonts

**Cost:** Small infrastructure overhead

---

## Evaluation: Hero Images

### Option A: Keep Local (Current)
**Pros:**
- Works offline
- No external dependencies
- Full control

**Cons:**
- Adds ~2.3 MB to every clone
- Not optimal for image delivery (no transformation/optimization)
- Scalability issue if more variants are added

**Cost:** +2.3 MB per clone; grows with each new image

---

### Option B: Use External Image CDN (Cloudinary, Imgix, Vercel Image Optimization)
**Approach:** Upload images to CDN, reference via URL in Next.js `<Image>` component

```tsx
import Image from 'next/image';

export default function Hero() {
  return (
    <Image
      src="https://cdn.agrocylo.com/images/home-hero.avif"
      alt="Agrocylo home hero"
      width={1920}
      height={1080}
      priority
    />
  );
}
```

**Pros:**
- **Zero repo size impact**
- Automatic image optimization (responsive sizing, format negotiation)
- Built-in caching headers (browser + CDN)
- Easy to add variants (mobile, tablet, desktop crops)
- Reduces repo by ~2.3 MB

**Cons:**
- Requires internet (reasonable for web app)
- CDN cost (minimal for static assets; Vercel Image Optimization is free-tier included)
- Dependency on external service

**Cost:** Free (Vercel) or ~$5-10/month (Cloudinary, Imgix) for typical usage

**Recommendation:** ✅ **Preferred** for future images; consider migrating existing

---

### Option C: Self-host via S3 + CloudFront
**Approach:** Use AWS S3 + CloudFront for image delivery

**Pros:**
- Full control
- AWS integration for other infrastructure

**Cons:**
- More complex setup
- AWS costs (though low for static assets)

**Cost:** $0.50-2/month for typical usage

**Recommendation:** Viable alternative if AWS is already infrastructure-of-choice

---

## Recommendation

### Immediate Actions (Low priority, no blocker)

1. **For fonts:** 
   - ✅ Verify Montserrat Alternates availability on Google Fonts
   - If available: Migrate to `next/font/google` and remove local `.ttf` files (~1.6 MB savings)
   - If not available: Use Google Fonts closest alternative or proceed to Option C (self-host)

2. **For images:**
   - ✅ No immediate change needed (current images work)
   - For future hero images: Upload to Vercel Image Optimization (free, built-in)
   - Consider migrating existing 2 images to CDN (optional; ~2.3 MB savings)

### Future Guidelines

- **New fonts:** Use `next/font/google` or self-hosted CDN, not Git-committed `.ttf`
- **New images:** Upload to CDN; commit only reference URLs in code
- **Large assets:** Never commit to Git without prior discussion (repo bloat concerns)

---

## Impact Summary

| Scenario | Repo Size Savings | Effort | Priority |
|----------|------------------|--------|----------|
| Migrate fonts only | ~1.6 MB | 1 hour | Low |
| Migrate images only | ~2.3 MB | 2-3 hours | Low |
| Both fonts + images | ~3.9 MB | 2-3 hours | Low |
| Do nothing (current) | — | — | N/A (works fine) |

---

## Decision Pending

This is a **maintainer decision**, not blocking. No changes will be made unless explicitly decided by project leadership.

**For maintainers:** Choose one approach above and update this document with the decision.

---

## See Also

- [Next.js Font Optimization Guide](https://nextjs.org/docs/app/building-your-application/optimizing/fonts)
- [Next.js Image Optimization Guide](https://nextjs.org/docs/app/building-your-application/optimizing/images)
- Google Fonts: https://fonts.google.com
- Vercel Image Optimization: https://vercel.com/docs/concepts/image-optimization/overview
