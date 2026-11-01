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
| `article-writer` | ویزارد مقاله | `create_word_document` |
| `slide-builder` | ساخت پاورپوینت | `create_presentation` |

The Persian tools are deterministic and local (`packages/api/src/persian`). Ordinary chats get
them unless `persianTools.chat` is `false`; a saved agent gets each tool when a skill that uses it
is in the agent's skill scope and active for the user. The official lunar holidays of each year go
in `persianTools.holidays` in `librechat.yaml`.

The Word and PowerPoint builders (`packages/api/src/office`) build files on the server and save
them to the user's files. Ordinary chats get them unless `officeTools.word` or
`officeTools.slides` is `false`; saved agents get them through these two skills, the same way.
The composer's «ساختن» rows turn the skill on for the next message.
