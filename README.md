# linux.sb Suite

> Compact floating panel for [linux.sb](https://linux.sb/) (and `www.linux.bi`) that surfaces the logged-in user, daily check-in status, and lets you toggle automatic sign-in.

![panel screenshot](docs/panel-expanded.png)

## Install

1. Install the [Tampermonkey](https://www.tampermonkey.net/) extension.
2. Install the script from [Greasy Fork](https://greasyfork.org/en/scripts/590905-linux-sb-suite) (search for `linux.sb Suite`).
3. Open <https://linux.sb/> — a small pill appears in the bottom-right corner.

After install, Tampermonkey auto-updates the script from Greasy Fork using the script's built-in `@updateURL`.

## Features

- **Always-visible status pill**: avatar + nickname + a colored dot that reflects the daily check-in state (green = signed in, yellow = not yet, gray = guest).
- **One-click sign-in**: expand the pill and tap `立即签到` if you have not signed in today.
- **Auto sign-in**: a switch in the expanded panel enables automatic check-in on every page load. Persisted in `GM_*`, no per-session confirmation.
- **Self-update**: Tampermonkey polls Greasy Fork's meta endpoint on its own schedule. New versions land with one click.

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

To add a feature, append a `LSB.register(...)` block at the bottom of `linux-sb-suite.user.js`:

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

### Producing a public release

The repo keeps `linux-sb-suite.user.js` as the dev version (with a localhost `@updateURL` so the dev loop self-updates). `dist/linux-sb-suite.user.js` is the public artifact that ships to users.

`build.mjs` reads `.build-meta.json` and rewrites the public file's metadata: `@version`, `@author`, `@namespace`, `@description`, `@license`, plus the `@updateURL` / `@downloadURL` that point at Greasy Fork's auto-update endpoints.

Release flow once a feature is ready:

1. Bump `version` in `.build-meta.json` (e.g. `1.0.1` → `1.1.0`).
2. `node build.mjs` regenerates `dist/linux-sb-suite.user.js` and mirrors the version into the runtime `LSB.version` constant.
3. `git add . && git commit && git push`.
4. Greasy Fork's script page already has a "Source code" sync configured against the GitHub raw URL (`https://raw.githubusercontent.com/vfhky/linux-sb-pro/main/dist/linux-sb-suite.user.js`) in auto mode. The new version is detected on the next sync tick.
5. Tampermonkey picks up the new meta from `@updateURL` on its own update check and offers the upgrade to installed users.

The dev script's `@version` is left at the in-progress dev number (e.g. `0.3.6`); only the public release version is bumped in step 1.

## License

Apache-2.0.


