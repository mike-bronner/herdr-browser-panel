# Browser panel

A Browser panel on the right of the Herdr window, beside Files and Changes. It
shows the agent-browser session of the terminal that has focus, live, and lets
the person click, scroll and type in the same page the agent drives. A Browser
button in the tab bar opens and closes it.

![Browser panel](preview.png)

## What you see

The panel is one block in the layout's `panel-body` stack, so it takes the
`panel` column's width and full height. Its frame has a 1px `border` line,
radius 10, on `background`. Text is 13px `foreground`. Top to bottom:

- **Header**, the same as a terminal pane's header: as high as the layout's
  pane header (`"pane": { "header": { "height": … } }`), or 30px when the
  layout sets none. 10px side padding, 8px gap, 12px text, 1px `border` line
  under it:
  - "Browser" in semibold.
  - While a page shows: a `/` in `dim` at 50% opacity, then the page title. The
    title is the active tab's title, or the page's host when the title is
    empty. It is cut with an ellipsis when it does not fit.
  - On the right, only while the session runs: the session name
    (`herdr-<terminal id>`) in `dim`, cut with an ellipsis past 160px, then a
    chip with the machine name, or "this computer". The chip is 18px high, 6px
    side padding, 11px `muted` text on `surface`, radius 5. Before the session
    runs, and while it closes, the header shows only "Browser".
  - At the right end, only while the pointer is over the header and the
    session runs: a close button, styled like a terminal pane header's
    buttons. It is the shipped `mods/pane/close.svg` at 14px in `dim`, with 3px
    padding, radius 4, and it turns `foreground` on a `hover` background. Its
    tooltip reads "Close the side panel". It shows only when the layout has a
    node with id `panel` that holds the Browser block.
- **Toolbar**, only while a page shows. A `chrome` band with a 1px `border`
  line under it. It holds a 42px row, 8px side padding, 8px gap, and under it
  the note line and the keys bar when they show:
  - Back and Forward: a pair of 30x30 buttons at the left, side by side with
    no gap, with 18px chevron icons in `muted`. They turn `foreground` on a
    `hover` background, radius 6. Each has a tooltip. Both stay enabled,
    because agent-browser does not report the page's history.
  - Address field: centered in the rest of the row, at least 80px and at most
    640px wide, 30px high, radius 8, on `surface`, 13px text. At rest it shows
    the host without `www.`, centered. An https page puts a 12px lock icon in
    `muted` before the host. With no address it shows "Go to…" in `dim`.
  - Reload: a 22x22 button with a 13px icon inside the field's right end,
    styled like Back.
- **Note line**, for 4 seconds after a command fails: 12px text in `blocked`,
  such as `back: not connected`. A failed close shows its error on this line
  too, and it stays.
- **Keys bar**, 24px high, while the page takes the keyboard: `solid`
  background, `solid_foreground` 12px text, radius 6. It reads "Keys go to the
  page" in semibold, then "Herdr shortcuts too. Click outside the picture to
  give them back."
- **Page**: the live picture, flush with the panel's sides and bottom, on
  `surface`. Its bottom corners follow the panel's radius. While the page takes
  the keyboard, a 2px `accent` line runs round it. The picture keeps the
  page's own proportions and is centered in this area. Over it, in 12px
  `dim`, it can say "Connecting…", "Waiting for the page to paint…", "Cannot
  reach the live view: <reason>" or "This session has no live view."

When no page shows, the toolbar and page give way to a body with 14px
padding and one of these:

- "Focus a terminal to see its browser."
- "Looking for herdr-t6 on this computer…", "Starting herdr-t6 on this
  computer…" or "Closing herdr-t6 on this computer…".
- "Cannot check <machine> for <session>." in `blocked`, with the error under it.
- "Terminal <id> has no usable session name." in `blocked`.
- "No browser for this terminal yet." with a **Start browser** button: 28px
  high, radius 6, `solid` with `solid_foreground` text. Any error shows under
  it in `blocked`.
