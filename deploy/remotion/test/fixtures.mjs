// Sample storyboards: one scene of every type (English and Persian) and the energy clip.
import { samplePhoto } from './helpers.mjs';

export const photoAsset = () => ({ kind: 'image', mime: 'image/png', base64: samplePhoto().toString('base64'), credit: 'Photo: HiveGPT test' });

export const everySceneEn = {
  title: 'Every scene',
  lang: 'en',
  aspectRatio: '16:9',
  theme: 'midnight',
  brandName: 'HiveGPT',
  captions: false,
  scenes: [
    { type: 'hook', durationSec: 2, kicker: 'Energy 2030', headline: 'Clean power is now the cheapest power', emphasis: ['cheapest'], subline: 'What changed in ten years', transition: 'fade' },
    { type: 'stat', durationSec: 2, value: 30, suffix: '%', label: 'of world electricity is renewable', transition: 'slide' },
    { type: 'chart', durationSec: 2, chart: 'bar', title: 'Capacity added in 2023 (GW)', unit: 'GW', data: [{ label: 'Solar', value: 420 }, { label: 'Wind', value: 117 }, { label: 'Hydro', value: 13 }], highlight: 0, transition: 'wipe' },
    { type: 'chart', durationSec: 2, chart: 'line', title: 'Solar module price ($/W)', data: [{ label: '2010', value: 2 }, { label: '2015', value: 0.6 }, { label: '2020', value: 0.25 }, { label: '2024', value: 0.11 }], transition: 'flip' },
    { type: 'chart', durationSec: 2, chart: 'donut', title: 'Electricity mix', data: [{ label: 'Fossil', value: 61 }, { label: 'Renewables', value: 30 }, { label: 'Nuclear', value: 9 }], highlight: 1, transition: 'clock-wipe' },
    { type: 'chart', durationSec: 2, chart: 'pie', data: [{ label: 'Coal', value: 35 }, { label: 'Gas', value: 23 }, { label: 'Other', value: 42 }], transition: 'fade' },
    { type: 'icons', durationSec: 2, title: 'Sources', layout: 'grid', items: [{ icon: 'solar-panel', label: 'Solar' }, { icon: 'windmill', label: 'Wind' }, { icon: 'droplet', label: 'Hydro' }, { icon: 'atom', label: 'Nuclear' }], transition: 'slide' },
    { type: 'icons', durationSec: 2, layout: 'list', items: [{ icon: 'bolt', label: 'Cheaper', detail: 'Lowest cost per MWh' }, { icon: 'leaf', label: 'Cleaner', detail: 'No fuel, no smoke' }], transition: 'fade' },
    { type: 'steps', durationSec: 2, title: 'How a solar farm works', steps: [{ title: 'Sunlight', icon: 'sun' }, { title: 'Panels' }, { title: 'Inverter' }, { title: 'Grid', icon: 'plug' }], transition: 'fade' },
    { type: 'timeline', durationSec: 2, title: 'Milestones', events: [{ date: '1954', title: 'First solar cell' }, { date: '2010', title: '40 GW installed' }, { date: '2024', title: '2 TW installed' }], transition: 'fade' },
    { type: 'compare', durationSec: 2, title: 'Coal vs Solar', left: { label: 'Coal', icon: 'flame', points: ['Fuel costs', 'Emissions'] }, right: { label: 'Solar', icon: 'sun', points: ['Free fuel', 'Zero emissions'] }, verdict: 'Solar wins on cost', transition: 'fade' },
    { type: 'quote', durationSec: 2, quote: 'The stone age did not end for lack of stone.', author: 'Sheikh Yamani', role: 'Former oil minister', transition: 'fade' },
    { type: 'image', durationSec: 2, image: 'photo', headline: 'A field of panels', caption: 'Ken Burns with parallax', motion: 'zoom-in', transition: 'fade' },
    { type: 'split', durationSec: 2, headline: 'Storage closes the gap', body: 'Batteries move noon sun to the evening peak.', bullets: ['4 hours of storage'], icon: 'battery-charging', transition: 'slide' },
    { type: 'split', durationSec: 2, headline: 'Rooftops count too', image: 'photo', side: 'start', transition: 'fade' },
    { type: 'list', durationSec: 2, title: 'Three takeaways', bullets: ['Prices fell 90%', 'Build times are short', 'Storage is scaling'], transition: 'fade' },
    { type: 'location', durationSec: 2, place: 'Noor Abu Dhabi', region: 'United Arab Emirates', detail: 'One of the largest single-site solar plants', label: 'Spotlight', transition: 'fade' },
    { type: 'logo', durationSec: 2, text: 'HiveGPT', tagline: 'Made with the motion studio', transition: 'fade' },
    { type: 'cta', durationSec: 2, headline: 'Follow for more energy facts', action: 'Follow', handle: '@hivegpt', transition: 'fade' },
  ],
};

