---
inclusion: always
---

# HiveGPT: project context for every session

Read this before working on the repository. It holds what the owner already told us, so they do
not have to repeat it. No secrets live here: never write passwords, API keys or tokens into this
file, the repository or a chat.

## The product

- HiveGPT is a Persian-first, RTL fork of LibreChat. It is live at **https://hivelink.co** and its
  repository is `ast2019/LibreChat-MCP-RAG`.
- The owner's admin account email is `admin@adminhivelinkaipanel.com`. We have never been given
  its password and must never ask for it in chat.
- It is deployed with **Coolify** using `docker-compose.yml`. The app reads
  `config/librechat.saas.yaml` (`CONFIG_PATH`). Secrets live in Coolify environment variables
  (see `.env.coolify.example`). A change reaches the site only after a redeploy from `main`.
- The services are `api` (port 80), Mongo, Meilisearch, rag_api, `ollama` (local models, not
  exposed outside the Docker network) and SearXNG. Web search uses Serper → SerpAPI → Tavily →
  SearXNG, and pages are read by Keenable (`api.keenable.ai`, an external service; keyless with a
  public rate limit, or `KEENABLE_API_KEY`).
- Local models: `hivegpt-local` (spec `local`, `gemma3:4b`, CPU) for everyone with local access,
  and `hivegpt-uncensored` (specs `local-uncensored`, `local-uncensored-think`) for admins only.
  The server's RAM and CPU are still unknown; ask before proposing a bigger local model.

## How the owner wants work done

- Work on a feature branch, open a PR to `main`, then **merge it yourself** and deliver the final
  version. Bump `VERSION` and add a dated section to `CHANGELOG.md` for each delivery.
- Answer the owner in Persian, plainly. Say what was verified and what was not; this sandbox
  cannot run the server or a browser, so UI changes are tested with Jest, not seen.
- Persian copy:
  - no Arabic vowel marks (fatha, damma, kasra, sukun); «لطفاً» and «مثلاً» keep their tanvin;
  - real half-spaces (ZWNJ, U+200C);
  - keys added in both `en` and `fa`.
- Product wording:
  - The local model class is «لوکال امن»; the admin-only local models are «لوکال امن خاص».
  - On public pages, local models are «هوش مصنوعی‌های خاص و لوکال». Never mention uncensored models
    publicly.
  - Users never see the host's name (OpenRouter, Ollama).
- The sign-in page shows the full comparison with similar services (GapGPT, Hoosha, ChatQT) on the
  page itself, beside the form or under it on mobile; no separate page, no scrolling on a laptop.
- Admin UI stays light: show only what a user has (no dash marks or counts); details live in the
  user sheet. Packs and their access (`grants`) are managed on the admin page, not in YAML.

## Open items

- **Pack access:** no pack has `grants` yet; the owner sets them on «پنل مدیریت ← بسته‌ها».
  After deploying 0.27.0 or later, run `npm run sync-user-packs` once from `/app` (not `/app/api`).
- **API (0.29.0):**
  - Done: caller tools in `/chat/completions`, `rateLimits.api` at 60/min, the OpenAPI document at
    `/api/docs`, and the Persian guide `docs/api/README.fa.md`.
  - Codex CLI is not supported (it needs custom tools on `/responses`).
  - The packaged host `createAgentChatCompletion` does not bind caller tools.
  - The local `gemma3:4b` model is not suited to agent mode.
- **Agent browser:** decided, not built; see `docs/plans/agent-browser-fa.md`.
  - The owner's decisions: pack access with a per-pack limit (1 for now), a RAM and CPU check
    that refuses with «ظرفیت فعلاً وجود ندارد، با پشتیبانی تماس بگیرید», admin views of server
    status and browser logs, a 3-minute idle close, and sign-in, CAPTCHA and payment by the user
    in a live view. Nothing is kept after the browser closes, and there is no automated CAPTCHA
    bypass.
  - It is built in phases B1 to B4. Still open: the default thresholds, the server-wide browser
    limit, and which packs get it.
  - The sign-in comparison lists it as «به‌زودی»; switch it to «آزمایشی» when it ships.
- **Content tools (0.30.0, experimental):** the article wizard (`skill/article-writer`,
  `create_word_document`) and the slide builder (`skill/slide-builder`, `create_presentation`),
  in `packages/api/src/office`.
  - Plans: `docs/plans/article-wizard-fa.md` and `docs/plans/slides-builder-fa.md`.
  - Vazirmatn's TTFs for Word embedding live in `api/server/services/Office/fonts`.
  - The comparison marks «سرویس‌های مشابه» as «بعضی» for these rows: no competitor page was
    found to confirm or rule them out.
  - Not built yet: an in-chat preview of the pages and slides.