- "agent-browser is not installed on <machine>." with an **Install
  agent-browser** button and a line that names the exact commands it runs.
  When no installer fits, or an install failed, it shows the command to run by
  hand in a `surface` box with a Copy button.
- While installing: a spinner, "Installing agent-browser on <machine> with
  Homebrew…" (or npm), "Step 1 of 2: brew install agent-browser", and a line
  that says it can take several minutes.

The tab bar is Herdr's own, with one more button after Files and Changes: a
globe icon (`browser.svg`, 14px) and "Browser", 26px high, 12px text, radius
6. It is on `selected` while the panel shows the browser, else on `chrome`.

## How it behaves

- **Follows focus.** The panel shows the session of the focused terminal. A
  terminal's session is `herdr-<terminal id>`, on that terminal's own
  machine. Ids with characters other than ASCII letters, digits, `-` and `_`
  get no session. A namespaced session never counts.
- **Works only while shown.** It looks for the session every 4 seconds, and
  only while the window is visible and the browser is the stack's shown
  child. Only the end of a closed terminal's session, below, also runs while
  the panel is hidden. Hiding the panel, hiding the window or focusing
  another terminal closes the stream and its tunnel.
- **Ends the session when the panel hides.** When the browser block stops
  showing, because the person clicked the Browser button or the header's close
  button, or switched the stack to Files or Changes, the panel ends the shown
  terminal's session: it stops the stream, then runs `agent-browser --session
  herdr-<id> close` on the terminal's machine. The panel's 4 second timer
  catches the hide, so it works even if the panel never draws again. It
  closes only a session its last look found. Other terminals' sessions keep
  running, and so does every session while only the window is hidden. A hide
  leaves no mark, so the next show starts a fresh session. A hide before a
  start's open stops the start, so nothing opens.
  A hide during a later step lets that step finish, skips `stream enable` if
  it has not run yet, and then runs one close. This holds up to the start's
  last scan, and also for a start that found the session already running. If
  the open failed, or a remote open hit its 60 s wait, the close runs only
  when the start's last scan still lists the session. The session gets one
  close, and the start stores nothing over it. A close the hide could not
  make shows its error on the next show, and nothing starts until the person
  clicks **Start browser**.
- **Ends a closed terminal's session.** A session never outlives its
  terminal. Every 4 seconds, shown or hidden, the panel lists every terminal
  with `hc ls --all --json`. Herdr keeps a closed terminal in that list with
  `state` `finished` until something runs `hc rm`, so the panel counts a
  terminal as gone when it is missing from the list or `finished`. Any other
  state counts as live. When a terminal is gone on two looks in a row,
  because it closed or its whole workspace closed, the panel looks for
  sessions on that terminal's machine. It then lists the terminals again, and
  closes each `herdr-<id>` session whose id is gone on that recheck and on
  both looks: it stops the stream if it shows that session, then runs
  `agent-browser --session herdr-<id> close` on that machine. A terminal that
  shows as `finished` on one look and live on the next keeps its session.
  The same sweep runs on each machine when the panel starts, and when a
  machine comes back, so it also ends sessions that a Herdr quit or crash
  left behind.
  - It closes nothing on a machine while its view of that machine is
    incomplete: the list failed or could not be read, the machine is not
    `connected` in the list, `machines()` does not show its layout as
    `ready`, a pane shows a terminal the list lacks or lists as `finished`,
    or its session files could not be read. A machine is swept only on its
    second complete look in a row. A sweep that could not finish, or a close
    that failed, runs again on the next tick.
  - It touches only `herdr-<id>` sessions that are not namespaced. A session
    with any other name keeps running.
  - It never runs another agent-browser command to check a session, since
    any command but `close` starts a new one. It reads only the session
    files.
  - A start still running for that terminal is told to end, as on a hide,
    and runs the one close itself. The panel does not start a session again
    for a terminal it ended this way, unless the id comes back.
  - Several panel copies can sweep at once. A second close of the same
    session does nothing.
- **Starts the session.** When the focused terminal has no session, the panel
  starts one with `env AGENT_BROWSER_STREAM_MAX_WIDTH=8192
  AGENT_BROWSER_STREAM_MAX_HEIGHT=8192 agent-browser --session herdr-<id>
  --args --force-device-scale-factor=2 open <address>`, then `stream enable`.
  On a remote machine, the same command runs in a Herdr terminal there:
  `hc run --json --on <machine> --no-parent --no-notify --timeout 60 --label
  browser=start -- env …`. Herdr's `exec` on another machine stops every
  process the command leaves running when it returns, so the session's
  daemon and Chrome would die with it. A daemon started in a Herdr terminal
  stays running after `open` returns. The panel waits for `open` to end, and
  reads its exit code and output from the `hc run` result. Then it removes
  the terminal with `hc rm`, and kills it first with `hc kill` when `open`
  did not end within 60 seconds. A failed remote start shows the last lines
  `open` printed, as a local one does. The terminal has no `herdr.space` or
  `herdr.tab` label, and Herdr shows only labeled terminals in its spaces.
  The launch argument makes Chrome render at 2x. The two caps let the
  session's daemon stream frames at that size: it reads them once, when it
  starts, and without them it cuts frames back to the page's CSS size. The
  address is the first of:
  1. the address the page was at when the panel last hid in the terminal's
     Herdr space, or in its folder when the space is not known. It is kept
     whole, query and fragment included, in the mod's local storage on this
     computer, and it survives a restart of Herdr.
  2. a server listening on 127.0.0.1, `::1` or all addresses, whose process runs
     inside the terminal's folder (the lowest port wins, and the Vite port in
     `public/hot` is skipped). Not used when the folder is the home folder
     or above it.
  3. the last address the panel saw in that folder, without its query or
     fragment.
  4. the folder's Herd site, https when Herd holds a certificate for it.
  5. `APP_URL` from the nearest `.env`, from the folder up to below the home
     folder, if it is http or https.
  6. `about:blank`.
- **Joins an existing session.** A session that already runs is connected to,
  never navigated.
- **Restarts a closed session**, at the address above, unless:
  - the last start failed: it shows the error and **Start browser**.
  - the panel started the session itself and it ended within 30 seconds: it
    shows **Start browser**.
- **Closes the panel.** The header's close button runs `layout.hide` with id
  `panel`, as the tab bar's Browser button does. In a layout with no `panel`
  node that holds the Browser block, the button does not show, and a click
  that arrives anyway does nothing. The hide then ends the session: the panel
  stops the stream, which also closes a remote session's ssh tunnel, and then
  runs `agent-browser --session herdr-<id> close` on the terminal's machine.
  That ends the session's daemon and its Chrome. The body says "Closing
  herdr-<id> on <machine>…" until the command returns. A failed close shows
  its error, and the terminal waits for **Start browser**. After
  the close the panel runs no other agent-browser command for that session,
  because any such command, `stream status` or `get url` too, starts a new
  daemon and browser. It only reads the session files again.
- **Sets the viewport.** It sends the page area's size with
  `deviceScaleFactor` 0, which follows Chrome's real scale, each time the
  page shows, the panel is resized (at most every 250 ms) and the stream
  reconnects. This replaces any viewport the agent set. A refused size is sent
  again after 1 s, doubling to 15 s. A scale of 1, or none, would keep 2x
  frames but make the page report a device pixel ratio of 1, so it would pick
  low-resolution images. So an agent that sets a viewport gives the scale 2,
  as in `set viewport 1280 800 2`. A bare `set viewport W H` sets the scale
  to 1 until the panel next sets the viewport.
- **Draws the frame at its own density.** A frame's size over the page's CSS
  size, from the frame metadata, is its scale: 2 for a session the panel
  started, 1 for others. The panel draws the page at its CSS size, so a 2x
  frame gives one frame pixel per Retina screen pixel. Clicks and scrolls map
  to CSS page points at either scale.
- **Shares input.**
  - A left or right click in the picture goes to the page. Dragging works.
  - The scroll wheel over the picture scrolls the page.
  - After a click in the picture, while the stream is live, every key goes to
    the page, Herdr shortcuts included, and the keys bar shows. Cmd-V or
    Ctrl-V types the clipboard text, up to 2000 characters. A click outside
    the picture gives the keys back.
- **Toolbar.** Back, Forward and Reload send those commands. A click on the
  address field shows the full address, selected. Enter goes to it, with
  `https://` added when there is no scheme. Escape cancels. The field follows
  the page's address while it is not being edited.
