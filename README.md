# linux.sb Suite

> Compact floating panel for [linux.sb](https://linux.sb/) (and `www.linux.bi`) that surfaces the logged-in user, daily check-in status, and lets you toggle automatic sign-in.

![panel screenshot](docs/panel-expanded.png)

## Install

1. Install the [Tampermonkey](https://www.tampermonkey.net/) extension.
2. Install the script from [Greasy Fork](https://greasyfork.org/) (search for `linux.sb Suite`).
3. Open <https://linux.sb/> — a small pill appears in the bottom-right corner.

## Features

- **Always-visible status pill**: avatar + nickname + a colored dot that reflects the daily check-in state (green = signed in, yellow = not yet, gray = guest).
- **One-click sign-in**: expand the pill and tap `立即签到` if you have not signed in today.
- **Auto sign-in**: a switch in the expanded panel enables automatic check-in on every page load. Persisted in `GM_*`, no per-session confirmation.
- **Self-update**: the script polls its update URL on the configured schedule (managed by Tampermonkey). When a new version is available, TM prompts you to update.

## Privacy

- No data leaves your browser except ordinary requests to `linux.sb` initiated by the script itself (the daily check-in POST).
- `GM_setValue` is used to remember your auto-signin preference and a cached copy of your user info. These are stored locally by Tampermonkey and never sent anywhere.
- The script does not inject into iframes, does not touch any page outside `linux.sb` / `www.linux.bi`, and does not load any third-party resources at runtime.

## Architecture

```
LSB  (root namespace, the only global)
 +-- core/      (always loaded, no module deps)
 |     config, logger, utils, storage, http, events, dom
 +-- api/       linuxSb  (selectors, URL patterns, response shape)
 +-- modules/   user, signin, ui, debug
```

Modules are registered with `LSB.register("name", factory, deps)`. Dependencies are resolved in topological order, then each factory is called with the resolved core + module instances.

To add a feature, append a `LSB.register(...)` block at the bottom of `src/linux-sb-suite.user.js`:

```js
LSB.register("myFeature", function ({ config, http, dom, user }) {
  return {
    name: "myFeature",
    init() { /* ... */ },
  };
}, ["config", "http", "dom", "user"]);
```

Toggle the feature in `LSB.config.modules.myFeature`.

## Development

```bash
npm install

# Start a local file server on http://127.0.0.1:8123 serving the dev script.
node serve.mjs &

# Start Chrome with the debug port (Windows).
powershell -ExecutionPolicy Bypass -File start-chrome.ps1

# Drive Chrome via CDP.
node chrome-cdp.mjs list
node chrome-cdp.mjs eval "window.LSB.api.getCurrentUser()"

# After editing the dev script, push the update to your local TM install.
node chrome-cdp.mjs tm-update
```

### Producing a public build

The repo keeps `linux-sb-suite.user.js` as the dev version (with localhost `updateURL` so the dev loop self-updates). Run `node build.mjs` to produce `dist/linux-sb-suite.user.js` — that artifact is what gets submitted to Greasy Fork.

Edit `.build-meta.json` to bump version / change the public metadata.

## License

MIT.