/** The same scene set in Persian, 9:16 (RTL, Persian digits, Vazirmatn). */
export const everySceneFa = {
  title: 'همه صحنه‌ها',
  lang: 'fa',
  aspectRatio: '9:16',
  theme: 'aurora',
  brandName: 'HiveGPT',
  captions: false,
  scenes: [
    { type: 'hook', durationSec: 2, kicker: 'انرژی ۲۰۳۰', headline: 'برق پاک حالا ارزان‌ترین برق دنیاست', emphasis: ['ارزان‌ترین'], subline: 'در ده سال چه چیزی تغییر کرد', transition: 'fade' },
    { type: 'stat', durationSec: 2, value: 30, suffix: '٪', label: 'از برق جهان تجدیدپذیر است', transition: 'slide' },
    { type: 'chart', durationSec: 2, chart: 'bar', title: 'ظرفیت نصب‌شده در ۲۰۲۳', unit: 'گیگاوات', data: [{ label: 'خورشیدی', value: 420 }, { label: 'بادی', value: 117 }, { label: 'آبی', value: 13 }], highlight: 0, transition: 'wipe' },
    { type: 'chart', durationSec: 2, chart: 'line', title: 'قیمت پنل خورشیدی', data: [{ label: '۲۰۱۰', value: 2 }, { label: '۲۰۱۵', value: 0.6 }, { label: '۲۰۲۴', value: 0.11 }], transition: 'flip' },
    { type: 'chart', durationSec: 2, chart: 'donut', title: 'سبد برق', data: [{ label: 'فسیلی', value: 61 }, { label: 'تجدیدپذیر', value: 30 }, { label: 'هسته‌ای', value: 9 }], highlight: 1, transition: 'clock-wipe' },
    { type: 'chart', durationSec: 2, chart: 'pie', data: [{ label: 'زغال‌سنگ', value: 35 }, { label: 'گاز', value: 23 }, { label: 'سایر', value: 42 }], transition: 'fade' },
    { type: 'icons', durationSec: 2, title: 'منابع انرژی', layout: 'grid', items: [{ icon: 'solar-panel', label: 'خورشیدی' }, { icon: 'windmill', label: 'بادی' }, { icon: 'droplet', label: 'آبی' }, { icon: 'atom', label: 'هسته‌ای' }], transition: 'slide' },
    { type: 'icons', durationSec: 2, layout: 'list', items: [{ icon: 'bolt', label: 'ارزان‌تر', detail: 'کمترین هزینه برای هر مگاوات‌ساعت' }, { icon: 'leaf', label: 'پاک‌تر', detail: 'بدون سوخت و بدون دود' }], transition: 'fade' },
    { type: 'steps', durationSec: 2, title: 'نیروگاه خورشیدی چطور کار می‌کند', steps: [{ title: 'نور خورشید', icon: 'sun' }, { title: 'پنل‌ها' }, { title: 'اینورتر' }, { title: 'شبکه برق', icon: 'plug' }], transition: 'fade' },
    { type: 'timeline', durationSec: 2, title: 'نقطه‌های عطف', events: [{ date: '1954', title: 'اولین سلول خورشیدی' }, { date: '2010', title: '۴۰ گیگاوات نصب' }, { date: '2024', title: '۲ تراوات نصب' }], transition: 'fade' },
    { type: 'compare', durationSec: 2, title: 'زغال‌سنگ یا خورشید', left: { label: 'زغال‌سنگ', icon: 'flame', points: ['هزینه سوخت', 'آلودگی'] }, right: { label: 'خورشید', icon: 'sun', points: ['سوخت رایگان', 'بدون آلودگی'] }, verdict: 'خورشید از نظر هزینه برنده است', transition: 'fade' },
    { type: 'quote', durationSec: 2, quote: 'عصر حجر به خاطر تمام شدن سنگ تمام نشد.', author: 'شیخ یمانی', role: 'وزیر نفت پیشین', transition: 'fade' },
    { type: 'image', durationSec: 2, image: 'photo', headline: 'مزرعه‌ای از پنل‌ها', caption: 'حرکت آرام دوربین روی عکس', motion: 'pan-left', transition: 'fade' },
    { type: 'split', durationSec: 2, headline: 'باتری فاصله را پر می‌کند', body: 'باتری‌ها برق ظهر را به شب می‌برند.', bullets: ['چهار ساعت ذخیره'], icon: 'battery-charging', transition: 'slide' },
    { type: 'list', durationSec: 2, title: 'سه نکته اصلی', bullets: ['قیمت ۹۰ درصد کم شد', 'ساخت سریع است', 'ذخیره‌سازی رو به رشد است'], transition: 'fade' },
    { type: 'location', durationSec: 2, place: 'نور ابوظبی', region: 'امارات متحده عربی', detail: 'یکی از بزرگ‌ترین نیروگاه‌های خورشیدی تک‌سایت', label: 'نگاه نزدیک', transition: 'fade' },
    { type: 'logo', durationSec: 2, text: 'HiveGPT', tagline: 'ساخته‌شده با کلیپ‌ساز', transition: 'fade' },
    { type: 'cta', durationSec: 2, headline: 'برای نکته‌های بیشتر دنبال کنید', action: 'دنبال کنید', handle: '@hivegpt', transition: 'fade' },
  ],
};