- **Install button.** Shown only when agent-browser is missing on that
  machine. It uses Homebrew if present, else npm with Node.js 22 or later:
  `brew install agent-browser` or `npm install -g agent-browser`, then
  `agent-browser install`. On Linux as root, or with passwordless sudo
  (checked with `sudo -n true`), the second step is
  `agent-browser install --with-deps`. Each step times out after 10 minutes.
- **Stream.** Up to 15 frames a second. A dropped stream retries after 1 s,
  doubling to 15 s.
- **Tab bar.** The Browser button shows whenever `panel-body` holds a block
  with the id `browser`. A click selects and shows it, and a second click
  hides the panel, as Files and Changes do. The panel picked for each space
  is remembered, Browser included. Tab statuses (a spinner for working, a 6px
  `blocked` or `done` dot) and every other control are as in Herdr's tabs mod.

## Built from

**Layout.** Two changes to the person's own layout:

- The tab bar block's `content.mod` changes from `tabs` to `tabs-browser`.
- `panel-body`, a `stack`, gets one more child:
  `{ "id": "browser", "type": "block", "content": { "mod": "browser" } }`.

`tools/add-browser.js <layout.json>` makes both changes and prints the
result. It never writes a file. It refuses a layout with no tabs block, with
no `panel-body` stack, or with an id `browser` that is not this block. Run on
a layout that has the change already, it prints the same layout.

