---
name: hivegpt-ui-ux
description: Use for any UI/UX change in client/ or packages/client for HiveGPT (Persian, RTL-first LibreChat fork) — new screens, components, copy, icons, colours, states or accessibility fixes.
---

# HiveGPT UI/UX

HiveGPT is a Persian-first AI chat product (`<html lang="fa" dir="rtl">`, Vazirmatn). Every UI change
must look native in RTL, read as plain Persian, and use the existing theme tokens.

## Brand palette

| Role | Value | Use |
| --- | --- | --- |
| Brand blue light | `#60A5FA` | gradient start, highlights |
| **Brand blue (primary)** | `#2563EB` | PWA `theme_color`, `<meta name="theme-color">`, logo core |
| Brand blue strong | `#1D4ED8` | logo spark, pressed states |
| Brand blue deep | `#1E3A8A` | gradient end |
| Neutrals | `surface-*`, `text-primary/secondary/tertiary`, `border-light/medium/heavy` | everything else |
| Success / online / unread | `status-success`, `status-success-strong`, `-subtle`, `-border` | green |
| Error / destructive | `status-error*`, `surface-destructive`, `text-destructive` | red |
| Warning | `status-warning*`, `text-warning` | amber |
| Info | `status-info*` | blue notices |

- In components never hardcode hex; use tokens (`bg-status-success-strong`, `text-text-secondary`).
  Raw hex is only for static assets, `index.html` and `vite.config.ts` manifest.
- Tokens are declared in `packages/client/src/theme/tokens.css` (a name not declared there does not
  exist) and valued per light/dark in `packages/client/src/theme/defaults.css`. Tailwind config:
  `client/tailwind.config.cjs` + `packages/client/tailwind.preset.cjs`.

## Logo

- Source: `client/public/assets/logo.svg` — rounded blue-gradient hexagon (hive nod), white chat
  bubble, blue four-point spark. 512×512 viewBox, `aria-label="HiveGPT"`, no text/fonts.
- PNGs: `favicon-16x16` (simplified: bigger bubble/spark), `favicon-32x32`, `icon-192x192`,
  `apple-touch-icon-180x180` and `maskable-icon` (512, opaque full-bleed blue, glyph inside the
  80% safe zone).
- When any icon changes, bump `?v=hiveN` in `client/index.html`. Do not recolour, stretch, add
  shadows or put the logo on a blue background without the white bubble.

## RTL-first rules

- Use logical utilities only: `ms-/me-`, `ps-/pe-`, `inset-s-/inset-e-`, `start/end`,
  `text-start`, `rounded-s-/rounded-e-`, `border-s/border-e`. Never `left/right`, `ml/mr`, `pl/pr`.
- Mirror directional icons (arrows, chevrons, "back", send) with `rtl:-scale-x-100`; do not mirror
  logos, media controls, checkmarks or clocks.
- Animations with direction use `--dir-sign` or `rtl:` variants (`origin-left rtl:origin-right`).
- Mixed text: wrap Latin/code/URLs in `dir="ltr"` or `<bdi>`; inputs for code, emails, keys use
  `dir="ltr"`.
- Numbers in Persian copy use Persian digits (۰–۹) via `Intl.NumberFormat('fa-IR')` / i18n
  formatting, not by hand. Use ZWNJ (‌) correctly: «می‌خواهید»، «گفت‌وگوها»، «تنظیم‌ها».
- Font is Vazirmatn through `font-theme-ui`; never load other web fonts.

## Persian microcopy

- Plain, short, action-first: «ذخیره»، «حذف گفت‌وگو»، «تلاش دوباره» — not «انجام عملیات ذخیره‌سازی».
- Button = verb; title = noun phrase; one idea per sentence; polite but not formal-bureaucratic.
- Avoid transliterated English («سینک»، «آپلود‌کردن»، «اکانت») — use «همگام‌سازی»، «بارگذاری»، «حساب».
- Technical terms (LaTeX, API, Langfuse, MCP, RAG, token) keep the name and get one plain line:
  «LaTeX — نوشتن فرمول‌های ریاضی».
- Errors say what happened + what to do: «اتصال برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.»
- Never edit `translation.json` casually; add keys in both `en` and `fa` and list them in the PR.

## States every feature ships

1. **Loading** — skeletons shaped like the content (`animate-pulse bg-surface-tertiary rounded-lg`);
   no full-screen spinners. Inline `Spinner` only for small in-place actions.
2. **Empty** — `EmptyState` from `@librechat/client` with one sentence and the primary action.
3. **Error** — inline message near the cause (`text-text-destructive`, `alert-error-*`) with retry.
4. **Disabled** — explain why (tooltip or helper text), never a silent grey button.
5. **Success** — brief toast or inline confirmation; don't block the flow.
6. Read/unread: unread = green `bg-status-success-strong` dot + `font-semibold text-text-primary`;
   read = muted (`text-text-secondary`, dimmed avatar). The active item is never dimmed.

## Accessibility

- WCAG AA contrast: 4.5:1 text, 3:1 icons/borders — check both light and dark themes.
- Keep focus visible: `focus-visible:ring-2 focus-visible:ring-text-primary` (or `ring-ring-primary`);
  never `outline-none` without a replacement.
- Icon-only buttons need `aria-label` (localized); decorative icons `aria-hidden="true"`.
- State conveyed by colour also goes into text: `sr-only` or the control's `aria-label`
  (e.g. `, ${localize('com_ui_unread')}`).
- Targets ≥ 24px (`min-h-theme-target`); respect `prefers-reduced-motion`.
- Use semantic elements (`button`, `nav`, headings) and `aria-current="page"` for the active item.

## Consistency

- Spacing: Tailwind 4px scale (`gap-2`, `px-3`, `py-2`) and theme spacing `theme-compact`
  (0.375rem) / `theme-normal` (0.75rem). No arbitrary `[13px]` values; use rem if unavoidable.
- Radii: `rounded-sm/md/lg/xl/2xl/3xl` (theme-owned; lg = 0.5rem rows/inputs, xl menus, 2xl dialogs).
- Heights: `h-theme-control`, `h-theme-button`, `h-theme-field`.
- Surfaces: page `surface-primary`, sidebar `surface-sidebar`, hover `surface-nav-hover`,
  selected `surface-nav-selected`, dialogs `surface-dialog`.
- Reuse `@librechat/client` components (Button, Dialog, Spinner, EmptyState) before building new.
- Merge classes with `cn()`; dark mode comes from tokens — avoid `dark:` overrides of raw colours.

## Pre-merge UX checklist

- [ ] Looks right in RTL (fa) and LTR (en), light and dark.
- [ ] Only logical spacing/position utilities; directional icons mirrored.
- [ ] Only tokens from `tokens.css`; no hardcoded hex in components.
- [ ] Loading skeleton, empty, error, disabled-with-reason states exist.
- [ ] Persian copy is plain, action-first, correct ZWNJ and Persian digits; new keys in en + fa.
- [ ] Keyboard reachable, visible focus, aria labels, AA contrast.
- [ ] Works at 360px mobile width and with large UI scale.
- [ ] Tests updated (`npx jest <path>`), `npx tsc --noEmit` clean.
