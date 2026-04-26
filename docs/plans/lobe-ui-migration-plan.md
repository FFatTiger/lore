# Lobe UI Migration Plan

## Current status

- Stack upgrade is complete and pushed:
  - Next.js `16.2.4`
  - React / React DOM `19.2.5`
  - `@lobehub/ui` `5.9.5`
  - Lobe `ConfigProvider` is wired in `web/components/AppShell.tsx`
- Foundation wrapper migration is complete:
  - `AppInput`, `AppPasswordInput`, `AppTextArea`, `AppSelect`, `AppCheckbox`, `AppAvatar`
  - `Badge` via Lobe `Tag`
  - `SegmentedTabs` via Lobe `Segmented`
  - `Disclosure` via Lobe `Accordion`
- Medium-risk component migration is complete:
  - `Button` via Lobe `Button` (4 variants + 3 sizes, wrapper in `controls.tsx`)
  - `Notice` via Lobe `Alert` (4 tones, wrapper in `controls.tsx`)
  - `Card` via Lobe `Block` (antd Card removed, wrapper in `layout.tsx`)
  - `ConfirmDialog` via Lobe `Modal`
- Wrapper tests completed for all migrated components (Button, Notice, Card)
- Current verification:
  - full Vitest suite: `1041 passed / 1041 tests` (1 pre-existing suite failure in recall.test.tsx due to @base-ui/react module resolution unrelated to migration)
  - `npm --prefix web run typecheck` passed
  - `npm --prefix web run build` passed
  - smoke routes returned `200`: `/memory`, `/settings`, `/recall/drilldown`, `/dream`, `/setup/boot/agent`

## Completed batches

### 1. Button — COMPLETE

- Wrapper in `web/components/ui/controls.tsx` using Lobe `Button`.
- 4 variants: `primary`, `secondary`, `ghost`, `destructive` — CSS + semantic type/variant mapping.
- 3 sizes: `sm` → `small`, `md` → `middle`, `lg` → `large`.
- Wrapper tests cover all variants and sizes.

### 2. Notice — COMPLETE

- Wrapper in `web/components/ui/controls.tsx` using Lobe `Alert`.
- 4 tones: `info`, `warning`, `danger`, `success`.
- Wrapper tests cover all tones, icon rendering, and default tone.

### 3. Card — COMPLETE

- Wrapper in `web/components/ui/layout.tsx` using Lobe `Block`.
- `padded` boolean maps to Block `padding` (16 or 0).
- `interactive` boolean maps to `clickable` + hover classes.
- Removed antd Card dependency from the wrapper layer.
- 6 usages across 5 files, no caller API changes needed.
- Wrapper tests updated for Block mock.

### 4. Dialog / Popover — COMPLETE (no further migration)

- `ConfirmDialog` already uses Lobe `Modal`.
- `MoveDialog` is an inline form, no library dependency.
- `UpdaterDisplay` popover stays on Radix (hover-persistent rich content).
- Table: not migrating (no Lobe equivalent).

## Remaining / deferred

- Visual confirmation for Button/Notice/Card on live screens (need dev server + browser).
- Table: intentionally not migrating — Lobe has no table/data-grid component.
- UpdaterDisplay: intentionally not migrating — Radix popover behavior not replicable with Lobe.

## Guardrails

- Use shared wrappers in `web/components/ui/controls.tsx`; avoid importing `@lobehub/ui` directly from feature pages.
- For behavior or rendering changes, write the failing test first, verify it fails, then migrate.
- After TypeScript changes, run `npm --prefix web run typecheck` before claiming completion.
- For frontend UI changes, run build and route smoke checks before claiming completion.
- Keep migrations batched by risk level. Do not mix wide-impact changes with cleanup commits.