**`mods/browser`**, `mod.json` `{ "place": "none", "title": "Browser" }`, no
props:

- `main.js`: the view.
- `panel.js`: focus to session name, panel states, restart rules.
- `address.js`: the address detection script and its parser.
- `discovery.js`: the session discovery script and its parser.
- `reap.js`: the terminal list, which machines the panel sees in full, and
  which sessions belong to no terminal.
- `install.js`: install plans.
- `page.js`: input messages, picture fit, viewport steps, the ssh tunnel
  arguments.
- `connect.js`: the direct connection, or the ssh tunnel through
  `hc run --bg`.
- `main.js` also starts a remote session through `hc run --on <machine>`.
- `stream.js`: the WebSocket stream, frame pacing, input queue, commands.
- `frames.js`: frames written as JPEG files and shown as images.
- Art: `back.svg`, `forward.svg`, `reload.svg`, `lock.svg`, and the shipped
  `mods/pane/close.svg`.
- `herdr` functions: `exec`, `hc`, `run`, `focused`, `spaces`, `panes`,
  `machines`, `theme`, `window`, `layout`, `settings`, `checking`, `appHome`,
  `readTextFile`, `watchFolder`. Also `net`, `fs/promises`, `websocket`,
  `fetch` and `localStorage` (`lastUrls`, at most 200 folders, and
  `hiddenUrls`, at most 200 spaces or folders).
- `hc` commands: `ls --all --json`, `machine ls --json`, `get <name> --json`,
  `run --bg --rm`, `kill <name>`.
- Commands: `layout.hide`.

**`mods/tabs-browser`**, `mod.json` with `cloned_from` `tabs` 0.1.18: a copy of
Herdr's shipped `tabs` mod with these changes only:

- `panels.js`: `panelIds(enabled, body)` adds `browser` when `panel-body`
  holds it.
- `main.js` imports it, passes its list to `syncPanel`, and adds the Browser
  button after Changes.
- Its window-button icons point at `mods/tabs-browser/`, which holds copies of
  `win-min.svg`, `win-max.svg`, `win-restore.svg` and `win-close.svg`, plus
  `browser.svg`.
