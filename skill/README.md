# Deployment Skills

Place shared deployment skills in this directory. Each skill should live in its own folder with a
`SKILL.md` file, for example:

```text
skill/
  my-shared-skill/
    SKILL.md
    references/
      notes.md
```

These skills are loaded at server startup, exposed read-only to all users with Skills enabled, and
are not persisted as Skill documents in MongoDB.

`display-title` in the frontmatter sets the name pickers show (the `/` and `$` menus, the composer
`+` menu), for example a Persian title for an ASCII `name`.

## Skills shipped with HiveGPT

| Folder | Title | Tool it uses |
|---|---|---|
| `persian-calendar` | تقویم و تاریخ فارسی | `persian_calendar` |
| `persian-orthography` | نگارش و نیم‌فاصله | `persian_normalize` |
| `natural-persian-content` | نوشتن محتوای فارسی | `persian_normalize` |

The two tools are deterministic and local (`packages/api/src/persian`). Ordinary chats get them
unless `persianTools.chat` is `false`; a saved agent gets each tool when a skill that uses it is in
the agent's skill scope and active for the user. The official lunar holidays of each year go in
`persianTools.holidays` in `librechat.yaml`.
