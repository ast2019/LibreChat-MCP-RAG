import type { IThemeRGB } from './types';

/**
 * Default light theme
 * RGB values extracted from the existing CSS variables
 */
export const defaultTheme: IThemeRGB = {
  // Text colors
  'rgb-text-primary': '28 28 34', // #1c1c22 (gray-800)
  'rgb-text-secondary': '66 65 75', // #42414b (gray-600)
  'rgb-text-secondary-alt': '92 91 102', // #5c5b66 (gray-500)
  'rgb-text-tertiary': '92 91 102', // #5c5b66 (gray-500)
  'rgb-text-muted': '105 110 121', // #696e79 (Click UI text.muted)
  'rgb-badge-label': '28 28 34', // #1c1c22 (gray-800, matching text-primary)
  'rgb-text-warning': '180 83 9', // #b45309 (amber-700)
  'rgb-text-destructive': '220 38 38', // #dc2626 (red-600)
  'rgb-shimmer-base': '28 28 34', // #1c1c22 (gray-800), matching text-primary
  'rgb-shimmer-dip': '129 130 134', // #818286

  // Link and accent colors
  'rgb-link': '91 79 229', // #5b4fe5 (NexGap indigo)
  'rgb-link-hover': '74 62 205', // #4a3ecd (NexGap indigo hover)
  'rgb-link-visited': '147 51 234', // #9333ea (purple-600)
  'rgb-link-prose': '91 79 229', // #5b4fe5 (NexGap indigo)
  'rgb-accent-primary': '91 79 229', // #5b4fe5 (NexGap indigo)
  'rgb-accent-primary-hover': '74 62 205', // #4a3ecd (NexGap indigo hover)

  // Ring colors
  'rgb-ring-primary': '91 79 229', // #5b4fe5 (NexGap indigo)
  'rgb-focus-outline': '0 0 0', // #000000
  'rgb-focus-control': '28 28 34', // #1c1c22 (gray-800)

  // Header colors
  'rgb-header-primary': '255 255 255', // #fff (white)
  'rgb-header-hover': '248 247 249', // #f8f7f9 (gray-50)
  'rgb-header-button-hover': '248 247 249', // #f8f7f9 (gray-50)

  // Surface colors
  'rgb-surface-active': '237 236 239', // #edecef (gray-100)
  'rgb-surface-active-alt': '228 227 232', // #e4e3e8 (gray-200)
  'rgb-surface-hover': '228 227 232', // #e4e3e8 (gray-200)
  'rgb-surface-hover-alt': '207 206 214', // #cfced6 (gray-300)
  'rgb-surface-pressed': '228 227 232', // #e4e3e8 (gray-200), the hover fill
  'rgb-surface-composer-hover': '228 227 232', // #e4e3e8 (gray-200)
  'rgb-surface-primary': '255 255 255', // #fff (white)
  'rgb-chart-widget-surface': '255 255 255', // #fff (matching surface-primary)
  'rgb-chart-widget-stroke': '228 227 232', // #e4e3e8 (gray-200, matching border-light)
  'rgb-surface-primary-alt': '248 247 249', // #f8f7f9 (gray-50)
  'rgb-surface-primary-contrast': '237 236 239', // #edecef (gray-100)
  'rgb-surface-secondary': '248 247 249', // #f8f7f9 (gray-50)
  'rgb-surface-secondary-alt': '228 227 232', // #e4e3e8 (gray-200)
  'rgb-surface-tertiary': '237 236 239', // #edecef (gray-100)
  'rgb-surface-tertiary-alt': '255 255 255', // #fff (white)
  'rgb-surface-dialog': '255 255 255', // #fff (white)
  'rgb-dialog-title': '28 28 34', // #1c1c22 (gray-800, matching text-primary)
  'rgb-surface-overlay': '89 89 89', // #595959 (gray-500)
  'rgb-surface-media-overlay': '0 0 0', // #000 (black, over the user's media in both modes)
  'rgb-text-on-media': '255 255 255', // #fff (white)
  'rgb-surface-submit': '91 79 229', // #5b4fe5 (NexGap indigo)
  'rgb-surface-submit-hover': '74 62 205', // #4a3ecd (NexGap indigo hover)
  'rgb-surface-destructive': '185 28 28', // #b91c1c (red-700)
  'rgb-surface-destructive-hover': '153 27 27', // #991b1b (red-800)
  'rgb-surface-chat': '255 255 255', // #fff (white)
  'rgb-surface-code': '248 247 249', // #f8f7f9 (gray-50)
  'rgb-surface-code-body': '255 255 255', // #fff (white)
  'rgb-surface-code-inline': '228 227 232', // #e4e3e8 (gray-200)
  'rgb-prose-bullet': '207 206 214', // #cfced6 (gray-300)
  'rgb-prose-quote-bar': '207 206 214', // #cfced6 (gray-300)
  'rgb-surface-qr': '255 255 255', // #fff (white)
  'rgb-surface-inverted': '91 79 229', // #5b4fe5 (NexGap indigo)
  'rgb-surface-inverted-hover': '74 62 205', // #4a3ecd (NexGap indigo hover)
  'rgb-surface-inverted-pressed': '74 62 205', // #4a3ecd (NexGap indigo hover)
  'rgb-button-primary': '91 79 229', // #5b4fe5 (NexGap indigo)
  'rgb-button-primary-hover': '74 62 205', // #4a3ecd (NexGap indigo hover)
  'rgb-text-inverted': '255 255 255', // #fff (white)
  'rgb-surface-fixed': '255 255 255', // #fff (white) — same in light + dark
  'rgb-surface-fixed-hover': '237 236 239', // #edecef (gray-100) — same in light + dark
  'rgb-text-fixed': '28 28 34', // #1c1c22 (gray-800) — same in light + dark

  // Border colors
  'rgb-border-light': '228 227 232', // #e4e3e8 (gray-200)
  'rgb-border-medium': '207 206 214', // #cfced6 (gray-300)
  'rgb-border-medium-alt': '207 206 214', // #cfced6 (gray-300)
  'rgb-border-heavy': '155 154 162', // #9b9aa2 (gray-400)
  'rgb-border-xheavy': '92 91 102', // #5c5b66 (gray-500)
  'rgb-drawer-edge': '248 247 249', // #f8f7f9 (gray-50, the drawer's own fill)
  'rgb-border-destructive': '220 38 38', // #dc2626 (red-600)
  'rgb-border-control': '228 227 232', // #e4e3e8 (gray-200), the stock field edge
  'rgb-border-field-focus': '28 28 34', // #1c1c22 (gray-800, matching focus-control)
  'rgb-focus-subtle': '155 154 162', // #9b9aa2 (gray-400, matching border-heavy)
  'rgb-field-fill': '255 255 255', // #fff (white, matching surface-primary)
  'rgb-field-text': '28 28 34', // #1c1c22 (gray-800, matching text-primary)
  'rgb-surface-tooltip': '255 255 255', // matching surface-primary
  'rgb-text-tooltip': '28 28 34', // matching text-primary
  'rgb-alert-error-fill': '254 242 242', // matching status-error-subtle
  'rgb-alert-error-border': '252 165 165', // matching status-error-border
  'rgb-surface-canvas': '248 247 249', // matching surface-primary-alt
  'rgb-surface-user-message': '237 236 239', // matching surface-tertiary
  'rgb-surface-card': '248 247 249', // matching surface-secondary
  'rgb-surface-card-hover': '237 236 239', // matching surface-tertiary
  'rgb-surface-nav-hover': '228 227 232', // matching surface-active-alt
  'rgb-surface-nav-selected': '228 227 232', // matching surface-active-alt
  'rgb-surface-tab-selected': '237 236 239', // matching surface-tertiary
  'rgb-surface-menu': '255 255 255', // matching presentation
  'rgb-surface-popover': '255 255 255', // matching surface-primary
  'rgb-border-menu': '228 227 232', // matching border-light
  'rgb-surface-composer': '255 255 255', // matching surface-chat
  'rgb-surface-search': '248 247 249', // matching surface-secondary
  'rgb-surface-sidebar': '248 247 249', // matching surface-primary-alt
  'rgb-surface-disabled': '237 236 239', // #edecef (gray-100)
  'rgb-text-disabled': '155 154 162', // #9b9aa2 (gray-400)
  'rgb-border-disabled': '228 227 232', // #e4e3e8 (gray-200)

  // Status colors
  'rgb-status-success': '4 120 87', // #047857 (green-700)
  'rgb-status-success-subtle': '236 253 245', // #ecfdf5 (green-50)
  'rgb-status-success-border': '110 231 183', // #6ee7b7 (green-300)
  'rgb-status-success-strong': '2 133 94', // #02855e
  'rgb-status-info': '91 79 229', // #5b4fe5 (NexGap indigo)
  'rgb-status-info-subtle': '239 246 255', // #eff6ff (blue-50)
  'rgb-status-info-border': '147 197 253', // #93c5fd (blue-300)
  'rgb-status-info-strong': '92 91 102', // #5c5b66 (gray-500)
  'rgb-status-warning': '180 83 9', // #b45309 (amber-700)
  'rgb-status-warning-subtle': '255 251 235', // #fffbeb (amber-50)
  'rgb-status-warning-border': '252 211 77', // #fcd34d (amber-300)
  'rgb-status-warning-strong': '199 82 9', // #c75209
  'rgb-status-error': '185 28 28', // #b91c1c (red-700)
  'rgb-status-error-subtle': '254 242 242', // #fef2f2 (red-50)
  'rgb-status-error-border': '252 165 165', // #fca5a5 (red-300)
  'rgb-status-error-strong': '224 47 31', // #e02f1f
  'rgb-status-neutral': '66 65 75', // #42414b (gray-600)
  'rgb-status-neutral-subtle': '237 236 239', // #edecef (gray-100)
  'rgb-status-neutral-border': '207 206 214', // #cfced6 (gray-300)
  /** Verified mark. `blue-600` doubles as `status-info` here, and that is the
   *  point: one blue for "this is informational/first-party", 5.17:1 under the
   *  white label and 4.83:1 against the panel. */
  'rgb-status-verified': '91 79 229', // #5b4fe5 (NexGap indigo)
  'rgb-text-on-status': '255 255 255', // #fff (white)

  // Brand colors
  'rgb-brand-purple': '91 79 229', // #5b4fe5 (NexGap indigo)
  'rgb-avatar-fill': '124 114 240', // #7c72f0 (NexGap indigo tint)
  'rgb-avatar-text': '28 28 34', // #1c1c22 (gray-800, matching text-primary)
  'rgb-avatar-placeholder': '248 247 249', // #f8f7f9 (gray-50, matching surface-secondary)
  'rgb-avatar-edge': '240 246 252', // #f0f6fc at 10%, a hairline that only shows against a dark page
  'rgb-illustration-subtle': '190 184 250', // #beb8fa (NexGap indigo tint)
  'rgb-illustration': '124 114 240', // #7c72f0 (NexGap indigo tint)
  'rgb-illustration-strong': '91 79 229', // #5b4fe5 (NexGap indigo)
  'rgb-scrollbar-thumb': '0 0 0', // #000000
  'rgb-page-canvas': '248 247 249', // #f8f7f9 (gray-50, matching surface-primary-alt)
  'rgb-select-fill': '255 255 255', // #ffffff
  'rgb-select-edge': '154 153 165', // #9a99a5
  'rgb-button-neutral-border': '0 0 0', // #000000 at 10%
  'rgb-button-neutral-text': '66 65 75', // #42414b
  'rgb-button-neutral-hover': '240 239 243', // #f0eff3 (gray-20)
  'rgb-link-inline': '91 79 229', // #5b4fe5 (NexGap indigo)
  'rgb-toast-edge': '67 90 111', // #435a6f
  'rgb-stroke-ink': '0 0 0', // #000000 at 10%
  'rgb-file-document': '255 85 136', // #ff5588
  'rgb-file-sheet': '16 163 127', // #10a37f
  'rgb-file-code': '255 110 60', // #ff6e3c
  'rgb-file-artifact': '45 48 92', // #2d305c
  'rgb-file-audio': '255 107 53', // #ff6b35
  'rgb-file-video': '139 92 246', // #8b5cf6
  'rgb-file-generic': '0 0 255', // #0000ff
  'rgb-file-ink': '255 255 255', // #ffffff

  /** Code syntax highlighting, measured against the `surface-code` and `surface-code-body` fills. */
  'rgb-syntax-text': '28 28 34', // #1c1c22 (gray-800)
  'rgb-syntax-comment': '92 91 102', // #5c5b66 (gray-500)
  'rgb-syntax-meta': '66 65 75', // #42414b (gray-600)
  'rgb-syntax-builtin': '154 103 0', // #9a6700
  'rgb-syntax-keyword': '5 80 174', // #0550ae
  'rgb-syntax-string': '10 123 98', // #0a7b62
  'rgb-syntax-attr': '154 47 106', // #9a2f6a
  'rgb-syntax-title': '180 35 24', // #b42318

  /** Categorical series scale. Steps clear 3:1 against BOTH the popover surface
   *  and the #ececec meter track, with worst adjacent CVD ΔE 12.4 and worst
   *  adjacent normal-vision ΔE 19.0. Slot order is the CVD-safety mechanism:
   *  indigo(8) sits beside green(7) because blue separates from green under
   *  protanopia/deuteranopia where red would not. */
  'rgb-series-1': '5 110 189', // #056ebd (cerulean)
  'rgb-series-2': '233 86 13', // #e9560d (orange)
  'rgb-series-3': '0 148 142', // #00948e (aqua)
  'rgb-series-4': '182 123 5', // #b67b05 (amber)
  'rgb-series-5': '216 90 142', // #d85a8e (magenta)
  'rgb-series-6': '126 35 205', // #7e23cd (violet)
  'rgb-series-7': '1 131 1', // #018301 (green)
  'rgb-series-8': '63 81 181', // #3f51b5 (indigo)
  'rgb-category-icon-1': '5 110 189', // #056ebd (matching series-1)
  'rgb-category-icon-2': '233 86 13', // #e9560d (matching series-2)
  'rgb-category-icon-4': '182 123 5', // #b67b05 (matching series-4)
  'rgb-category-icon-5': '216 90 142', // #d85a8e (matching series-5)
  'rgb-category-icon-6': '126 35 205', // #7e23cd (matching series-6)
  'rgb-category-icon-7': '1 131 1', // #018301 (matching series-7)

  /** Unchecked switch track. 3.03:1 against the white page and the
   *  `surface-primary` thumb, 5.91:1 against the checked `surface-inverted`
   *  track, so the control reads in either state. */
  'rgb-switch-unchecked': '148 148 148', // #949494
  'rgb-switch-thumb': '255 255 255', // #fff (white, matching surface-primary)
  'rgb-checkbox-fill': '255 255 255', // #fff (white, matching surface-primary)
  'rgb-table-header-text': '66 65 75', // #42414b (gray-600, matching text-secondary)
  'rgb-table-header-fill': '255 255 255', // #fff (white, matching surface-dialog)

  // Presentation
  'rgb-presentation': '255 255 255', // #fff (white)
};