- It still uses shipped art (`mods/files/file.svg`, `mods/changes/changes.svg`,
  `mods/pane/close.svg`, `mods/workspace-chrome/spinner.svg`) and the shipped
  `menu` and `new-menu` overlays.
- `herdr` functions: `spaces`, `panes`, `run`, `openOverlay`, `theme`,
  `window`, `shared`, `layout`, `settings`. Also `localStorage` (`panels`,
  the panel picked for each space).
- Commands: `tab.prev`, `tab.next`, `tab.select`, `tab.move`, `tab.rename`,
  `tab.close`, `layout.select`, `layout.show`, `layout.hide`,
  `window.minimize`, `window.maximize`, `window.close`.

**What the mods run, read, write and connect to.** Tell the person this
before you install:

- **Programs**, on the terminal's machine through `exec`:
  - `agent-browser` (`open`, `stream enable`, `close`, `install`). `close`
    runs only when the panel hides, its close button included, or a
    terminal is gone. `open` runs through `env`, to set the two stream caps.
    On a remote machine, `open` runs in a Herdr terminal through
    `hc run --on <machine>`, which the panel removes with `hc rm` once `open`
    ends.
  - `sh` scripts for session discovery and address detection. They use
    standard tools, such as `ss` or `lsof`, `grep`, `sed` and `node -v`.
  - `brew` or `npm`, and `sudo -n true` on Linux, only after the Install
    button is clicked.
  - `ssh` for a remote terminal, through `hc run`. It needs a plain ssh
    target and key login (`BatchMode=yes`).
- **Reads outside its folder**, on the terminal's machine:
  - only the `APP_URL` line of the nearest `.env`.
  - the first line of `public/hot` in the terminal's folder.
  - Herd's `config.json`, its certificate file names, and the folder names in
    Herd's site paths.
  - agent-browser's session files (`.pid`, `.stream`, `.engine`, `.target`)
    in its socket folders.
  - the working folder of each listening process.
- **Writes outside its folder:** frames to
  `~/.config/herdr-app/mods/browser-frames/` (each deleted after use, and
  leftovers swept after 6 minutes), plus a `CACHEDIR.TAG` marker there that
  stays, and ssh logs to `~/.config/herdr-app/data/browser/`
  (deleted after each tunnel starts or fails).
- **Network:** the mods connect only to 127.0.0.1: the stream's WebSocket, its
  HTTP command endpoint, and the local end of an ssh tunnel to the remote
  machine's 127.0.0.1. The `ssh` program connects to the remote machine's ssh
  target. The browser itself loads whatever page it is sent to, and an
  install downloads agent-browser and Chrome for Testing.

**Install into a setup.** The worked example is the author's own install:
both mods copied into `~/.config/herdr-app/mods/`, and the layout change
applied to `layouts/mine.json`. Run these from a clone of this repo.

1. Read this recipe and every file. Tell the person what the mods run, read,
   write and connect to, from the list above.
2. Check that neither name is taken. Both of these must say "No such file":

   ```sh
   ls -d ~/.config/herdr-app/mods/browser ~/.config/herdr-app/mods/tabs-browser
   ```

   If a name is taken, rename the new mod, as Watch out describes. Never copy
   over a mod that is there.
3. Copy the two mod folders, and check each one:

   ```sh
   cp -R mods/browser mods/tabs-browser ~/.config/herdr-app/mods/
   herdr-app check ~/.config/herdr-app/mods/browser
   herdr-app check ~/.config/herdr-app/mods/tabs-browser
   ```

4. Ask the person which of their own layouts gets the panel. The example uses
   `mine.json`.
