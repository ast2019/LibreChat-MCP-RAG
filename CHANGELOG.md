# Changelog

All notable changes to this fork are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the fork is versioned with
[Semantic Versioning](https://semver.org/) (current version in `VERSION`). Upstream
LibreChat versions are tracked separately in `package.json`.

## [Unreleased]

## [0.22.0] - 2026-10-29

### Added
- **The welcome gift is on the admin page.** The overview, the users list and the «کاربر جدید»
  form say how much credit every new account gets on sign-up (`balance.startBalance`, $0.20 in
  the saas config), in dollars and Toman.
- **A programming API users can be given.** The OpenAI-compatible API
  (`/api/agents/v1/chat/completions`, `/v1/responses`, `/v1/models`) now works as a product:
  - `model` can be a model spec name (`smart`, `gpt`, `fast`…), the same models and tools as
    in chat; agent ids still work. `GET /v1/models` lists the specs the key's user can use.
  - Per-user switch in the users list («API»: «طبق نقش / مجاز / غیرمجاز»), and a role switch on
    «دسترسی کاربران» («API برنامه‌نویسی»). The user's own switch wins over the role.
  - Keys keep their titles (Settings → «کلیدهای API»); the dialog now has a Persian guide with
    the base URL, the model names, and curl and Python examples.
  - Calls are charged to the user's credit like chat; a user with no credit gets
    `402 insufficient_balance` before any provider is called. Banned accounts are refused, as in
    chat; a user switched off gets `403 api_access_disabled`.

## [0.21.1] - 2026-10-29

### Changed
- **A tidier admin users list («کاربران و اعتبار»).** With many users the old table squeezed
  its columns until text overlapped.
  - Rows use fixed column widths. The name, email and pack label are cut with «…» and show in
    full on hover.
  - Each row's «مصرف», «افزودن اعتبار» and «مدیر کردن / برداشتن مدیریت» sit behind one «⋯»
    menu instead of three buttons.
  - The two model-access choices stack in their column.
  - On narrow screens each user becomes a card with labelled fields.
  - The heading shows the number of users, and the pager reads «۱ تا ۲۵ از ۱۲۰».

## [0.21.0] - 2026-10-29

### Added
- **Add users and admins from the admin page.** The users tab («کاربران و اعتبار») has a
  «کاربر جدید» button. The form takes a name, an email and/or an Iranian mobile number, a
  password and a role («کاربر عادی» or «مدیر»).
  - An email account needs a password; a mobile-only account signs in with the SMS code.
  - The admin vouches for the contact details: they are stored verified and nothing is sent.
  - The account gets its role's start balance, like a self-registered one.
  - Creating an admin also needs the role-management capability; a taken email or mobile
    number answers «حسابی با این ایمیل یا شماره موبایل از قبل وجود دارد».
  - New endpoint: `POST /api/admin/balance/users` (`manage:users`).
- **Make or remove admins from the users table.** Each row has «مدیر کردن» or «برداشتن
  مدیریت», with a confirmation. It uses the existing `/api/admin/roles/ADMIN/members` routes,
  which keep at least one admin. Your own row explains that you can't change your own role.

### Changed
- **My Files («فایل‌های من») redesigned.** The old table is replaced by a card grid in a wider
  dialog.
  - Images show as thumbnails; other files show a large type tile.
  - Header with the file count and total size.
  - Search, kind filter with counts (all, images, documents) and sort (newest, oldest, name,
    largest).
  - Each card has preview (images and PDFs), download and delete.
  - Select several files to delete them together. Every delete asks for confirmation first.
  - Loading skeletons, an empty library message, a no-results state with «پاک کردن
    جست‌وجو و فیلترها», a load error with retry, and «نمایش بیشتر» after 48 files.
  - Dates use the UI language's calendar (Persian dates in `fa`), and sizes use its digits.

## [0.20.2] - 2026-10-29

### Changed
- **Each pack shows its dollar value.** On the packs page («خرید اعتبار»), every pack's Toman
  price has a line under it, «معادل ۴ دلار مصرف»: the usage it buys at the prices users are
  billed (1,000,000 credits = $1). It appears with or without an online gateway.

## [0.20.1] - 2026-10-29

### Changed
- **Pack prices live on the packs page only.** The «قیمت بسته‌ها» list no longer appears in the
  balance card (composer ring, account menu, Settings → Account). While there is a reason to
  buy (the free trial, or credit run out), the card shows one «خرید بسته» link instead.
  - The account menu has a «خرید بسته» item.
  - `/payment` («خرید اعتبار») always lists every pack with its Toman price. Without a usable
    gateway, it says online payment is not on yet and links to `balance.purchaseUrl` when set.
    With a gateway, it pays online as before.

## [0.20.0] - 2026-10-29

### Added
- **Save as PDF, with Persian set right.** Each message has a «ذخیره به صورت PDF» button next
  to Copy, and the conversation export dialog offers «PDF (.pdf)».
  - The PDF is made from the same text Copy uses, laid out by the browser: Vazirmatn, right to
    left, joined letters, tables, and code kept left to right. The print dialog's «Save as PDF»
    writes it, and the text in it stays selectable.
  - Copy works as before; the PDF is only an extra way out.
  - Raw HTML in a message is escaped, as in rich-text copy.
- **Where a user's credit went (admin).** Each row on the admin users page has a «مصرف»
  button. It shows the last 7, 30 or 90 days split by what the credit paid for: chat replies,
  background memory, titles, summaries, OCR, voice to text, read-aloud, images, and so on. Each
  line shows the amount, its share and how many calls, plus the top models.
  (`GET /api/admin/balance/usage?userId=&days=`, `READ_USERS`).
  - Server speech (`stt`/`tts`) now counts as spend in the admin summary too.

### Changed
- **Bigger packs.** Starter 4,000,000 credits (was 2,000,000), standard 10,000,000 (was
  5,000,000), pro 30,000,000 (was 15,000,000). The Toman price follows the credits, so it
  doubles too. Each pack lasts twice as long.
- `docs/saas/BILLING.md` explains the real margin. The 1.3 multiplier is 30% on top of cost
  (about 23% of revenue). OpenRouter's 5.5% fee on buying credit and the gateway fee come out
  of that, leaving about 17–18% of revenue for cloud models.

## [0.19.0] - 2026-10-29

### Added
- **Invite friends (referral rewards).** Every user has an invite link
  (`/register?ref=CODE`), reached from the account menu («دعوت از دوستان») and Settings → Account.
  It shows the link with copy and share buttons, what each invite pays, and how many friends
  signed up, were rewarded and how much credit that earned.
  - When someone signs up through the link and has a verified mobile number, the new account
    gets `inviteeCredits` and the inviter gets `referrerCredits`, once.
  - Anti-abuse rules:
    - a mobile is unique per account;
    - self-invites are refused;
    - an account can be linked only within `claimWindowDays` of signing up;
    - an inviter is paid for at most `maxRewardsPerReferrer` invites;
    - the payout is an atomic claim, so concurrent requests cannot pay twice, and it is undone
      if the ledger write fails.
  - Rewards go through the transaction ledger (`referral` for the inviter, `referral_welcome`
    for the invitee) and count as granted credits in the admin summary.
  - The code waits in the browser for up to 30 days. A reward waiting on a mobile number is
    paid on the next visit after the number is verified.
  - Configured under `referral` (on in `config/librechat.saas.yaml`: 500,000 / 200,000 credits,
    20 invites).
- **Higgsfield image and video generation over MCP.** Higgsfield's official remote server
  (`https://mcp.higgsfield.ai/mcp`) is configured, and each user connects their own Higgsfield
  account from the composer's MCP picker (OAuth, no API key).
  - Generations use that account's Higgsfield credits, not HiveGPT balance.
  - The server instructions ask the model to confirm model, length and Higgsfield credit cost
    before generating, and to return a direct link.
  - Links to `.mp4`/`.webm`/`.mov` files now play inline in chat. Add Higgsfield's storage host
    to `CSP_MEDIA_SRC_EXTRA` to allow that.
  - `interface.mcpServers.use` is on so users see the picker. With `permissionSync: 'seed'`, an
    existing deployment also turns it on for USER on the admin page.
- **New AI companies appear on their own.** `modelSpecs.autoDiscover.otherProviders` adds the
  `-latest` models of providers missing from `providers` in a group named after the provider,
  with no config change (on in the saas config; Kimi has its own group).
  - Specs the catalogue adds carry their publish date (`discoveredAt`). The model menu marks
    them «جدید» for two weeks, beside their price.

### Changed
- **Confidential and local chats never use third-party tools.** For a `privacy: 'private'` or
  `'local'` spec, the server drops the MCP servers, web search, file search and code a request
  picks for itself. Only the spec's own settings apply. Before, only the hidden composer
  controls stood in the way.
- **No per-chat money figures.** The composer ring shows only how full the context window is
  (`contextCost: false`). Its cost left out background work (memory, titles, OCR, speech), so
  it read less than what was deducted. With `balance.display: pack`, the balance reads as the
  share of the pack used, also after a pack is bought; money appears only as pack prices.

## [0.18.0] - 2026-10-29

### Fixed
- **The stock name no longer flashes before the app's own.** The server writes `APP_TITLE` into
  the page's `<title>` and app-name meta tags, and hands it to the first render
  (`window.__LIBRECHAT_CONFIG__.appTitle`). The tab, the sign-in brand panel and the logo's
  alt text name the deployment from the first frame instead of showing «LibreChat» until
  `/api/config` answers. The PWA manifest name is still fixed at build time (`HiveGPT`).

### Added
- **A look for each private mode.** Choosing a confidential, local or admin model now marks
  the chat the way Temporary Chat does, each in its own color:
  - confidential (`privacy: 'private'`) is teal, with a shield;
  - local (`privacy: 'local'`) is green, with a server icon;
  - admin (`adminOnly`) is gold, with a crown, the strongest look: a two-tone composer with a
    ring, a warm glow and a gold band across the top of the welcome screen.

  The header shows a chip for the mode for the whole chat. The welcome screen states the mode
  under the greeting and glows in its color, and the composer takes the mode's tint. Temporary
  Chat's look wins when both apply. High-contrast modes keep solid edges and drop the glows.
- **The model version, before anyone has chatted on it.** OpenRouter's catalogue names the
  model each `~…-latest` alias points to (`alias_target`). It is now kept with the fetched
  prices, so «نسخهٔ فعلی» in the model menu and a new version label on the model button show
  it right after a restart. A version seen on a real reply still wins. A spec that names a
  concrete model id (the confidential ones) shows that id as its version.

### Changed
- **The composer ring shows the context window.** It fills with the share of the model's
  context used. The percentage and what the chat has cost so far (in Toman) are written beside
  it, and the card holds the token breakdown and the pack balance
  (`interface.contextUsage: true`, `contextCost: true`). Usage under one percent reads «<1%».

## [0.17.0] - 2026-10-29

### Changed
- **NexGap-style look.** The app's one theme (light and dark) now follows nexgap.ir's style. The
  logo and brand stay ours.
  - Primary color is indigo `#5B4FE5`. Primary buttons, send, switches, checkboxes, sliders,
    selected options and links use it, with white text in both modes.
  - Neutrals are NexGap's slightly violet grays: text `#1C1C22`, dark page `#1C1C22`, dark
    composer `#302F37`.
  - The chat history panel opens with a full-width «چت جدید» button.
  - The welcome screen has a bolder, larger greeting, a softer subtitle, a faint dot grid, and an
    amber glow in dark mode.
  - The composer is flatter, with a clearer edge and only a light shadow until it has focus.
  - Sign-in and registration are a split screen: a brand panel (logo, app name, tagline on an
    indigo-to-amber wash) beside the form, and pill-shaped submit buttons. Below `lg` the panel
    is hidden and the page looks as before.
  - High-contrast modes are unchanged and drop the decorative backgrounds.

## [0.16.1] - 2026-10-28

### Added
- **Ollama models in the admin status tab** (`admin?tab=status`). The «مدل محلی (Ollama)» card
  lists every installed model (from `/api/tags`) with its parameter size, quantization and disk
  size, and marks the ones loaded in memory right now (from `/api/ps`) as «فعال», with the
  memory they use, their GPU share (or «روی پردازنده (CPU)» on hosts without a GPU) and when
  they unload. A model whose unload time passed since the last check is no longer shown as
  active, and a model that is loaded but no longer installed is flagged and left out of the
  installed count. It also says when no model is loaded, when none is installed, and when the
  loaded state could not be read (a failed `/api/ps` does not mark Ollama as down).

## [0.16.0] - 2026-10-28

### Added
- **Persian voice on the server.** Speech-to-text and text-to-speech go through OpenRouter's audio
  API instead of the browser, so every phone gets them:
  - transcription with `google/gemini-3.5-transcribe`, and `elevenlabs/scribe-v2` (ZDR) in
    confidential chats;
  - speech with `google/gemini-3.8-flash-tts`, which has Persian voices.

  Billed like chat (provider cost × `priceMultiplier`; contexts `stt`/`tts`). Local chats
  keep browser speech, so audio never leaves the device. Microphone-denied, recording-limit and
  iOS playback are handled. Configured under `speech.stt.hive` / `speech.tts.hive`.
- **Sign-in with a mobile number (Kavenegar).**
  - The login page offers «موبایل | ایمیل» next to the passkey button. A 6-digit SMS code signs
    the user in, or creates the account for a new number when registration is open.
  - Users are identified by email or mobile (`user.phone`, unique per tenant), and both can be
    managed under Settings → Account.
  - Codes are hashed, expire after 2 minutes, allow 5 attempts, have a resend cooldown and
    per-number and per-IP limits, and never reveal whether a number is registered.
  - Configured under `registration.phone`; on once `KAVENEGAR_API_KEY` and
    `KAVENEGAR_TEMPLATE` are set.
- **Buying packs online (ZarinPal and IDPay).**
  - Drivers follow shetabit/payment. The amount is computed on the server from the pack's Toman
    price, the gateway verifies it, and the order is credited exactly once (atomic pending→paid,
    unique reference).
  - Users get a result page in Persian. Admins get a «پرداخت‌ها» tab with orders, filters,
    re-checks and reconciliation of pending orders.
  - Configured under `payments`.
- **Web search failover:** Serper → SerpApi → Tavily → SearXNG (`webSearch.providerChain`).
  - A provider out of credit, rate-limited or rejecting its key is skipped for a cooldown shared
    by all replicas.
  - Transient errors move to the next provider without marking the failing one.
  - SerpApi is a new provider (Google, `hl=fa`, `gl=ir`).
- **Admin «وضعیت سرویس‌ها».** The panel shows the remaining credit, usage, reset date and
  estimated days until each service runs out: OpenRouter, Serper, SerpApi, Tavily, Kavenegar, the
  payment gateways, SearXNG and the local model.
  - The search provider in use is marked.
  - It is refreshed in the background every 10 minutes (`serviceStatus`).
  - An alert appears on the dashboard when a service is low or used up.
- **PWA**:
  - installable, with Persian/RTL metadata, and a never-cached API with an offline page;
  - an «نسخهٔ جدید آماده است» update prompt instead of a silent mid-session swap;
  - «نصب برنامه» in the account menu (native prompt, or the iOS steps).

### Fixed
- Mobile:
  - safe-area insets for the notch and home indicator;
  - the iOS keyboard no longer pushes the header off screen;
  - 44px touch targets for small controls;
  - the status-bar text is readable again.
- Accounts without an email (phone-only) no longer break admin exchange or social sign-in.
- The user identity index migration builds indexes through the retrying helper, as DocumentDB
  requires.

## [0.15.0] - 2026-10-27

### Added
- **Persian OCR for scanned PDFs and images** (`documentOcr`). Pages with a text layer are read
  for free; only scanned or garbled pages are OCR'd:
  - normal chats: `google/gemini-3.8-flash` on `OpenRouter`;
  - confidential chats: the same model on `OpenRouterPrivate` (ZDR);
  - local chats: Tesseract (`fas+eng`) on our own server, so nothing leaves it.

  A stored conversation only ever becomes stricter, never public. OCR'd text is used for
  «upload as text», for file search (scanned PDFs become searchable) and for models that cannot
  read PDFs themselves (DeepSeek, GLM, Qwen, Perplexity, local models). It is stored on the file,
  so a file is never read or billed twice.
- **OCR is billed like chat.** Vision OCR records prompt/completion transactions
  (`context: 'ocr'`) at the model's real price × the endpoint's `priceMultiplier`; local
  pages record one `ocr_local` transaction of pages × `pricePerPage` (/bin/sh.00025). An
  estimate is reserved from the balance first, only real usage is charged, and a failure
  charges only the pages already read. The admin dashboard counts it, with local pages as
  pure margin. Worked example in `docs/saas/BILLING.md`.
- The file chip says «متن ۷ صفحه با OCR خوانده شد — ≈ … تومان», and «فقط ۱۰۰ صفحهٔ اول خوانده شد»
  when the PDF was longer than `maxPages`. Every OCR failure has a Persian message.
- File limits: 10 files, 50 MB each, 100 MB per message (`fileConfig`), with Persian messages
  for oversized, too many or unsupported files.
- Tesseract with `tessdata_fast` Persian and English in the api image.

### Changed
- OpenRouter no longer falls back to its own Mistral OCR (`plugins: file-parser, engine: native`),
  which was billed to our account, never to the user, and is not ZDR.
- Persian text from PDF, Word, Excel and ODT files is normalized: presentation forms, ی/ک,
  kashida, bidi marks and lines extracted in visual (reversed) order.
- A file search upload in a confidential or local chat is refused, because the embeddings
  service is not ZDR.
- OpenRouter web search keeps the other request plugins instead of replacing them.

## [0.14.1] - 2026-10-27

### Changed
- The on-server model is now labelled «داخلی — کاملاً محرمانه», and its description says it runs on
  our own server and no data leaves it. Before, the label only said where it ran.

## [0.14.0] - 2026-10-27

### Added
- **New models appear in the menu by themselves** (`modelSpecs.autoDiscover`). The server reads
  OpenRouter's catalogue (`/models`) and its Zero Data Retention list (`/endpoints/zdr`) at
  start and every 6 hours, in the background. No request waits on it.
  - **Public:** each `~{provider}/{family}-latest` alias of a listed brand that no spec offers
    yet is added to that brand's group. Today that adds «GPT Terra». Near-duplicates are in
    `exclude`.
  - **Confidential, strict:**
    - A confidential spec only ever names a concrete model id that has a ZDR endpoint, never an
      alias.
    - Existing «محرمانه» specs move to the newest ZDR version of their family.
    - A spec whose model loses ZDR is removed.
    - Listed families with no spec get one. Today that adds Claude Opus, Claude Haiku, GPT-6
      Luna, GPT-6 Astra and Gemini 4 Argon — محرمانه.
    - Claude Fable has no ZDR endpoint, so it is never offered as confidential.
  - Discovered specs pass through the same role/user access rules as written ones.
- **Prices for local models**, based on what the server costs (€80/month).
  - Each model's share is set by its speed on this CPU, so a stronger model costs more per
    token: `hivegpt-local` 0.8 / 5.5, Qwen 3.6 35B 1.6 / 8 USD per 1M tokens.
  - The formula and how to re-measure the speeds are in `docs/saas/BILLING.md`.
- Persian (and English) messages for every model-selection refusal:
  - the private-chat lock;
  - a missing, invalid, mismatched or unavailable model spec;
  - a model the endpoint does not offer (`validateModel`).

  The server sends typed `ErrorTypes` payloads, and the chat error bubble localizes them.

### Changed
- **Passkeys on an HTTPS domain behind a proxy.**
  - When `DOMAIN_CLIENT` is a public `http://` URL but the site is served on `https://` (TLS at
    Coolify/Traefik), the server also accepts the `https://` twin of that host.
  - The api log states the passkey status at startup.
  - `PASSKEY_ORIGINS` is passed through docker-compose.

## [0.13.0] - 2026-10-27

### Added
- **Confidential chats keep their model.** Specs carry `privacy: 'private' | 'local'`.
  - A saved «محرمانه» conversation cannot switch to another model, endpoint or preset. The
    selector shows a lock icon and comparing with a second model is hidden.
  - Picking a confidential model in a normal chat that has messages opens it in a new chat,
    so earlier messages never enter the confidential one.
  - The server enforces both rules (`checkSpecPrivacyLock` in `buildEndpointOption`) for
    every role, admins included. Local and normal chats switch freely as before.
- **Access switches for local and confidential AI.** New `LOCAL_MODELS` and `PRIVATE_MODELS`
  role permissions (on by default) appear on «دسترسی کاربران».
  - A per-user override on «کاربران و اعتبار» offers «طبق نقش» / «مجاز» / «غیرمجاز»
    (`user.modelAccess`, `PATCH /api/admin/users/:id/model-access`).
  - Hidden specs are filtered out of each principal's config, so the server also refuses them.
- **Which model really answered.** The concrete model the provider reports, e.g.
  `anthropic/claude-sonnet-5.5` behind `~anthropic/claude-sonnet-latest`, is saved as
  `metadata.resolvedModel`.
  - It is shown next to the answer, e.g. «Claude Sonnet 5.5».
  - The selector shows «نسخهٔ فعلی: …» once a version has actually been observed. Nothing is
    guessed.
- **Model prices for users.**
  - Each model in the selector has a cost badge («رایگان» or 1–4 coins) and an estimated
    Toman price per ~1000 words.
  - A «قیمت مدل‌ها» table under Settings → Account → Billing lists input/output per 1M tokens.
    It uses the billed rates, multiplier included.
- New specs: **Claude Fable** (`~anthropic/claude-fable-latest`) and **ChatGPT Astra**
  (`~openai/gpt-astra-latest`).
- **Passkeys for users.**
  - The login page has a full-width «ورود با کلید عبور (اثر انگشت / چهره)» button.
  - Password users with no passkey get a dismissible invitation on the new-chat screen.
  - The button and the settings row are hidden where the browser has no WebAuthn.
  - Passkeys still need the site on HTTPS (see `docs/saas/DEPLOY_COOLIFY.md`).

### Changed
- The on-server model moved from «محرمانه» to its own «لوکال» group.
- «ChatGPT — محرمانه» now runs `openai/gpt-6.1-sol`, which has ZDR endpoints.
- With `modelSpecs.enforce` on, a principal whose access rules leave no spec is refused instead
  of falling through to an unchecked endpoint.

## [0.12.1] - 2026-10-27

### Removed
- **Langfuse**, which HiveGPT does not use:
  - the «پایش هوش (Langfuse)» settings tab and its connection form;
  - the "open in Langfuse" / "view session" links in the trace viewer, token usage card and
    shared-chat page;
  - the `/api/admin/langfuse` admin API with its handlers, data-provider endpoints and types;
  - the session-link lookup on shared links and the `langfuseConnectionAccess` capability
    check, so `/api/config` makes fewer DB calls on every load;
  - the fanout gateway (`otel/langfuse-fanout`, both `*langfuse-fanout.yml` compose files and
    the Helm templates/values) and the `LANGFUSE_*` block in `.env.example`;
  - 32 Langfuse translation keys.

  The core tracing code stays; it does nothing unless `LANGFUSE_*` credentials are set.

## [0.12.0] - 2026-10-27

### Changed
- **Faster login and app entry.** `/api/models` now keeps OpenRouter's model list (and its prices)
  for 1 hour instead of 2 minutes (`MODELS_CACHE_TTL_MS` overrides it). A failed fetch is
  remembered for 60 s, so a slow or unreachable OpenRouter no longer makes every page load
  wait its 5 s timeout. `/api/config` no longer waits up to 1.5 s for the tgju rate: it uses
  the yaml rate and the live one replaces it in the background. Both caches are filled at
  server start (`warmStartupCaches`).
- **New blue logo**: a rounded blue hexagon with a white chat bubble and a spark. Favicons, app
  icons and the PWA/browser theme colour (`#2563EB`) are updated too.
- **No preselected model.** The «Gemini Flash» spec is no longer `default`, and the legacy
  "first spec" fallback is gone. A new chat shows «انتخاب مدل» with a highlighted selector and
  remembers the user's last pick. A message cannot be sent until a model is chosen; trying
  shows «لطفاً اول یک مدل هوش مصنوعی انتخاب کنید» and opens the selector.
- **Week start**: a «شنبه» option was added, and «خودکار» follows the app language, so a Persian
  UI starts on Saturday even in an English browser.
- **Speech settings in Persian**: «فارسی (ایران)» is first in the language list, language names
  are shown in the UI language, Persian is the default speech language for a Persian UI, and
  Persian browser voices are listed first.
- **Sidebar read/unread**: unread chats get a green dot and a bold title; read chats have a
  dimmed grey icon and muted title. The open chat is never dimmed.
- **Automatic titles**: when the title model is off (local models) or fails, the chat is titled
  from the first words of the user's first message instead of staying «چت جدید».
- Clearer Persian copy: Fork is now «کپی در گفت‌وگوی جدید», with plain explanations of each option.
  The LaTeX toggle is «نمایش فرمول‌های ریاضی (LaTeX)» with a plain explanation, and Langfuse is
  «پایش هوش (Langfuse)».
- «لغو همه کلیدهای API» is shown only when some endpoint accepts a user's own key; the Langfuse
  tab additionally requires the ADMIN role on the client.

### Added
- `.kiro/skills/hivegpt-ui-ux/SKILL.md`: HiveGPT UI/UX rules (palette, RTL, Persian microcopy,
  required states, accessibility, pre-merge checklist).

## [0.11.0] - 2026-10-26

### Added
- **One admin page instead of admin controls everywhere.** `/admin` is now a hub with four tabs:
  - داشبورد: sales, spend, margin, the rate, top models.
  - کاربران و اعتبار: user list and the grant dialog.
  - دسترسی کاربران: switches for what the USER role may use. It has new role routes for
    bookmarks, web search, file search, file citations and temporary chat, next to the
    existing ones.
  - حالت پیشرفته: a per-browser switch for the admin's own builder tools.
- **Model list by AI brand, with brand icons:** Claude, ChatGPT, DeepSeek, Gemini, Grok,
  GLM, Qwen and Perplexity, then «ابزارها», «محرمانه» and (admins only) «ادمین». There are
  23 specs on `~…-latest` ids, and the older spec names are kept so old chats continue.
- `interface.permissionSync: 'seed'`. The yaml's permission values are written once per
  role, and again only when they change in the yaml. Each role stores a fingerprint of what
  was applied (`configSync`), so switches flipped on the admin page survive restarts.
- GLM gets its own provider icon id (`zhipu`, aliases `glm`, `zai`, `zhipuai`, `chatglm`).
- **Admin-only uncensored local model.** Two new specs in an «ادمین» group run
  `huihui_ai/Qwen3.6-abliterated:35b` (Qwen 3.6, 35B MoE with 3B active; refusals removed
  by abliteration) on the `ollama` container as `hivegpt-uncensored`:
  - «بدون سانسور — سریع» answers directly. Its endpoint `LocalUncensored` sends
    `reasoning_effort: none`, which Ollama maps to thinking off.
  - «بدون سانسور — برنامه‌نویسی (فکر عمیق)» thinks first. The thought streams into the
    collapsible thinking row.
  - Both are free and excluded from memory, and nothing leaves the server.
- **`adminOnly` on model specs.** The spec is removed from the app config of every role
  except ADMIN, including a caller that names no role. Other roles therefore neither see it
  nor pass `modelSpecs.enforce` with it.
- `ollama` entrypoint builds every local model through one `build` step. New variables:
  `LOCAL_MODEL_UNCENSORED` (`none` skips the download) and `LOCAL_MODEL_UNCENSORED_CONTEXT`
  (16384).

### Changed
- **The admin chats on exactly the users' interface.** `adminFullAccess` no longer turns on
  the model selector, parameters or presets for admins; it only keeps the ADMIN role's
  permissions and lifts `modelSpecs.enforce` for them.
  - Outside advanced mode, `useHasAccess` reads the USER role for an admin.
  - The inline admin-settings buttons inside panels show only in advanced mode.
- **Users never see the host's name.**
  - The OpenRouter endpoints show as «HiveGPT» (`modelDisplayLabel`). Errors, icon titles
    and alt text use that label instead of the endpoint id.
  - Icons follow each model's maker.
- `LOCAL_MODEL_MEMORY` default 32g (was 8g): the 35B model holds about 22 GB while loaded.

### Not done / Known limitations
- **The 35B model itself was not run here.** It downloaded, but loading it was killed by the
  sandbox's memory limit (~22 GB resident). The production VM has 64 GB.
  - The full chat flow was verified with a small thinking model (`qwen3:0.6b`) standing in
    as `hivegpt-uncensored` on a real Ollama, against the production server build.
  - Verified: admin sees both specs and users do not. A user request rewritten to the admin
    spec is refused ("Invalid model spec"). «سریع» answers with no thinking step; «فکر عمیق»
    streams its thinking.
- Speed and answer quality of the real model on the ESXi VM are not measured.
- "Uncensored" means fewer refusals, not none. Abliteration can lower quality a little, and
  the political bias in Qwen's training data is not removed.
- The first start downloads about 23 GB. Until that finishes, the admin specs answer
  "model not found".
- Switching between «داخلی» and the admin model reloads (one model in memory at a time).
- User-facing replacement of `gemma3:4b` is not part of this release (next step).
- The UX was checked in headless Chromium against the production server build:
  - the admin and the user get the same chat controls;
  - brand order, icons, and no host name anywhere in the picker or in a failed reply;
  - an access switch reaches the user, and is kept after a server restart;
  - advanced mode adds the admin tools.

  Real model replies were not tested (the test key was fake).
- The «ادمین» group is the one thing in the admin's picker that users do not have.
- Advanced mode is stored per browser, not per account.
- A spec like «پرسش از فایل‌ها» uses Claude. If the admin turns off file search for users,
  the spec stays in the list but cannot search files.
- `MermaidBlockIds.test.tsx` fails here (1 test). It fails the same way with this release's
  changes reverted, so it is not caused by them.

## [0.10.0] - 2026-10-25

### Added
- **Admins see the full interface** (`interface.adminFullAccess: true` in the SaaS config).
  Users keep the simplified one.
  - Admins get the model selector with every endpoint (OpenRouter, OpenRouterPrivate, Local),
    parameters and presets. `modelSpecs.enforce` is lifted for them only.
  - The ADMIN role is put back to its defaults on every start: prompts, bookmarks, MCP,
    Skills, agent builder, marketplace and so on. Before, the yaml values meant for users were
    written onto ADMIN too.
- **Prices in Toman.** `interface.currency` takes `code: IRT` and an optional
  `live: { source: tgju }`. The server reads the free-market dollar (`price_dollar_rl`) from
  tgju.org every 30 minutes, with no extra fee on top.
  - The yaml `rate` is the fallback until the first reading arrives.
  - A failed read keeps the last good rate and is retried once a minute.
  - The startup config reports which rate is in use (`currencyRate`).
- **New balance display `pack`.**
  - Before a pack is granted, users see the share of the trial used and the pack prices in
    Toman (rounded up to 1,000 Toman).
  - After a pack is granted, they see the remaining credit in Toman.
  - The prices come back once the pack is spent.
- **The admin page shows Toman next to every dollar figure,** plus the rate, its source and
  its time. The grant dialog shows each pack's Toman price.
- **HiveGPT logo, favicon and app icons** (honeycomb hexagon with a chat bubble).
  `node scripts/brand-icons.mjs` renders the PNGs from `client/public/assets/logo.svg`.
- **Passkeys are on** (`ALLOW_PASSKEY_LOGIN=true`, `PASSKEY_RP_NAME=HiveGPT`). The passkey
  code was already upstream and was off.

### Changed
- **Local model speed.** The `ollama` service builds `hivegpt-local` from `gemma3:4b` with
  `num_thread` = `LOCAL_MODEL_THREADS` (12) and `num_ctx` 8192. The CPU limit is 12 (was 2).
  - Ollama started one thread per visible vCPU (24) inside a 2-CPU limit. That gave the
    0.2 tokens/s in the production log.
  - Reproduced here: 8 threads pinned to 2 CPUs ran at 0.03 tokens/s; 2 threads on the same
    CPUs ran at 6.7 tokens/s.
- Login, register and password-reset fields: the value and the label are centered, and so
  are the error and notice texts. Social and passkey buttons use `gap` so RTL spacing is right.
- The PWA theme colour is honey (`#F59E0B`). Favicon links carry `?v=hive1`, so browsers drop
  the cached LibreChat icon.
- Docs (`DEPLOY_COOLIFY.md`, `BILLING.md`, `IDEAS.md`): HTTPS, passkeys, admin view, ESXi VM
  tuning and Toman pricing.

### Fixed
- **Signed out on every reload or typed URL (e.g. `/admin`) over plain HTTP.** Production
  cookies were always `Secure`, and browsers drop those on `http://`. An explicit `http://`
  `DOMAIN_SERVER` now gets non-Secure cookies, and `https://` stays Secure.
  `SESSION_COOKIE_SECURE` still forces either way and is now passed through the compose file.
- **Passkey button no longer shows where it cannot work.** It is hidden unless an origin is
  HTTPS or localhost, since browsers expose WebAuthn only there.
- **No lone «یا» divider under the login form.** The divider counted providers listed in
  `socialLogins` (OpenID) even when they were not configured.

### Not done / Known limitations
- Verified against a real production server build (in-memory MongoDB, the SaaS yaml, the
  production client bundle) in headless Chromium.
  - On an `http://` domain: no Secure cookie; the session survives typing `/admin` and a
    reload; centered login fields; no divider; new logo and favicon.
  - Admin config and permissions vs. user; admin selector lists raw endpoints, user sees
    only the spec groups.
  - Live tgju rate (269,500 Toman at test time); Toman prices before a pack, remaining Toman
    after a grant.
  - On `localhost`: a passkey registered with a virtual authenticator, then a sign-in with
    the passkey alone.
- Unit tests pass: client (12,832), packages/api, data-provider and data-schemas.
- **Not deployed.** The Docker image was not built and the stack was not run on Coolify.
- **Passkeys need HTTPS.** The production domain is served over `http://` today, so the
  passkey button stays hidden there until the domain is switched to `https://`.
- `num_thread` was confirmed in Ollama's log (`n_threads = 2` from the Modelfile) on a native
  Ollama 0.40.11 here. Speed on the production VM was not measured. If the VM does not expose
  AVX2, it stays slow; see the ESXi section in `DEPLOY_COOLIFY.md`.
- Whether the production server (Hetzner) can reach `call1.tgju.org` was not checked. If it
  cannot, the yaml rate (270,000 Toman) is used and the admin page says so.
- The Toman price follows the live rate, so it moves with the market; there is no price lock
  between showing a price and granting the pack (there is no payment gateway yet).
- The logo is an original design made here, not a professional brand asset.
- Admin role permissions are reset to the ADMIN defaults on every start while
  `adminFullAccess` is on; per-permission edits for ADMIN do not persist.
- Users get repeated `403 /api/tags` in the server log because bookmarks are off for them.
  This is upstream behaviour and was not changed.

## [0.9.0] - 2026-10-25

### Added
- **Full Persian translation.** All 3749 UI strings now have Persian text; before, 2337 fell
  back to English. The strings follow one glossary, use the half-space (ZWNJ) correctly,
  and button labels are short ("حذف", not "حذف کنید"). Every placeholder and tag was checked
  against the English source by a script.

### Changed
- **Persian and right-to-left by default.** A visitor with no saved language gets Persian,
  right-to-left from the first frame (`<html lang="fa" dir="rtl">`), whatever the browser
  language. This includes the login and register pages. A language picked in Settings still
  wins, and "Auto detect" still follows the browser.
- **The welcome greeting keeps Persian letters joined.** The letter-by-letter animation put
  each letter in its own box, so «چطور» showed as «چ ط و ر». Persian/Arabic words now animate
  as whole words. Copying the greeting gives the text once instead of twice.
- **Less clutter for users** (`config/librechat.saas.yaml`): the prompt library, bookmarks
  and the LibreChat mascot (Lia) are off.
- **The footer no longer advertises LibreChat.** `docker-compose.yml` sets a default
  `CUSTOM_FOOTER`: «HiveGPT ممکن است اشتباه کند. اطلاعات مهم را بررسی کنید.»
- The admin page shows a translated role badge instead of the raw `ADMIN`.

### Fixed
- `THEME_CACHE_EPOCH` is bumped, so browsers that cached the theme before v0.7.0 pick up the
  Vazirmatn font. v0.7.0 changed the default fonts without bumping it.

### Not done / Known limitations
- Checked in headless Chromium against the real server (login, welcome screen, account menu,
  settings, admin page; desktop and mobile). Not checked on a real phone or in Safari.
- The translation was written by AI with one glossary and checked by script plus spot
  checks. A native-speaker review of long help texts is still worth doing.
- The logo and icons are still LibreChat's.
- To bring back the prompt library or bookmarks, set `prompts`/`bookmarks` to `true` in the
  yaml.

## [0.8.0] - 2026-10-25

### Added
- **In-app admin page at `/admin`**, visible only to users with the ADMIN role. An «Admin»
  item appears in the account menu for admins; other users get a 403 from its APIs.
  - Summary cards: users, credit sold, credit spent, estimated provider cost, margin and
    unused credit, plus the top models by spend.
  - A user table with search, a usage bar per user and an «Add credit» dialog (pick a pack
    or enter a USD amount). Grants go through the same `createTransaction` path as before.
- New admin APIs: `GET /api/admin/balance/users` (search, paging) and
  `GET /api/admin/balance/summary`, backed by `listUsersWithBalances` and
  `getBillingSummary` in data-schemas.

### Changed
- `config/librechat.saas.yaml` hides builder/operator features from end users: MCP servers,
  Skills, Agent API keys (`remoteAgents`) and the build-info panel. Langfuse tracing was
  already server-side only.

### Not done / Known limitations
- Not checked in a real browser: the browser tool could not reach the local test server.
  Verified with unit tests (client 392, packages/api billing 43, data-schemas billing) and a
  live API smoke run against the real server (9/9: 403 for non-admins, user list, grant,
  summary, interface flags, `/admin` page shell).
- No per-user usage history or charts over time yet.
- Admin page strings are English only (Persian translation deferred).
- "Estimated provider cost" divides spend by the primary `priceMultiplier`, so it is
  approximate when endpoints use different multipliers.

## [0.7.0] - 2026-10-25

### Added
- **Vazirmatn font for Persian.** The variable Vazirmatn font (weights 100–900, SIL OFL 1.1,
  licence beside the file) is bundled as `@librechat/client/fonts/Vazirmatn-Variable.woff2`.
  - The default UI, display and dialog-title stacks are now `Vazirmatn, Inter, sans-serif`,
    in `defaults.css`, the Tailwind preset and the theme registry.
  - The face's `unicode-range` covers only Arabic-script ranges plus ZWNJ/ZWJ, so Persian
    renders in Vazirmatn and Latin text, numbers in English and code keep Inter/Roboto Mono.

### Not done / Known limitations
- Not checked in a browser. Verified that the file ships in `packages/client/dist/fonts`,
  and the theme tests (client 1148, data-provider 2981) pass with the new defaults.
- Bundled themes that name their own font (e.g. ClickHouse) do not get Vazirmatn.

## [0.6.0] - 2026-10-25

### Changed
- The product is named **HiveGPT**:
  - the browser tab title and meta description (`client/index.html`)
  - the installable-app (PWA) name
  - the `APP_TITLE` default in `docker-compose.yml` and `.env.coolify.example`
  - the user-facing English and Persian strings that named LibreChat

  Internal identifiers stay unchanged so stored data keeps working: the MongoDB database name,
  package names and code comments.

### Not done / Known limitations
- The logo, favicon and PWA icons are still LibreChat's (no HiveGPT artwork provided yet).
- Coolify keeps an existing `APP_TITLE=LibreChat` variable; it must be changed to `HiveGPT`
  by hand in the Coolify UI.
- Not checked in a browser; the client build was not re-run for this change.

## [0.5.0] - 2026-10-25

### Added
- `npm run make-admin -- <email> <password> [name]`: a non-interactive way to create an
  administrator from the container terminal, or to turn an existing account into one with a
  new password.
  - New accounts are created through the normal registration path with `emailVerified: true`.
  - Existing accounts are updated through `updateUser` with the same password-reset stamp as
    `reset-password`. Their sessions are revoked and the cached auth document is evicted.

### Not done / Known limitations
- Verified against an in-memory MongoDB: create, promote with password reset, rejection of
  passwords under 8 characters, and the stored role, verification flag and bcrypt hash.
- Not run inside the deployed container. A login through the web UI after the script was not
  tested.

## [0.4.2] - 2026-10-25

### Fixed
- SearXNG crash loop on Coolify: `"/etc/searxng/settings.yml" is not a valid file`. Coolify
  copies only the compose file to the server, so the bind-mount source
  `./deploy/searxng/settings.yml` did not exist there and Docker mounted an empty directory in
  its place. The settings are now baked into a small image built from
  `deploy/searxng/Dockerfile`, and the compose has no bind mounts left.
- `SCHEDULES_SINGLE_PROCESS=true` (the stack runs one `api` replica) removes the
  `[schedules] scheduler NOT started` error from the api log.

### Not done / Known limitations
- The SearXNG image build was not run here (no container runtime). The fix follows the image's
  entrypoint, which requires `/etc/searxng/settings.yml` to be a regular file.
- Web search itself has not been tested on the deployed stack yet.

## [0.4.1] - 2026-10-25

### Fixed
- Coolify domain: the `api` container now listens on port 80 and uses `SERVICE_URL_API`, so the
  domain is entered without a port. Previously the domain needed `:3080`, and Coolify's
  `SERVICE_URL_API_3080` value carried `:3080` into `DOMAIN_CLIENT`/`DOMAIN_SERVER`, which put
  the port into links and auth redirects.

### Changed
- `DEPLOY_COOLIFY.md`: leave the domain fields of internal services empty; table of what
  each service is for.

### Not done / Known limitations
- Port 80 was verified by booting the server natively (`/health` → 200). It was not verified
  inside the Docker image or on Coolify. The image runs as root, so binding port 80 is expected
  to work there.
- Existing Coolify deployments keep their old `SERVICE_URL_API_3080` variable. Remove the `:3080`
  domain and set the plain domain again on the `api` service.

## [0.4.0] - 2026-10-25

### Added
- **Long-term memory.** `memory` is configured in the SaaS config, the agents `memory`
  capability is enabled, and the Personalization settings are shown. A memory agent
  (`google/gemini-3.8-flash`, "active but careful" instructions, five keys, 2000-token limit)
  runs after each turn. Saved memories reach the chat as the existing "Updated saved memory"
  row, which can be expanded to show the saved value.
- **Memory usage is billed.** The memory agent's token usage is charged to the user at its
  endpoint's marked-up rates as `context: memory` transactions. Upstream never billed it. A model
  call is still billed when the run fails after it.
- `memory.excludeEndpoints`: chats on the listed endpoints neither read nor write memory.
- **Confidential chats.** The `OpenRouterPrivate` endpoint sends
  `provider: { zdr: true, data_collection: 'deny' }` with every request, its title calls, and
  the memory agent. Three "محرمانه" specs (Gemini Flash, Claude Sonnet, GPT, with concrete ZDR
  model ids) hide the tool badges.
- **Local model.** An `ollama` service (`gemma3:4b`, CPU and memory limits, idle unload) and a
  `Local` endpoint, free for users, with no title calls and excluded from memory. It is offered
  as the "داخلی (کاملاً محرمانه)" spec.
- `docs/saas/IDEAS.md`: search roadmap (Serper + Jina, Firecrawl, local reranker) and a
  "better than ChatGPT and Claude" list.

### Fixed
- **Pricing for a second OpenRouter endpoint.** Live `/models` prices were loaded only for an
  endpoint literally named "OpenRouter". Any other endpoint on OpenRouter's base URL was billed
  at fallback table rates without the price multiplier. Prices now load for any endpoint that
  `isOpenRouterEndpoint` identifies.
- **Background memory saves were invisible in the chat.** The UI hid every memory attachment
  that carried a `toolCallId`, and the memory agent's attachments always carry one, although
  that call is never part of the message. The row is now hidden only when the message itself
  renders that tool call.

### Changed
- `mapCollectedMetadataToUsage` and its types moved to `packages/api/src/agents/metadata.ts`
  (re-exported from `activityLabels/host`), so the memory module does not import the whole
  endpoint stack.

### Not done / Known limitations
- **No real OpenRouter request.** A mock OpenRouter server stood in front of the real LibreChat
  server (in-memory MongoDB, production config with only the base URL swapped) and recorded
  every request. It verified:
  - the ZDR params on every private chat, title and memory request, and none on regular chats
  - billing at 1.3× the live prices, for the second endpoint too
  - the memory save and the memory charge
  - the memory attachment event in the chat stream

  Whether OpenRouter honours ZDR for each listed model was not checked live. Its
  `/endpoints/zdr` list did show Google, Azure and Bedrock endpoints for the three models.
- **The local model ran through the real chat flow,** on a native Ollama with `gemma3:4b`. It
  answered correctly in Persian, cost 0, and sent no memory or title requests. The `ollama`
  container itself and its pull-on-start entrypoint were not run (no container runtime).
- Uploading a file in a confidential chat still embeds it through the regular, non-ZDR
  OpenRouter path. Web and file search are only hidden there, not enforced off.
- The memory notice was verified with component tests and the stream event, not in a browser.
- `qwen3:1.7b` (wrong answer in Persian) and `qwen3:4b` (long English reasoning, 2–7 min) were
  tried and rejected for the local model.

## [0.3.0] - 2026-10-23

### Added
- Web-search reranking. The SaaS config no longer pins `rerankerType: none`. Jina is used when
  `JINA_API_KEY` is set, otherwise Cohere when `COHERE_API_KEY` is set, otherwise no
  reranking. Both keys are passed through `docker-compose.yml`. Pinning a reranker without a
  key is avoided on purpose, because it turns web search off (verified: `authenticated: false`).

### Changed
- File-search embeddings default to `openai/text-embedding-3-large` at 1536 dimensions
  (`EMBEDDINGS_MODEL` / `EMBEDDINGS_DIMENSIONS`), which gives stronger multilingual and Persian
  retrieval than `-3-small`. Files embedded with another model must be re-uploaded.
- rag_api sends raw text to the embeddings API (`RAG_CHECK_EMBEDDING_CTX_LENGTH=False`) instead
  of tiktoken token ids, which non-OpenAI models routed through OpenRouter may not accept.

### Not done / Known limitations
- **The new embedding model was not called.** There was no OpenRouter key and no container
  runtime here. OpenRouter documents the `dimensions` parameter, and rag_api forwards it for the
  `openai` provider, but no file was actually embedded. This also leaves open whether the
  previous token-id default ever worked against OpenRouter.
- The reranker choice was verified with the real `loadWebSearchAuth` for no key, Jina, Cohere
  and both. No live search or rerank request was sent.
- Reranking applies to web search only. rag_api has no reranker, so file-search ranking is
  pure vector similarity with 5 chunks per file.
- Reranker and embedding costs are not charged to users.

## [0.2.0] - 2026-10-23

### Added
- Low-balance notice above the composer. It shows a warning at 90% of the allotment used and an
  alert when credits run out, and can be dismissed until the state changes. Its "Buy a pack"
  button links to the new optional `balance.purchaseUrl` (http(s) only). Without that URL the
  notice shows no button.
- Optional OpenID Connect login next to email/password. `registration.socialLogins: ['openid']`
  is set in the SaaS config, and `docker-compose.yml` now carries the `OPENID_*` variables, with
  `OPENID_SESSION_SECRET` generated by Coolify. The button appears only when issuer, client id
  and secret are set.
- `docs/saas/IDEAS.md`: a checklist of ideas and follow-up work (payment gateway, OTP, passkey,
  translation, ...). It replaces `docs/saas/ROADMAP.md`.

### Changed
- `docker-compose.yml`: `ALLOW_SOCIAL_LOGIN` is now `true`, so configured providers render, and
  `ALLOW_SOCIAL_REGISTRATION` defaults to `true` and is configurable.

### Removed
- `docs/saas/ROADMAP.md` (merged into `IDEAS.md`).

### Not done / Known limitations
- **OpenID was not tested with a real identity provider.** The server booted with an
  unconfigured setup: the button was hidden and email login worked. It also booted against
  Google's real issuer with a fake client: discovery succeeded, `/oauth/openid` redirected to
  Google's authorize URL, and email login still worked. The callback and user creation were
  not exercised.
- With OpenID unconfigured, `GET /oauth/openid` answers 500 (upstream behaviour; no button
  links there).
- The notice strings are English only (Persian translation is deferred; see `IDEAS.md`).
- The Docker image and the Coolify deployment were still not built or run here (no container
  runtime). The notice was verified with component tests and the client typecheck, not in a
  browser.
- Login is by email + password, as upstream. The username is collected at registration but
  cannot be used to sign in.

## [0.1.0] - 2026-10-23

### Added
- Credit packs: `balance.packs` in `librechat.yaml` (id, label, credits). An admin grants a
  pack, or a raw credit amount, through `POST /api/admin/balance/grant` (needs `manage:users`)
  or `npm run grant-pack`. The grant is recorded in the transaction ledger
  (`context: pack` / `admin`) and stored on the balance as `packId`, `packLabel`,
  `packAllotment` and `packGrantedAt`. Leftover credits carry over into the new allotment.
- Admin lookups `GET /api/admin/balance/packs` and `GET /api/admin/balance/user?email=|userId=`
  (needs `read:users`).
- `endpoints.custom[].priceMultiplier`: scales every billed rate (prompt, completion, cache) of
  an endpoint, so users pay the OpenRouter USD price times the deployment margin. The value is
  never sent to clients.
- OpenRouter cache prices (`input_cache_read`, `input_cache_write`, `input_cache_write_1h`) are
  read from `/models` and used for cache-token billing.
- The usage bar measures spend against the last granted pack and names it
  ("Current pack: …"). The bar also appears in the account menu under the email.
- `config/librechat.saas.yaml`: OpenRouter-only configuration. It includes eight Persian
  model specs (fast, smart, GPT, economy, pro, research, Perplexity, documents), a
  ChatGPT-style simplified interface, a percent-only balance display, a free trial, three
  packs, and web search via self-hosted SearXNG with the Keenable reader.
- `docker-compose.yml` for Coolify. It builds the multi-stage `Dockerfile.multi`
  (`api-build` target) and runs MongoDB with auth, Meilisearch, pgvector, rag_api
  (embeddings through OpenRouter) and SearXNG. Secrets come from Coolify magic variables.
  Also added `.env.coolify.example` and `deploy/searxng/settings.yml`.
- Persian documentation in `docs/saas/`: software map, billing, Coolify deployment and roadmap.
- Persian translations for the balance surfaces.
- `VERSION` file and this changelog.

### Changed
- `docker-compose.yml` is now the production/Coolify stack. The upstream development compose
  was replaced.
- Persian `com_nav_balance` now reads «موجودی». It previously read «تعادل», which means
  equilibrium.

### Fixed
- OpenRouter router models that advertise a price of `-1` (dynamic, e.g. `openrouter/fusion`)
  were billed at the absolute value, i.e. **$1 per token**. They are now left out of the
  fetched price table and fall back to LibreChat's default rate resolution.
  `openrouter/auto` keeps its fixed estimate.

### Removed
- All GitHub Actions workflows (`.github/workflows/*`). Builds, tests and linters run locally;
  the commands are in `README.md`.

### Not done / Known limitations
- **Not deployed on Coolify, and the Docker images and compose stack were never built or
  started**: the build sandbox has no working container runtime. Neither were the
  `searxng` settings, the `rag_api` → OpenRouter embeddings path, the MongoDB auth URI or the
  healthchecks. The compose file was only checked by reading it against the Coolify docs.
- **No real chat completion ran** (no OpenRouter key was available). Deduction at marked-up
  prices is covered by an integration test that calls `spendTokens` with a price table
  produced by `processModelData` + `applyPriceMultiplier` against MongoDB. It was not
  observed end to end through a streamed chat.
- Verified locally against an in-memory MongoDB with the production client build:
  - server boot with `config/librechat.saas.yaml`
  - registration and login
  - the startup config (packs, eight specs, model selector hidden, multiplier not exposed)
  - the trial balance
  - admin grant, lookup and 403 for non-admins
  - the live OpenRouter model fetch (468 models)
  - the `grant-pack` CLI

  The CLI was **not** run inside the Docker image.
- Per-request provider fees (OpenRouter `web_search` pricing, e.g. Perplexity Sonar) and
  rag_api embedding costs are not charged to users.
- Usage paths other than the custom-endpoint chat flow (e.g. automatic summarization) were not
  checked for the multiplier.
- The Perplexity spec relies on the model's own search. Whether LibreChat renders
  OpenRouter's citation annotations for it was not checked.
- Payment gateway, phone/OTP login, and an admin UI for packs are not implemented
  (see `docs/saas/IDEAS.md`).
- Only the balance strings were translated to Persian. About 60% of the Persian UI is still
  untranslated upstream.
- The first commit on the branch was made with git hooks disabled because dependencies were
  not installed yet. It only deletes workflow files.
- `packages/api/src/middleware/__tests__/concurrency.cache_integration.spec.ts` needs a live
  Redis and was not run.