/** About 60 s, Persian, 9:16: charts, icons, narration (TTS) with captions and music. */
export const energyFa = {
  title: 'انرژی پاک در یک دقیقه',
  lang: 'fa',
  aspectRatio: '9:16',
  theme: 'midnight',
  brandName: 'HiveGPT',
  captions: true,
  music: { track: 'ambient', volume: 0.2 },
  scenes: [
    { type: 'hook', durationSec: 5, kicker: 'انرژی ۲۰۳۰', headline: 'برق پاک حالا ارزان‌ترین برق دنیاست', emphasis: ['ارزان‌ترین'], icon: 'bolt', narration: 'برق پاک حالا ارزان‌ترین برق دنیاست. بیایید ببینیم چطور به اینجا رسیدیم.', transition: 'fade' },
    { type: 'stat', durationSec: 5, value: 30, suffix: '٪', label: 'از برق جهان از منابع تجدیدپذیر است', caption: 'سال ۲۰۲۳', narration: 'امروز حدود سی درصد برق جهان از منابع تجدیدپذیر تولید می‌شود.', transition: 'slide' },
    { type: 'chart', durationSec: 6, chart: 'bar', title: 'ظرفیت تازه در ۲۰۲۳', unit: 'گیگاوات', data: [{ label: 'خورشیدی', value: 420 }, { label: 'بادی', value: 117 }, { label: 'آبی', value: 13 }, { label: 'سایر', value: 9 }], highlight: 0, narration: 'در سال ۲۰۲۳ بیشتر ظرفیت تازه از خورشید آمد؛ چهار برابر باد.', transition: 'wipe' },
    { type: 'chart', durationSec: 6, chart: 'line', title: 'قیمت پنل خورشیدی (دلار بر وات)', data: [{ label: '۲۰۱۰', value: 2 }, { label: '۲۰۱۵', value: 0.6 }, { label: '۲۰۲۰', value: 0.25 }, { label: '۲۰۲۴', value: 0.11 }], narration: 'قیمت پنل خورشیدی در چهارده سال بیش از نود درصد کم شد.', transition: 'fade' },
    { type: 'icons', durationSec: 6, title: 'چهار منبع اصلی', layout: 'grid', items: [{ icon: 'solar-panel', label: 'خورشیدی', detail: 'ارزان و سریع' }, { icon: 'windmill', label: 'بادی', detail: 'قوی در شب' }, { icon: 'droplet', label: 'آبی', detail: 'پایدار' }, { icon: 'atom', label: 'هسته‌ای', detail: 'بدون کربن' }], narration: 'چهار منبع اصلی برق پاک: خورشید، باد، آب و انرژی هسته‌ای.', transition: 'slide' },
    { type: 'chart', durationSec: 6, chart: 'donut', title: 'سبد برق جهان', data: [{ label: 'فسیلی', value: 61 }, { label: 'تجدیدپذیر', value: 30 }, { label: 'هسته‌ای', value: 9 }], highlight: 1, narration: 'هنوز شصت و یک درصد برق از سوخت فسیلی است، اما سهم پاک هر سال بیشتر می‌شود.', transition: 'clock-wipe' },
    { type: 'steps', durationSec: 6, title: 'از نور تا پریز', steps: [{ title: 'نور خورشید', icon: 'sun' }, { title: 'پنل', icon: 'solar-panel' }, { title: 'اینورتر', icon: 'bolt' }, { title: 'شبکه برق', icon: 'plug' }], narration: 'نور به پنل می‌رسد، اینورتر آن را به برق شبکه تبدیل می‌کند و به خانه‌ها می‌رسد.', transition: 'fade' },
    { type: 'compare', durationSec: 6, title: 'زغال‌سنگ یا خورشید', left: { label: 'زغال‌سنگ', icon: 'flame', points: ['هزینه سوخت', 'آلودگی هوا'] }, right: { label: 'خورشید', icon: 'sun', points: ['سوخت رایگان', 'بدون دود'] }, verdict: 'خورشید از نظر هزینه برنده است', narration: 'زغال‌سنگ هزینه سوخت و آلودگی دارد؛ خورشید سوختش رایگان است.', transition: 'flip' },
    { type: 'list', durationSec: 5, title: 'سه نکته برای یادآوری', icon: 'check', bullets: ['قیمت‌ها نود درصد کم شد', 'ساخت نیروگاه سریع است', 'ذخیره‌سازی در حال رشد است'], narration: 'پس یادتان باشد: قیمت‌ها پایین آمده، ساخت سریع است و باتری‌ها رشد می‌کنند.', transition: 'fade' },
    { type: 'cta', durationSec: 5, headline: 'برای نکته‌های بیشتر دنبال کنید', action: 'دنبال کنید', handle: '@hivegpt', narration: 'برای نکته‌های بیشتر ما را دنبال کنید.', transition: 'fade' },
  ],
};