5. Make the new layout beside the old one, and show the change. Run this
   block whole, from the root of the clone. It needs Node.js, and was tested
   on Node.js 24.20.0. It keeps a backup in `~/mine.json.before-browser` and
   writes the new layout to `~/mine.json.with-browser`. It stops, with the
   layout untouched, if either file already exists, or if `add-browser.js`
   fails or prints nothing:

   ```sh
   (
     set -e
     layout=~/.config/herdr-app/layouts/mine.json
     for f in ~/mine.json.before-browser ~/mine.json.with-browser; do
       [ ! -e "$f" ] || { echo "$f exists: move it away first"; exit 1; }
     done
     node tools/add-browser.js "$layout" > ~/mine.json.with-browser && [ -s ~/mine.json.with-browser ] || {
       rm -f ~/mine.json.with-browser
       echo "add-browser failed, layout untouched"
       exit 1
     }
     cp "$layout" ~/mine.json.before-browser
     diff "$layout" ~/mine.json.with-browser || [ $? -eq 1 ]
   )
   ```

   `diff` exits 1 when it finds a change, which is expected here. Exit 2
   means it could not compare, and the block fails. The tool writes JSON with
   2-space indents, so a file in another format also shows whitespace
   changes. Apart from those, the diff must show only the `tabs-browser` line
   and the new `browser` block. A layout that has the change already shows no
   difference.
6. When the diff is right, copy the new layout over the old one, and remove
   the new file. `cat` keeps the layout file's own mode:

   ```sh
   [ -s ~/mine.json.with-browser ] && cat ~/mine.json.with-browser > ~/.config/herdr-app/layouts/mine.json && rm ~/mine.json.with-browser
   ```

   Herdr applies a layout file when it is saved. To undo, copy
   `~/mine.json.before-browser` back the same way.

## Watch out

- **Never redirect `add-browser.js` onto the layout it reads.** The shell
  empties the file before Node reads it. Write to a separate file, check that
  it is not empty and that the diff is right, then copy it over the layout,
  as install steps 5 and 6 do. An empty output means the tool failed.
- The layout must be the person's own file. Herdr's own layouts are
  read-only and replaced on every start.
- After the switch to `tabs-browser`, each space's remembered panel resets
  once, because `localStorage` belongs to each mod.
- The names are fixed in code. `browser` is the mod folder, the block id, the
  `mods/browser/` icon paths and the `mods/browser-frames` folder.
  `tabs-browser` is in its own icon paths. Renaming either mod means changing
  these strings and the layout.
- The tabs clone does not follow Herdr's updates. After Herdr updates its
  `tabs` mod, copy the new `main.js`, apply the changes listed in Built from
  again, and update `cloned_from`.
- Only a session the panel starts is 2x. A session started another way, or
  one that ran before this version, streams 1x frames: the panel shows it
  correctly but soft. An emulated `deviceScaleFactor` alone never sharpens
  the stream.
- Chrome will not make its window narrower than 500px. Below that, a frame
  can show the whole window. The panel draws only the page part, and sends
  the same viewport again, at most 3 times, which makes Chrome correct it.
  This works the same for 2x and 1x frames.
- Forward is never dimmed, even with nowhere to go. Back is not dimmed either.
- The panel turns on streaming only for a session it opens itself. A session
  with no stream port shows "This session has no live view." Whether
  agent-browser streams a session it was not asked to is not verified here.
- A remote machine reached through another machine (`via`) cannot be shown.
- There is no `keys.json`.
- Tested with Herdr 0.1.18 and agent-browser 0.44.0. Other versions are not
  verified.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/browser` and
  `herdr-app check ~/.config/herdr-app/mods/tabs-browser` exit 0.
- The tab bar shows a Browser button after Changes, and a click opens the
  panel with "Browser" in its header.
- With a terminal focused in a project folder, the panel shows
  "Starting herdr-<id> on this computer…", then the live page: the project's
  address if one is found, else a blank page.
- `agent-browser --session "herdr-$HC_TERMINAL_ID" get url`, run in that
  terminal, prints the address the panel shows.
- On a Retina screen, the page of a session the panel started is sharp, and
  `agent-browser --session "herdr-$HC_TERMINAL_ID" eval "devicePixelRatio"`
  prints 2.
- A click in the picture shows the keys bar, and typed text reaches the page.
  A click outside gives the keys back.
- Focusing another terminal whose session runs shows that terminal's session
  name in the header. Before a session runs, the header shows only "Browser".
