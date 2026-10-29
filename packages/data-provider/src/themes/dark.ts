import type { IThemeRGB } from './types';

/**
 * Dark theme
 * RGB values extracted from the existing dark mode CSS variables
 */
export const darkTheme: IThemeRGB = {
  // Text colors
  'rgb-text-primary': '237 236 239', // #edecef (gray-100)
  'rgb-text-secondary': '207 206 214', // #cfced6 (gray-300)
  'rgb-text-secondary-alt': '155 154 162', // #9b9aa2 (gray-400)
  'rgb-text-tertiary': '155 154 162', // #9b9aa2 (gray-400)
  'rgb-text-muted': '179 182 189', // #b3b6bd (Click UI text.muted)
  'rgb-badge-label': '237 236 239', // #edecef (gray-100, matching text-primary)
  'rgb-text-warning': '245 158 11', // #f59e0b (amber-500)
  'rgb-text-destructive': '248 113 113', // #f87171 (red-400)
  'rgb-shimmer-base': '255 255 255', // #ffffff, carried at 0.8 alpha
  'rgb-shimmer-dip': '179 179 179', // #b3b3b3

  // Link and accent colors
  'rgb-link': '139 129 255', // #8b81ff (NexGap indigo, dark)
  'rgb-link-hover': '167 159 255', // #a79fff (NexGap indigo hover, dark)
  'rgb-link-visited': '192 132 252', // #c084fc (purple-400)
  'rgb-link-prose': '237 236 239', // #edecef (gray-100, matching text-primary)
  'rgb-accent-primary': '139 129 255', // #8b81ff (NexGap indigo, dark)
  'rgb-accent-primary-hover': '167 159 255', // #a79fff (NexGap indigo hover, dark)

  // Ring colors (not defined in dark mode, using default)
  'rgb-ring-primary': '91 79 229', // #5b4fe5 (NexGap indigo)
  'rgb-focus-outline': '255 255 255', // #ffffff
  'rgb-focus-control': '237 236 239', // #edecef (gray-100)

  // Header colors
  'rgb-header-primary': '48 47 55', // #302f37 (gray-700)
  'rgb-header-hover': '66 65 75', // #42414b (gray-600)
  'rgb-header-button-hover': '48 47 55', // #302f37 (gray-700)

  // Surface colors
  'rgb-surface-active': '92 91 102', // #5c5b66 (gray-500)
  'rgb-surface-active-alt': '48 47 55', // #302f37 (gray-700)
  'rgb-surface-hover': '58 57 66', // #3a3942 (gray-650)
  'rgb-surface-hover-alt': '66 65 75', // #42414b (gray-600)
  'rgb-surface-pressed': '58 57 66', // #3a3942 (gray-650), the hover fill
  'rgb-surface-composer-hover': '66 65 75', // #42414b (gray-600)
  'rgb-surface-primary': '16 15 21', // #100f15 (gray-900)
  'rgb-chart-widget-surface': '40 40 40', // #282828 (Click UI chart widget)
  'rgb-chart-widget-stroke': '50 50 50', // #323232 (Click UI chart widget)
  'rgb-surface-primary-alt': '23 22 28', // #17161c (gray-850)
  'rgb-surface-primary-contrast': '23 22 28', // #17161c (gray-850)
  'rgb-surface-secondary': '28 28 34', // #1c1c22 (gray-800)
  'rgb-surface-secondary-alt': '28 28 34', // #1c1c22 (gray-800)
  'rgb-surface-tertiary': '48 47 55', // #302f37 (gray-700)
  'rgb-surface-tertiary-alt': '48 47 55', // #302f37 (gray-700)
  'rgb-surface-dialog': '20 19 25', // #141319 (legacy dark dialog)
  'rgb-dialog-title': '237 236 239', // #edecef (gray-100, matching text-primary)
  'rgb-surface-overlay': '0 0 0', // #000 (black)
  'rgb-surface-media-overlay': '0 0 0', // #000 (black, over the user's media in both modes)
  'rgb-text-on-media': '255 255 255', // #fff (white)
  'rgb-surface-submit': '91 79 229', // #5b4fe5 (NexGap indigo)
  'rgb-surface-submit-hover': '109 98 240', // #6d62f0 (NexGap indigo hover)
  'rgb-surface-destructive': '153 27 27', // #991b1b (red-800)
  'rgb-surface-destructive-hover': '127 29 29', // #7f1d1d (red-900)
  'rgb-surface-chat': '48 47 55', // #302f37 (gray-700)
  'rgb-surface-code': '28 28 34', // #1c1c22 (gray-800)
  'rgb-surface-code-body': '23 22 28', // #17161c (gray-850)
  'rgb-surface-code-inline': '66 65 75', // #42414b (gray-600)
  'rgb-prose-bullet': '58 57 66', // #3a3942 (gray-650)
  'rgb-prose-quote-bar': '58 57 66', // #3a3942 (gray-650)
  'rgb-surface-qr': '255 255 255', // #fff (white, so the code stays scannable)
  'rgb-surface-inverted': '91 79 229', // #5b4fe5 (NexGap indigo)
  'rgb-surface-inverted-hover': '109 98 240', // #6d62f0 (NexGap indigo hover)
  'rgb-surface-inverted-pressed': '109 98 240', // #6d62f0 (NexGap indigo hover)
  'rgb-button-primary': '91 79 229', // #5b4fe5 (NexGap indigo)
  'rgb-button-primary-hover': '109 98 240', // #6d62f0 (NexGap indigo hover)
  'rgb-text-inverted': '255 255 255', // #ffffff (gray-850)
  'rgb-surface-fixed': '255 255 255', // #fff (white) — same in light + dark
  'rgb-surface-fixed-hover': '237 236 239', // #edecef (gray-100) — same in light + dark
  'rgb-text-fixed': '28 28 34', // #1c1c22 (gray-800) — same in light + dark

  // Border colors
  'rgb-border-light': '28 28 34', // #1c1c22 (gray-800)
  'rgb-border-medium': '58 57 66', // #3a3942 (gray-650)
  'rgb-border-medium-alt': '58 57 66', // #3a3942 (gray-650)
  'rgb-border-heavy': '92 91 102', // #5c5b66 (gray-500)
  'rgb-border-xheavy': '155 154 162', // #9b9aa2 (gray-400)
  'rgb-drawer-edge': '155 154 162', // #9b9aa2 (gray-400, matching border-xheavy)
  'rgb-border-destructive': '239 68 68', // #ef4444 (red-500)
  'rgb-border-control': '28 28 34', // #1c1c22 (gray-800), the stock field edge
  'rgb-border-field-focus': '237 236 239', // #edecef (gray-100, matching focus-control)
  'rgb-focus-subtle': '92 91 102', // #5c5b66 (gray-500, matching border-heavy)
  'rgb-field-fill': '16 15 21', // #100f15 (gray-900, matching surface-primary)
  'rgb-field-text': '237 236 239', // #edecef (gray-100, matching text-primary)
  'rgb-surface-tooltip': '16 15 21', // matching surface-primary
  'rgb-text-tooltip': '237 236 239', // matching text-primary
  'rgb-alert-error-fill': '69 10 10', // matching status-error-subtle
  'rgb-alert-error-border': '153 27 27', // matching status-error-border
  'rgb-surface-canvas': '23 22 28', // matching surface-primary-alt
  'rgb-surface-user-message': '48 47 55', // matching surface-tertiary
  'rgb-surface-card': '28 28 34', // matching surface-secondary
  'rgb-surface-card-hover': '48 47 55', // matching surface-tertiary
  'rgb-surface-nav-hover': '48 47 55', // matching surface-active-alt
  'rgb-surface-nav-selected': '48 47 55', // matching surface-active-alt
  'rgb-surface-tab-selected': '48 47 55', // matching surface-tertiary
  'rgb-surface-menu': '28 28 34', // matching presentation
  'rgb-surface-popover': '28 28 34', // matching surface-secondary
  'rgb-border-menu': '28 28 34', // matching border-light
  'rgb-surface-composer': '48 47 55', // matching surface-chat
  'rgb-surface-search': '28 28 34', // matching surface-secondary
  'rgb-surface-sidebar': '23 22 28', // matching surface-primary-alt
  'rgb-surface-disabled': '48 47 55', // #302f37 (gray-700)
  'rgb-text-disabled': '155 154 162', // #9b9aa2 (gray-400)
  'rgb-border-disabled': '58 57 66', // #3a3942 (gray-650)

  // Status colors
  'rgb-status-success': '110 231 183', // #6ee7b7 (green-300)
  'rgb-status-success-subtle': '2 44 34', // #022c22 (green-950)
  'rgb-status-success-border': '6 95 70', // #065f46 (green-800)
  /** Not `green-800` like its border twin: this fill also paints bare marks
   *  (selection checks, the version timeline rail, prompt chips) that have to
   *  clear 3:1 against the #212121 panel, and green-800 reached only 2.10:1
   *  there. Balanced instead, the same way light's `#02855e` is: 4.55:1 under
   *  the white `text-on-status` label and 3.54:1 against the panel. */
  'rgb-status-success-strong': '8 135 89', // #088759
  'rgb-status-info': '147 197 253', // #93c5fd (blue-300)
  'rgb-status-info-subtle': '23 37 84', // #172554 (blue-950)
  'rgb-status-info-border': '30 64 175', // #1e40af (blue-800)
  'rgb-status-info-strong': '66 65 75', // #42414b (gray-600)
  'rgb-status-warning': '252 211 77', // #fcd34d (amber-300)
  'rgb-status-warning-subtle': '69 26 3', // #451a03 (amber-950)
  'rgb-status-warning-border': '146 64 14', // #92400e (amber-800)
  'rgb-status-warning-strong': '146 64 14', // #92400e (amber-800)
  'rgb-status-error': '252 165 165', // #fca5a5 (red-300)
  'rgb-status-error-subtle': '69 10 10', // #450a0a (red-950)
  'rgb-status-error-border': '153 27 27', // #991b1b (red-800)
  'rgb-status-error-strong': '153 27 27', // #991b1b (red-800)
  'rgb-status-neutral': '207 206 214', // #cfced6 (gray-300)
  'rgb-status-neutral-subtle': '28 28 34', // #1c1c22 (gray-800)
  'rgb-status-neutral-border': '48 47 55', // #302f37 (gray-700)
  /** Verified mark. Not `status-info`'s `blue-300`, which is a text hue and
   *  leaves a white check at 1.35:1. The card it sits on is `surface-dialog`
   *  at rest and `surface-tertiary` (#2f2f2f) on hover, and that hover is the
   *  binding constraint: `#0b74d4` held the panel at 3.42:1 but fell to 2.85:1
   *  there. Both relationships are graphical (WCAG 1.4.11): 3.23:1 against the
   *  hover surface, 4.52:1 against the resting dialog, and 4.14:1 under the
   *  white `text-on-status` check. No hue clears 3:1 on #2f2f2f and 4.5:1
   *  under a white check at once — the check would have to stop being white. */
  'rgb-status-verified': '139 129 255', // #8b81ff (NexGap indigo, dark)
  'rgb-text-on-status': '255 255 255', // #fff (white)

  // Brand colors
  'rgb-brand-purple': '139 129 255', // #8b81ff (NexGap indigo, dark)
  'rgb-avatar-fill': '124 114 240', // #7c72f0 (NexGap indigo tint)
  /** White, not the #ececec primary text: the glyph is a graphical object (WCAG 1.4.11) and
   *  #ececec held only 2.6:1 on the #7989ff fill, where white reaches 3.07:1. */
  'rgb-avatar-text': '255 255 255', // #ffffff
  'rgb-avatar-placeholder': '48 47 55', // #302f37 (gray-700, matching surface-tertiary)
  'rgb-avatar-edge': '240 246 252', // #f0f6fc at 10%, a hairline that only shows against a dark page
  'rgb-illustration-subtle': '175 193 255', // #afc1ff
  'rgb-illustration': '124 114 240', // #7c72f0 (NexGap indigo tint)
  'rgb-illustration-strong': '139 129 255', // #8b81ff (NexGap indigo, dark)
  'rgb-scrollbar-thumb': '255 255 255', // #ffffff
  'rgb-page-canvas': '23 22 28', // #17161c (gray-850)
  'rgb-select-fill': '255 255 255', // #ffffff
  'rgb-select-edge': '154 153 165', // #9a99a5
  'rgb-button-neutral-border': '66 65 75', // #42414b (gray-600)
  'rgb-button-neutral-text': '237 236 239', // #edecef
  'rgb-button-neutral-hover': '66 65 75', // #42414b (gray-600)
  'rgb-link-inline': '139 129 255', // #8b81ff (NexGap indigo, dark)
  'rgb-toast-edge': '67 90 111', // #435a6f
  'rgb-stroke-ink': '255 255 255', // #ffffff at 30%
  'rgb-file-document': '255 85 136', // #ff5588
  'rgb-file-sheet': '16 163 127', // #10a37f
  'rgb-file-code': '255 110 60', // #ff6e3c
  'rgb-file-artifact': '45 48 92', // #2d305c
  'rgb-file-audio': '255 107 53', // #ff6b35
  'rgb-file-video': '139 92 246', // #8b5cf6
  'rgb-file-generic': '0 0 255', // #0000ff
  'rgb-file-ink': '255 255 255', // #ffffff

  /** Code syntax highlighting, measured against the `surface-code` fill. The
   *  comment and meta values are the flattened equivalents of the alpha-blended
   *  whites this palette used before it was tokenized: 50% and 60% white over
   *  the #212121 code surface. */
  'rgb-syntax-text': '255 255 255', // #fff (white)
  'rgb-syntax-comment': '144 144 144', // #909090
  'rgb-syntax-meta': '166 166 166', // #a6a6a6
  'rgb-syntax-builtin': '233 149 12', // #e9950c
  'rgb-syntax-keyword': '46 149 211', // #2e95d3
  'rgb-syntax-string': '0 166 125', // #00a67d
  'rgb-syntax-attr': '223 48 121', // #df3079
  'rgb-syntax-title': '242 44 61', // #f22c3d

  /** Categorical series scale — the same eight hues stepped for the #212121
   *  surface: worst adjacent CVD ΔE 13.0, normal-vision ΔE 19.0, all ≥ 3:1.
   *  Slot 8 is muted rather than the light mode's saturated indigo because a
   *  slot also fills a badge chip under `text-on-status` white: #8c98e6 carried
   *  that glyph at only 2.71:1, this reads 3.66:1 and still clears 3.66:1 on
   *  every series surface. */
  'rgb-series-1': '9 140 238', // #098cee (cerulean)
  'rgb-series-2': '217 87 35', // #d95723 (orange)
  'rgb-series-3': '6 158 152', // #069e98 (aqua)
  'rgb-series-4': '200 133 12', // #c8850c (amber)
  'rgb-series-5': '213 82 130', // #d55282 (magenta)
  'rgb-series-6': '171 104 254', // #ab68fe (violet)
  'rgb-series-7': '80 167 49', // #50a731 (green)
  'rgb-series-8': '120 130 190', // #8082be (indigo)
  'rgb-category-icon-1': '9 140 238', // #098cee (matching series-1)
  'rgb-category-icon-2': '217 87 35', // #d95723 (matching series-2)
  'rgb-category-icon-4': '200 133 12', // #c8850c (matching series-4)
  'rgb-category-icon-5': '213 82 130', // #d55282 (matching series-5)
  'rgb-category-icon-6': '171 104 254', // #ab68fe (matching series-6)
  'rgb-category-icon-7': '80 167 49', // #50a731 (matching series-7)

  /** Unchecked switch track. 3.38:1 against the page and the `surface-primary`
   *  thumb, 5.74:1 against the checked `surface-inverted` track. */
  'rgb-switch-unchecked': '102 102 102', // #666666
  'rgb-switch-thumb': '255 255 255', // #ffffff (gray-900, matching surface-primary)
  'rgb-checkbox-fill': '16 15 21', // #100f15 (gray-900, matching surface-primary)
  'rgb-table-header-text': '207 206 214', // #cfced6 (gray-300, matching text-secondary)
  'rgb-table-header-fill': '20 19 25', // #141319 (matching surface-dialog)

  // Presentation
  'rgb-presentation': '28 28 34', // #1c1c22 (gray-800)
};
