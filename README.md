# herdr-browser-panel

A Browser panel for [Herdr.app](https://herdr.dev). It shows the focused
terminal's [agent-browser](https://agent-browser.dev/)
session live, beside Files and Changes, so you see the page your agent works
on and can click and type in it too.

![Browser panel](preview.png)

## What it does

- Follows the focused terminal. Its session is `herdr-<terminal id>`, on that
  terminal's own machine: this computer, or a remote machine over an ssh
  tunnel.
- Starts the session when there is none, and opens the project's address:
  1. a server listening from the terminal's folder.
  2. the last address used in that folder.
  3. the folder's Herd site, https when Herd holds the certificate.
  4. `APP_URL` from the project's `.env`.
  5. `about:blank`.
- Restarts a session that closes, except after a failed start, or when a
  session it started by itself ended within 30 seconds. Then it shows a
  **Start browser** button.
- Offers an **Install agent-browser** button when agent-browser is missing.
- Has a Safari-style toolbar (Back, Forward, address field, Reload) and a
  header with the page title, the session and a machine chip.
- Fits the page to the panel's width. This overrides any viewport the agent
  set.
- Shares input. Clicks and scrolls go to the page. After a click in the live
  picture, keys go to the page too, and a bar says so. A click outside the
  picture gives the keys back.

## Install

The repo has two mods:

- `mods/browser`: the panel.
- `mods/tabs-browser`: a copy of Herdr's tab bar with a Browser button after
  Files and Changes.

To install, ask your agent to follow [RECIPE.md](RECIPE.md). In short:

1. Copy both folders into `~/.config/herdr-app/mods/`, without overwriting
   anything.
2. Run `herdr-app check` on each one.
3. Change your own layout with `tools/add-browser.js`, from the root of a
   clone of this repo. It needs Node.js, and was tested on Node.js 24.20.0.
   It prints the layout with the tab bar pointed at `tabs-browser` and a
   `browser` block added to `panel-body`. Use the blocks in RECIPE.md's
   install steps 5 and 6. They keep a backup, check the output, show the
   diff, and only then copy the new layout over the old one.

- Never redirect the output onto the layout file itself. The shell empties
  the file first.
- After the switch, each space's remembered panel resets once, because each
  mod keeps its own storage.

## What it runs, reads and connects to

- **Runs programs** on the terminal's machine: `agent-browser`, `sh` scripts
  for session discovery and address detection, and `ssh` tunnels for remote
  terminals. `brew` or `npm` installs run only when you click Install.
- **Reads** only the `APP_URL` line of a project's `.env`. To find the
  address it also reads Herd's config and site folder names,
  `public/hot`, agent-browser's session files, and which folder each
  listening server runs in.
- **Writes** live frames to `~/.config/herdr-app/mods/browser-frames/`. Each
  is deleted after use, leftovers are swept after 6 minutes, and a
  `CACHEDIR.TAG` marker stays there. ssh logs go to
  `~/.config/herdr-app/data/browser/` and are deleted after each tunnel
  starts or fails.
- **Connects** only to 127.0.0.1. For a remote terminal, `ssh` connects to
  that machine and forwards its 127.0.0.1. The browser itself loads any page
  it is sent to, and an install downloads agent-browser and Chrome for
  Testing.

## For agents

Agents drive the panel's session with `agent-browser --session
"herdr-$HC_TERMINAL_ID"`. See
[skills/herdr-browser/SKILL.md](skills/herdr-browser/SKILL.md) for the rules
and a snippet for a project's `AGENTS.md`.

## Limits

- Frames are 1x, so the page looks soft on a Retina screen. agent-browser's
  stream sends frames at the page's CSS size.
- Chrome will not make its window narrower than 500px. The panel handles this
  by sending the viewport again.
- Tested with Herdr 0.1.18 and agent-browser 0.44.0.
- Forward is never dimmed.
- The tab bar clone must be redone by hand after Herdr updates its tabs mod.
  `mods/tabs-browser/mod.json` records the version it was cloned from.

## Tests

The tests cover the pure modules, the view's logic and the layout tool. They
need Node.js, and stub Herdr's modules, so Herdr is not needed.
`test/layout.test.js` passed on Node.js 24.20.0.

```sh
npm test
```

Run one file with `node --test test/layout.test.js`.

## Credits

Parts of `mods/browser` (the session discovery, stream, frames, input and ssh
tunnel code) are adapted from the agent-browser mod in
[deevs-herdr-kit](https://github.com/DeevsDeevs/deevs-herdr-kit), under its
MIT license. `mods/browser/LICENSE-deevs-herdr-kit.txt` lists the files and
holds that license.
