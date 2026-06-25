# Research: WXT Side Panel Support

- **Query**: Check WXT framework for side panel support, `defineSidePanel`, storage API sharing
- **Scope**: mixed (internal codebase + WXT node_modules source)
- **Date**: 2026-06-25

## Findings

### 1. No `defineSidePanel` API Exists

WXT does NOT have a `defineSidePanel` function. The sandbox module (`wxt/sandbox`) exports only:
- `defineContentScript`
- `defineBackground`
- `defineUnlistedScript`
- `defineWxtPlugin`
- `defineAppConfig`

**Source**: `node_modules/wxt/dist/sandbox/index.d.ts`

### 2. Side Panel is an Entrypoint Type (Convention-Based)

Side panels are defined as **HTML entrypoints** using WXT's file convention system, not through a JS `define*` function. The entrypoint detection patterns are:

```
sidepanel.html              -> sidepanel
sidepanel/index.html        -> sidepanel
*.sidepanel.html            -> sidepanel (named)
*.sidepanel/index.html      -> sidepanel (named)
```

**Source**: `node_modules/wxt/dist/core/utils/building/find-entrypoints.mjs` (lines 353-356)

### 3. `SidepanelEntrypointOptions` Interface

WXT defines side panel options in its type system:

```typescript
interface SidepanelEntrypointOptions extends BaseEntrypointOptions {
  openAtInstall?: PerBrowserOption<boolean>;  // Firefox only
  browserStyle?: PerBrowserOption<boolean>;   // deprecated
  defaultIcon?: string | Record<string, string>;
  defaultTitle?: PerBrowserOption<string>;
}
```

**Source**: `node_modules/wxt/dist/types.d.ts` (lines 645-657)

### 4. Manifest Generation for Side Panels

The manifest generation logic (`node_modules/wxt/dist/core/utils/manifest.mjs` lines 247-269):
- For **Firefox**: generates `sidebar_action` manifest entry with `browser_style`, `default_icon`, `default_title`, `open_at_install`
- For **Chromium MV3**: generates `side_panel.default_path` and adds `"sidePanel"` permission
- Chromium MV2 is NOT supported (logs a warning)

### 5. No `createShadowRootUi` Equivalent for Side Panels

WXT's UI creation APIs are **content-script-only**:
- `createShadowRootUi` - requires `ContentScriptContext`
- `createIframeUi` - requires `ContentScriptContext`
- `createIntegratedUi` - requires `ContentScriptContext`

Side panels are full HTML pages (like popup/options), not content script UIs. They get their own document context.

### 6. `wxt/storage` API - Shareable Across Contexts

The `@wxt-dev/storage` module provides a unified storage API that works across ALL extension contexts:

```typescript
import { storage } from 'wxt/storage';

// Works in background, content scripts, side panel, popup, etc.
await storage.getItem<number>("local:installDate");
await storage.setItem("local:key", value);
storage.watch("local:key", (newVal, oldVal) => { ... });
```

Key features:
- Storage areas: `local`, `session`, `sync`, `managed`
- Key format: `"area:key"` (e.g., `"local:settings"`)
- `defineItem()` for typed items with defaults, migrations, versioning
- `watch()` for cross-context change notifications
- `snapshot()` / `restoreSnapshot()` for bulk operations

**Source**: `node_modules/@wxt-dev/storage/dist/index.d.mts`

### 7. Current Project State

- **WXT version**: 0.19.29
- **No sidepanel entrypoint exists** in `entrypoints/` directory
- **No sidepanel config** in `wxt.config.ts`
- **Existing entrypoints**: `background.ts` and `content/` (content script with Shadow DOM UI)
- The `sidePanel` permission is NOT in the current manifest permissions

### 8. How to Add a Side Panel to This Project

Based on WXT conventions, the steps would be:
1. Create `entrypoints/sidepanel/index.html` (and optionally `entrypoints/sidepanel/main.ts`)
2. Add `"sidePanel"` to permissions in `wxt.config.ts` manifest config
3. The side panel page can import `wxt/storage` to share state with content scripts and background

## Caveats / Not Found

- No web search was performed (MCP tools not available in this environment)
- The `SidepanelEntrypointOptions` does NOT include Vue-specific integration; the side panel page would need to mount Vue manually (unlike content scripts which use `createShadowRootUi`)
- Firefox uses `sidebar_action` (different API) while Chromium uses `side_panel` - WXT abstracts this but options differ per browser
- Side panel opening behavior (programmatic open/close) would require using `chrome.sidePanel.open()` directly - WXT does not wrap this API
