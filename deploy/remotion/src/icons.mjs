// Tabler Icons (MIT, https://tabler.io/icons), outline set, bundled offline through the
// `@tabler/icons` npm package. Storyboards name icons in kebab-case (e.g. `solar-panel`); the
// worker resolves each name to its SVG nodes and sends only the used icons to the composition.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NODES_FILE = path.join(
  __dirname,
  '..',
  'node_modules',
  '@tabler',
  'icons',
  'tabler-nodes-outline.json',
);

export const FALLBACK_ICON = 'sparkles';

/** Common synonyms the model uses that Tabler names differently. */
const ALIASES = {
  energy: 'bolt',
  electricity: 'bolt',
  lightning: 'bolt',
  solar: 'solar-panel',
  'solar-energy': 'solar-panel',
  'wind-turbine': 'windmill',
  'wind-power': 'windmill',
  idea: 'bulb',
  lightbulb: 'bulb',
  'light-bulb': 'bulb',
  money: 'coin',
  dollar: 'currency-dollar',
  globe: 'world',
  earth: 'world',
  people: 'users',
  team: 'users',
  user: 'user',
  location: 'map-pin',
  pin: 'map-pin',
  growth: 'trending-up',
  decline: 'trending-down',
  water: 'droplet',
  fire: 'flame',
  ai: 'brain',
  security: 'shield-check',
  time: 'clock',
  date: 'calendar',
  chart: 'chart-bar',
  check: 'check',
  ok: 'circle-check',
  warning: 'alert-triangle',
  factory: 'building-factory',
  nuclear: 'atom',
  battery: 'battery-charging',
};

let cache = null;

/** All outline icons: name -> [[tag, attrs], ...]. Loaded once, lazily. */
export function iconNodes() {
  if (!cache) {
    cache = JSON.parse(readFileSync(NODES_FILE, 'utf8'));
  }
  return cache;
}

export function iconCount() {
  return Object.keys(iconNodes()).length;
}

const normalize = (name) =>
  String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/^(ti|icon|tabler)[-_ ]/, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

/**
 * Resolve a storyboard icon name. Unknown names fall back to {@link FALLBACK_ICON} with a
 * warning; this never throws.
 * @returns {{ name: string, known: boolean }}
 */
export function resolveIcon(raw) {
  const nodes = iconNodes();
  const key = normalize(raw);
  if (key && nodes[key]) {
    return { name: key, known: true };
  }
  const alias = ALIASES[key];
  if (alias && nodes[alias]) {
    return { name: alias, known: true };
  }
  return { name: FALLBACK_ICON, known: false };
}
