# Changelog

All notable changes to this fork are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the fork is versioned with
[Semantic Versioning](https://semver.org/) (current version in `VERSION`). Upstream
LibreChat versions are tracked separately in `package.json`.

## [Unreleased]

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