/** About 30 s, English, 16:9. */
export const solarEn = {
  title: 'Why solar won',
  lang: 'en',
  aspectRatio: '16:9',
  theme: 'daylight',
  brandName: 'HiveGPT',
  captions: true,
  music: { track: 'pulse', volume: 0.18 },
  scenes: [
    { type: 'hook', durationSec: 4, kicker: 'Energy explained', headline: 'Solar is now the cheapest electricity in history', emphasis: ['cheapest'], narration: 'Solar is now the cheapest electricity in history.', transition: 'fade' },
    { type: 'chart', durationSec: 6, chart: 'line', title: 'Module price ($/W)', data: [{ label: '2010', value: 2 }, { label: '2015', value: 0.6 }, { label: '2020', value: 0.25 }, { label: '2024', value: 0.11 }], narration: 'Panel prices fell more than ninety percent since 2010.', transition: 'slide' },
    { type: 'timeline', durationSec: 6, title: 'Milestones', events: [{ date: '1954', title: 'First silicon cell' }, { date: '2010', title: '40 GW installed' }, { date: '2024', title: '2 TW installed' }], narration: 'From the first silicon cell in 1954 to two terawatts today.', transition: 'wipe' },
    { type: 'image', durationSec: 5, image: 'photo', headline: 'Fields of panels', caption: 'Utility-scale solar', motion: 'zoom-in', narration: 'Utility-scale farms now cover whole valleys.', transition: 'fade' },
    { type: 'quote', durationSec: 5, quote: 'The stone age did not end for lack of stone.', author: 'Sheikh Yamani', narration: 'As Sheikh Yamani said, the stone age did not end for lack of stone.', transition: 'fade' },
    { type: 'cta', durationSec: 4, headline: 'Follow for more energy facts', action: 'Follow', handle: '@hivegpt', narration: 'Follow for more.', transition: 'fade' },
  ],
};

/** About 15 s, English, 1:1, no narration (music only). */
export const squareEn = {
  title: 'Wind in numbers',
  lang: 'en',
  aspectRatio: '1:1',
  theme: 'neon',
  brandName: 'HiveGPT',
  captions: false,
  music: { track: 'cinematic', volume: 0.3 },
  scenes: [
    { type: 'stat', durationSec: 4, value: 1017, suffix: ' GW', label: 'of wind power installed worldwide', icon: 'windmill', transition: 'fade' },
    { type: 'location', durationSec: 4, place: 'Gansu Wind Farm', region: 'China', detail: 'The largest wind farm on Earth', label: 'Record holder', transition: 'slide' },
    { type: 'split', durationSec: 4, headline: 'Offshore is next', body: 'Stronger, steadier winds at sea.', bullets: ['Taller turbines', 'Higher output'], icon: 'ripple', transition: 'clock-wipe' },
    { type: 'logo', durationSec: 3, text: 'HiveGPT', tagline: 'Motion studio', transition: 'fade' },
  ],
};
