<div align="center">

<img src="https://heartunderblade.neocities.org/old_site/images/shinobu1.gif" alt="HeartBlade" width="380">

# HeartBlade

> "I do as I please. Before, now, and always."

A Discord tweak. Nothing more, nothing less.  
Plugins and themes, installed from a link.

Named after Shinobu Oshino. Short temper, sharp blade.

</div>

## Features

- **Plugins** — extra client functionality
- **Themes** — visual overhauls for Discord

No store. Paste a URL, it installs.

## Built from scratch

Started from zero and written entirely by me. The only outside piece is Meta's JSI headers (MIT), fetched at build time.

## Installation

1. Get `HeartBlade.deb` from the [latest release](../../releases/latest).
2. Get your Discord `.ipa`.
3. Inject the `.deb` into the `.ipa` using your injector of choice.
4. Sign and install the patched IPA.
5. Open Discord.

Back up your IPA first. If you break it, that is your problem.

## Usage

Open Discord settings and tap **HeartBlade**.

- **Plugins** and **Themes**: add from a URL, toggle, tap for info and settings, swipe left to delete.
- **Developer**: update the client, load a bundle from your own server, view logs, copy a debug report.

Restart Discord after changing anything.

<details>
<summary>Writing a plugin</summary>

A plugin link can be a folder with `manifest.json` + `index.js`, a `manifest.json` link, or a single `.js` file. `index.js` receives `hb` and returns `{ onLoad, onUnload }`:

```js
return {
  onLoad() { hb.logger.log("hello"); },
  onUnload() {},
};
```

`hb` gives you `patcher`, `metro`, `storage`, `logger`, `React`, `ReactNative`, `flux` and `ui.alert`. See `examples/hello-plugin`.

</details>

<details>
<summary>Writing a theme</summary>

A `.json` file using Discord's colour token names. See `examples/theme-crimson.json`.

```json
{
  "name": "Crimson",
  "semanticColors": {
    "BACKGROUND_PRIMARY": { "dark": "#12070a", "light": "#fff5f6" }
  }
}
```

</details>

## Notes

- Needs a Discord build on React Native's new architecture.
- Plugins run with full access to your account. Install only what you trust.
- Personal project. Updates are not guaranteed.
- No official Discord affiliation.
- Do not pester me. Read the steps. Inject the deb. Move on.

## Credits

- Shinobu Oshino for the name and the attitude.
- You, for using it. Khaha.

<div align="right">

**— Oshino Shinobu**  
*Kissshot Acerolaorion Heartunderblade*

</div>

<sub>MIT © wvm</sub>
