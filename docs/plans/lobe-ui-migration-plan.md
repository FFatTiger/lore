# Lobe UI Migration Plan

## Current status

- Stack upgrade is complete:
  - Next.js `16.2.4`
  - React / React DOM `19.2.5`
  - `@lobehub/ui` `5.9.5`
  - Lobe `ConfigProvider` wired in `web/components/AppShell.tsx`

- Foundation wrapper migration is complete:
  - `AppInput`, `AppPasswordInput`, `AppTextArea`, `AppSelect`, `AppCheckbox`, `AppAvatar`
  - `Badge` via Lobe `Tag`
  - `SegmentedTabs` via Lobe `Segmented`
  - `Disclosure` via Lobe `Accordion`

- Medium-risk component migration is complete:
  - `Button` via Lobe `Button` — 4 variants mapped to `type`/`danger`/`variant` props, custom CSS dropped in favor of native styling
  - `Notice` via Lobe `Alert` — 4 tones, `message` → `title` (antd deprecation)
  - `Card` via Lobe `Block` — antd Card removed, `padded`/`interactive` mapped to `padding`/`clickable`

- Bonus components added:
  - `Empty` via Lobe `Empty` — replaced custom `EmptyState` (alias kept)
  - `CopyButton` via Lobe `CopyButton` — one-click clipboard copy
  - `ActionIcon` via Lobe `ActionIcon` — icon-only buttons with built-in tooltip
  - `Tooltip` via Lobe `Tooltip` — hover hints (public API import due to ESM export mismatch)
  - `CodeDiff` via Lobe `CodeDiff` — markdown-aware split-view diff

- CodeDiff integration:
  - `/maintenance/orphans/[memoryId]` detail page with Lobe CodeDiff
  - MaintenancePage simplified: inline expansion removed, click navigates to detail page
  - Known issue: `@pierre/diffs` uses Shadow DOM with hardcoded colors, doesn't adapt to light mode

- Verification:
  - full Vitest suite: `1110 passed / 1110 tests` (67 files, recall.test.tsx resolved via vitest.config.js `deps.inline`)
  - `npm --prefix web run typecheck` passed
  - `npm --prefix web run build` passed

- Related fixes in this batch:
  - `write.ts`: `migrated_to` now correctly points old memory → new memory (was NULL)
  - Next.js 16 `params` Promise fix for 5 dynamic API routes
  - i18n: 6 missing keys added, `root` translation removed
  - Tab indicator: inset shadow removed, unified to `bg-fill-primary`
  - vitest.config.js: `@base-ui/react/merge-props` alias + `deps.inline: ['@lobehub/ui']`

## Completed batches

### 1. Button — COMPLETE
- Native LobeButton styling via `type`/`variant`/`danger` props
- 4 variants + 3 sizes, no custom CSS

### 2. Notice — COMPLETE
- Lobe Alert with `title`/`description` props
- 4 tones, antd deprecation resolved

### 3. Card — COMPLETE
- Lobe Block replacing antd Card
- 6 usages, no caller API changes

### 4. Empty — COMPLETE
- Lobe Empty replacing custom EmptyState
- Supports icon/emoji/title/description/action

### 5. CopyButton — COMPLETE
- Lobe CopyButton with built-in copy-to-clipboard + tooltip

### 6. ActionIcon — COMPLETE
- Lobe ActionIcon for icon-only buttons
- 3 sizes, 3 variants, built-in tooltip via `title` prop

### 7. Tooltip — COMPLETE
- Lobe Tooltip for hover hints
- Imported from `@lobehub/ui` public API

### 8. CodeDiff + Orphan Detail Page — COMPLETE
- Lobe CodeDiff for split-view text comparison
- New `/maintenance/orphans/[memoryId]` detail page
- `showHeader={false}`, `language="markdown"`, `viewMode="split"`
- Light mode limitation: `@pierre/diffs` Shadow DOM hardcodes colors

## Remaining / deferred

- **Light mode for CodeDiff**: blocked by `@pierre/diffs` hardcoded dark colors in Shadow DOM
- **Lobe UI visual confirmation**: done via live dev server on key routes
- **Table**: intentionally not migrating — no Lobe equivalent
- **UpdaterDisplay**: intentionally not migrating — Radix popover

## Guardrails

- Use shared wrappers in `web/components/ui/controls.tsx`; avoid importing `@lobehub/ui` directly from feature pages
- For behavior or rendering changes, write the failing test first, verify it fails, then migrate
- After TypeScript changes, run `npm --prefix web run typecheck` before claiming completion
- For frontend UI changes, run build and route smoke checks before claiming completion
- Keep migrations batched by risk level. Do not mix wide-impact changes with cleanup commits
