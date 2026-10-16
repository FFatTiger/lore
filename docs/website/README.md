# Website docs

This directory is the source of truth for the public documentation at <https://loremem.com/documents>. The loremem web app copies it at build time and renders every page to static HTML.

- `manifest.json` (English) and `manifest.zh-cn.json` (Chinese) define the sidebar. Each entry in `parents` is one sidebar section: `category` is the section label, the parent page comes first, and its `children` follow in order. Both manifests must list the same paths in the same order.
- `content/documents/<path>.mdx` holds the English page and `<path>.zh-cn.mdx` the Chinese one. The files are plain Markdown; the `.mdx` extension is historical.

## Writing a page

- Don't add an H1 or frontmatter. The title and description come from the manifest. Start with a short paragraph, then use `##` sections.
- Link to other pages as `/documents/<path>` in both languages; Chinese pages are localized automatically. Same-page anchors use the heading text, lowercased, with other characters turned into `-`.
- Use GitHub-style callouts sparingly: `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`.
- Tag every code block with its language (`bash`, `json`, `toml`, `yaml`, `env`, `sql`, `text`).
- Keep the docs about using Lore: setup, concepts, daily work, and troubleshooting. Leave implementation notes, database internals, and change history out.

When a page moves, add a redirect for the old URL in the web app's `public/_redirects`.
