/**
 * Mechanical Persian spelling fixes: the ones a rule can make without understanding the
 * sentence. Code, links, emails, @mentions and #hashtags pass through untouched.
 */

export type DigitStyle = 'keep' | 'persian' | 'latin';

export type NormalizeChange =
  | 'letters'
  | 'kashida'
  | 'digits'
  | 'punctuation'
  | 'quotes'
  | 'half_space'
  | 'spacing';

export interface NormalizeResult {
  text: string;
  /** How many fixes of each kind were made; kinds with none are left out */
  changes: Partial<Record<NormalizeChange, number>>;
  /** Code blocks, links and the like that were left exactly as written */
  protectedSegments: number;
}

/** Persian letters, without digits or punctuation; Arabic ي and ك included so they still match. */
const L = '\\u0621-\\u063A\\u0641-\\u064A\\u067E\\u0686\\u0698\\u06A9\\u06AF\\u06C0\\u06CC';
const ZWNJ = '\u200c';

const PROTECTED = new RegExp(
  [
    '```[\\s\\S]*?(?:```|$)',
    '`[^`\\n]+`',
    '\\]\\([^)\\s]+\\)',
    '(?:https?:\\/\\/|www\\.)[^\\s<>()«»"\']+',
    '[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+',
    `[@#][\\w${L}${ZWNJ}]+`,
  ].join('|'),
  'gi',
);

const ARABIC_LETTERS: Record<string, string> = { ي: 'ی', ى: 'ی', ك: 'ک' };
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

const SUFFIXES = [
  'هایشان',
  'هایتان',
  'هایمان',
  'هایی',
  'هایم',
  'هایت',
  'هایش',
  'های',
  'ها',
  'ترین',
];

type Rule = { change: NormalizeChange; pattern: RegExp; replace: (...groups: string[]) => string };

function digitRules(style: DigitStyle): Rule[] {
  const toPersian = (digit: string) => PERSIAN_DIGITS[ARABIC_DIGITS.indexOf(digit)] ?? digit;
  const rules: Rule[] = [{ change: 'digits', pattern: /[٠-٩]/g, replace: toPersian }];
  if (style === 'persian') {
    rules.push({
      change: 'digits',
      pattern: /[0-9]/g,
      replace: (digit) => PERSIAN_DIGITS[Number(digit)],
    });
  }
  if (style === 'latin') {
    return [
      {
        change: 'digits',
        pattern: /[۰-۹٠-٩]/g,
        replace: (digit) =>
          String(
            PERSIAN_DIGITS.includes(digit)
              ? PERSIAN_DIGITS.indexOf(digit)
              : ARABIC_DIGITS.indexOf(digit),
          ),
      },
    ];
  }
  return rules;
}

function buildRules(digits: DigitStyle): Rule[] {
  return [
    { change: 'letters', pattern: /[يىك]/g, replace: (letter) => ARABIC_LETTERS[letter] },
    { change: 'kashida', pattern: /\u0640+/g, replace: () => '' },
    ...digitRules(digits),
    { change: 'punctuation', pattern: new RegExp(`(?<=[${L}])[ \\t]*,`, 'g'), replace: () => '،' },
    { change: 'punctuation', pattern: new RegExp(`(?<=[${L}])[ \\t]*;`, 'g'), replace: () => '؛' },
    {
      change: 'punctuation',
      pattern: new RegExp(`(?<=[${L}])[ \\t]*\\?`, 'g'),
      replace: () => '؟',
    },
    {
      change: 'quotes',
      pattern: new RegExp(`"([^"\\n]*[${L}][^"\\n]*)"`, 'g'),
      replace: (_match, inner) => `«${inner}»`,
    },
    {
      change: 'half_space',
      pattern: new RegExp(`(?<![${L}${ZWNJ}])(ن?می)[ \\t]+(?=[${L}])`, 'g'),
      replace: (_match, prefix) => `${prefix}${ZWNJ}`,
    },
    {
      change: 'half_space',
      pattern: new RegExp(`(?<=[${L}])[ \\t]+(${SUFFIXES.join('|')})(?![${L}${ZWNJ}])`, 'g'),
      replace: (_match, suffix) => `${ZWNJ}${suffix}`,
    },
    {
      change: 'spacing',
      pattern: new RegExp(`${ZWNJ}{2,}|${ZWNJ}(?=[ \\t\\n])|(?<=[ \\t\\n])${ZWNJ}`, 'g'),
      replace: (match) => (match.length > 1 && match[0] === ZWNJ ? ZWNJ : ''),
    },
    {
      change: 'spacing',
      pattern: new RegExp(`(?<=[${L}${ZWNJ}])[ \\t]+(?=[.،؛:!؟»)\\]])`, 'g'),
      replace: () => '',
    },
    {
      change: 'spacing',
      pattern: new RegExp(`(?<=[«(\\[])[ \\t]+(?=[${L}])`, 'g'),
      replace: () => '',
    },
    {
      change: 'spacing',
      pattern: new RegExp(`(?<=[${L}][.،؛:!؟])(?=[${L}])`, 'g'),
      replace: () => ' ',
    },
    { change: 'spacing', pattern: /(?<=\S)[ \t]{2,}(?=\S)/g, replace: () => ' ' },
  ];
}

function applyRules(segment: string, rules: Rule[], changes: NormalizeResult['changes']): string {
  let text = segment;
  for (const rule of rules) {
    text = text.replace(rule.pattern, (...args: unknown[]) => {
      const groups = args.filter((value): value is string => typeof value === 'string');
      const replaced = rule.replace(...groups);
      if (replaced !== groups[0]) {
        changes[rule.change] = (changes[rule.change] ?? 0) + 1;
      }
      return replaced;
    });
  }
  return text;
}

export function normalizePersianText(
  input: string,
  { digits = 'keep' }: { digits?: DigitStyle } = {},
): NormalizeResult {
  const rules = buildRules(digits);
  const changes: NormalizeResult['changes'] = {};
  let protectedSegments = 0;
  let output = '';
  let cursor = 0;
  for (const match of input.matchAll(PROTECTED)) {
    const start = match.index ?? 0;
    output += applyRules(input.slice(cursor, start), rules, changes);
    output += match[0];
    protectedSegments += 1;
    cursor = start + match[0].length;
  }
  output += applyRules(input.slice(cursor), rules, changes);
  return { text: output, changes, protectedSegments };
}
