# Lobe UI Migration Plan

## Current status

- Stack upgrade is complete and pushed:
  - Next.js `16.2.4`
  - React / React DOM `19.2.5`
  - `@lobehub/ui` `5.9.5`
  - Lobe `ConfigProvider` is wired in `web/components/AppShell.tsx`
- Foundation wrapper migration is complete and pushed in `0a8c1db feat: expand Lobe UI foundation wrappers`:
  - `AppInput`
  - `AppPasswordInput`
  - `AppTextArea`
  - `AppSelect`
  - `AppCheckbox`
  - `AppAvatar`
  - `Badge` via Lobe `Tag`
  - `SegmentedTabs` via Lobe `Segmented`
  - `Disclosure` via Lobe `Accordion`
- Current verification for the foundation batch:
  - full Vitest suite: `55 passed / 1008 tests`
  - `npm --prefix web run typecheck` passed
  - `npm --prefix web run build` passed
  - smoke routes returned `200`: `/recall/drilldown`, `/memory`, `/setup/boot/agent`, `/settings`

## Guardrails

- Keep migrations batched by risk level; do not mix wide-impact components into foundation cleanup commits.
- Use shared wrappers in `web/components/ui/controls.tsx`; avoid importing `@lobehub/ui` directly from feature pages unless there is a specific reason.
- For behavior or rendering changes, write the failing test first, verify it fails, then migrate.
- After TypeScript changes, run `npm --prefix web run typecheck` before claiming completion.
- For frontend UI changes, run build and route smoke checks before claiming completion.
- Do not commit generated `web/next-env.d.ts` changes unless they are intentional.

- Current foundation cleanup status:
  - Visible production `input`, `textarea`, and `select` controls in recall, memory, and settings pages have been routed through shared wrappers.
  - `RecallWorkbench` uses `AppTextArea`, `AppInput`, `AppSelect`, and `AppCheckbox`; its remaining native controls are only test mocks.
  - `SettingsSectionEditor` uses `AppInput`, `AppPasswordInput`, and `AppSelect` for number, string/secret, and enum fields.
  - `MemoryEditor` and `CreateNodeForm` use `AppInput` for priority number fields.
  - The hidden backup import file picker in `SettingsPage` intentionally remains a native file input because Lobe catalog search did not identify an equivalent file-upload wrapper in the current foundation set.

## Next batch: medium-risk component planning

### 1. Button

- Risk: high usage count and visual/interaction impact.
- Inventory completed:
  - Total current `Button` usages: 42
  - Variants: `ghost` 23, `primary` 9, `secondary` 6, `destructive` 3, dynamic expression 1
  - Sizes: default `md` 21, `sm` 21
  - Files with usages: `DreamDetailView`, `DreamPage`, `MaintenancePage`, `MemoryBrowser`, memory node forms/header/dialogs, recall pages, settings pages, setup pages, `ConfirmDialog`, `SettingsSectionEditor`
- Lobe component candidate:
  - `@lobehub/ui` `Button`
  - Local reference: `/home/proxxy/.claude/skills/lobe-ui-advisor/references/components/Button.md`
  - Upstream doc path: `src/Button/index.md`
  - Relevant props: `type`, `variant`, `size`, `danger`, `loading`, `disabled`, `icon`, `shadow`, `glass`
- Current status:
  - Inventory completed.
  - Wrapper migration started after user requested direct visual iteration in dev.
  - `Button` callers should remain unchanged; only `web/components/ui/controls.tsx` should carry the mapping.
- Current semantic mapping to preserve:
  - local `primary` likely maps to Lobe/antd `type="primary"`
  - local `secondary` likely maps to default or filled/outlined styling, must compare visually before changing
  - local `ghost` likely maps to text/borderless styling, must preserve compact header/action-button feel
  - local `destructive` likely maps to `danger` plus primary/default type depending context
  - local `sm` must map to Lobe/antd `size="small"`; local default `md` likely maps to `size="middle"` or Lobe default
- Next steps before implementation:
  - Add wrapper tests for all local variants and both sizes.
  - Check runtime render on high-use screens before and after: `/memory`, `/settings`, `/recall/drilldown`, `/dream`.
  - Migrate only the wrapper if the caller API can stay unchanged.
- Do not combine with Dialog/Popover/Table work.

### 2. Notice

- Risk: medium; alert tone and spacing are visible across setup and error states.
- Current status:
  - Wrapper migration started after user approved direct visual iteration in dev.
  - `Notice` callers remain unchanged; mapping lives in `web/components/ui/controls.tsx`.
- Lobe component candidate:
  - `@lobehub/ui` `Alert`
  - Local reference: `/home/proxxy/.claude/skills/lobe-ui-advisor/references/components/Alert.md`
  - Upstream doc path: `src/Alert/index.md`
  - Relevant props: `type`, `variant`, `message`, `description`, `icon`, `showIcon`, `colorfulText`
- Current semantic mapping:
  - local `info` -> Lobe `type="info"`
  - local `warning` -> Lobe `type="warning"`
  - local `danger` -> Lobe `type="error"`
  - local `success` -> Lobe `type="success"`
  - local `title` -> Lobe `message`
  - local children -> Lobe `description`
- Visual confirmation needed on setup, recall analytics, dream detail, and memory node pages.

### 3. Card

- Risk: medium; heavily affects layout density and surfaces.
- Plan:
  - Count `Card` usage and identify `padded={false}` cases.
  - Evaluate whether Lobe `Block`/card-like components can preserve current padding and border behavior.
  - Migrate only the wrapper if it does not require feature-page rewrites.

### 4. Dialog / Popover

- Risk: medium-high; accessibility and interaction behavior can change.
- Current status:
  - Confirm dialog migrated to Lobe `Modal`, but visual parity still needs later tuning.
  - `UpdaterDisplay` popover should stay on Radix for now: it is hover-persistent rich content with custom enter/leave state, and Lobe catalog search only surfaced Tooltip/DropdownMenu/GuideCard, none of which preserve the current behavior without churn.
- Plan:
  - Treat ConfirmDialog, move dialogs, and popover displays as separate sub-batches.
  - Start with tests around open/close and content rendering.
  - Avoid replacing Radix primitives unless Lobe behavior is equivalent for the specific usage.

### 5. Table

- Risk: high; data density and responsiveness matter.
- Current status:
  - Inventory completed: usage is concentrated in recall stages, recall drilldown, and dream diary.
  - Keep current TanStack table wrapper for now. Lobe catalog search did not surface a table/data-grid component; closest results were `Grid` and `SortableList`, which do not match tabular analytics data.
- Plan:
  - Do not migrate Table unless a real Lobe table component is introduced or selected explicitly.
  - Continue preserving the existing wrapper API and row-key regression tests.
  - If revisited later, start with recall analytics tables only and compare density before widening scope.

## Suggested immediate next step

Button inventory is complete. Next, write wrapper tests for variants/sizes, then decide whether the wrapper can migrate without changing callers.
