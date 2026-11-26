---
name: herdr-browser
description: Drive the browser that Herdr's Browser panel shows for your terminal. Use when you run agent-browser from inside a Herdr terminal and the human should see, or share, the page you work on.
---

# Drive the Browser panel's session

The Browser panel in Herdr.app shows one agent-browser session live: the
session of the terminal that has focus. When you run agent-browser on that
session, the human sees your page in the panel, and can act on it too.

Checked against agent-browser 0.44.0 and this repo's `mods/browser` code.
The `HC_TERMINAL_ID` values below were checked live in Herdr, on a local
terminal and on a remote one.

## The session name

The session for a terminal is `herdr-<terminal id>`. Herdr sets the terminal
id in `HC_TERMINAL_ID` in every terminal it runs. So a terminal with the id
`t1b` owns the session `herdr-t1b`.

- The id is the bare id, without a machine name. In the remote terminal
  `build_box/t6`, `HC_TERMINAL_ID` is `t6`, and the session is `herdr-t6`.
- The panel accepts only ids made of ASCII letters, digits, `-` and `_`. For
  any other id it shows "has no usable session name" and starts nothing.
  agent-browser itself also allows other Unicode letters and digits. The panel
  does not.
- If `HC_TERMINAL_ID` is empty, you are not in a Herdr terminal, and no panel
  shows your session. Run agent-browser without `--session` there. Do not
  run `--session "herdr-$HC_TERMINAL_ID"` there: it becomes `herdr-`, which
  agent-browser accepts as a new session that no panel shows. The form
  `"herdr-${HC_TERMINAL_ID:?}"` fails instead when the id is empty.

## Target the session

Put the flag on every command. This form works in every shell, including
agent tools that start a new shell for each command:

```sh
agent-browser --session "herdr-$HC_TERMINAL_ID" open http://localhost:8000
agent-browser --session "herdr-$HC_TERMINAL_ID" snapshot -i
agent-browser --session "herdr-$HC_TERMINAL_ID" click @e3
```

agent-browser also reads the session name from `AGENT_BROWSER_SESSION`. Use it
only where your shell keeps its environment between commands:

```sh
export AGENT_BROWSER_SESSION="herdr-$HC_TERMINAL_ID"
agent-browser get url
```

The `--session` flag wins over `AGENT_BROWSER_SESSION` when you give both.
Check which session a command will use with `agent-browser session`. List the
running sessions with `agent-browser session list`.

Do not add these, because the panel then cannot find your session:

- `--namespace` or `AGENT_BROWSER_NAMESPACE`. The panel ignores every session
  inside a namespace.
- `AGENT_BROWSER_SOCKET_DIR`. The panel reads that variable only from its own
  shell, not from yours, so a folder you set there is a folder it never scans.

Never run `agent-browser close --all`. It closes every session on the machine,
including the sessions of other terminals.

For the full command set, run `agent-browser skills get core`.

## Remote terminals

The session runs on the terminal's own machine. When you work in a terminal
on another machine, run agent-browser there, as you already do. The panel
reaches that machine and shows the session from it. agent-browser must be
installed on that machine. When it is missing, the panel offers to install it.

When the panel starts a session on a remote machine, it runs `open` in a
Herdr terminal there with `hc run --on <machine>`, because a daemon that
Herdr's `exec` starts there stops when the command returns. The panel
removes that terminal when `open` ends, and the session keeps running at 2x.

Each machine has its own sessions. The local terminal `t1` and the remote
terminal `build_box/t1` both use the name `herdr-t1`, and the two sessions
do not meet.

## How the panel works with you

The panel acts only for the terminal that has focus, and only while the panel
is shown, with one exception: it ends the session of a terminal that no longer
exists. Your session is not touched while the human looks at another
terminal.

### It ends the session when the panel hides

When the human hides the panel, with the Browser button, the close button in
the panel's header, or by switching to Files or Changes, the panel closes the
session of the terminal it shows, on that terminal's machine. Other
terminals' sessions keep running. The panel keeps the address the page was
at, whole, for that Herdr space. When the panel shows again, it starts a
fresh session there.

So a session can end while you work, with no command from you. Before you
run another command with `--session`, check that the panel is shown for your
terminal, or ask the human. Any agent-browser command other than `close`
starts a new session, and a session the panel did not start is 1x.

### It ends the session when the terminal closes

When your terminal closes, or the workspace it is in closes, the panel closes
`herdr-<id>` for that terminal on its machine, shown or hidden. When the panel
starts, it also closes each `herdr-<id>` session whose terminal no longer
exists. It closes nothing on a machine it cannot see in full, such as a
disconnected one.

Herdr keeps a closed terminal in `hc ls --all` as `finished`, and the panel
counts a finished terminal as gone. It closes the session only after the
terminal is missing or finished on two looks in a row, 4 seconds apart.

Use only your own terminal's `herdr-<id>`. A `herdr-<id>` session whose
terminal does not exist is closed. The panel never touches a session with any
other name, or a namespaced one, so close those yourself.

### It starts the session

When the panel is shown and your terminal has no session, the panel starts
one. It opens the first of these that it finds:

1. The address the page was at when the panel last hid in your terminal's
   Herdr space.
2. A server that listens from your terminal's folder.
3. The last address the panel saw in that folder.
4. The folder's Herd site.
5. `APP_URL` from the nearest `.env` in the folder or a folder above it,
   below your home folder.
6. `about:blank`.

So your session can already exist, open on the project, before you run your
first command. Start with `get url` or `snapshot` to see where it is, or
navigate with `open`.

The panel starts the session at a 2x device scale, so the page is sharp on
a Retina screen and reports `devicePixelRatio` 2.

### It connects to a session you start

You can start the session yourself with `open`. The panel then connects to
it, and does not navigate it. A session you start this way is 1x: the panel
shows it correctly, but soft. To start it at 2x, as the panel does, give the
launch argument and both stream caps:

```sh
AGENT_BROWSER_STREAM_MAX_WIDTH=8192 AGENT_BROWSER_STREAM_MAX_HEIGHT=8192 \
  agent-browser --session "herdr-$HC_TERMINAL_ID" \
  --args --force-device-scale-factor=2 open http://localhost:8000
```

The caps count only when the session starts. Once a session runs, it keeps
its scale until it closes.

### It restarts a closed session

If the session closes while the panel is shown for your terminal, the panel
starts it again within seconds, at the address from the list above. If it
closes while the panel is hidden, or the hide closed it, the panel starts it
when it is next shown for your terminal. This includes a session you close
with `close`. There are three exceptions:

- A start that failed. The panel shows the error and a "Start browser" button,
  and waits for the human.
- A session that the panel started by itself and that ended less than 30
  seconds later. The panel shows the "Start browser" button.
- A session the hide could not close. The panel shows the close's error and
  the "Start browser" button, and waits for the human.

To end your browser work, leave the session open. Closing it while the panel
is shown only makes the panel open it again.

agent-browser itself shuts a session down after one hour with no activity, by
default (`AGENT_BROWSER_IDLE_TIMEOUT_MS`).

### It sets the viewport

The panel sets the session's viewport to the panel's size each time the panel
shows the session, is resized, or reconnects its stream. That replaces any
viewport you set with `set viewport`. Your viewport holds only until the next
of those events. Do not depend on a fixed viewport size while the panel is
shown. Read the size you have with `eval "innerWidth + 'x' + innerHeight"`
when it matters.

When you set a viewport, give the scale 2:

```sh
agent-browser --session "herdr-$HC_TERMINAL_ID" set viewport 1280 800 2
```

A bare `set viewport 1280 800` sets the scale to 1. The panel still gets 2x
frames, but the page then reports `devicePixelRatio` 1 and loads
low-resolution images, until the panel next sets the viewport. Check the
scale with `eval "devicePixelRatio"`.

### The human shares the page

The panel sends the human's input to the same page you drive:

- A click in the panel's picture sends the click to the page.
- The scroll wheel over the picture scrolls the page.
- After the human clicks in the picture, and while the stream is live, the
  panel sends the keyboard to the page. The panel then shows "Keys go to the
  page". A click outside the picture gives the keys back to Herdr.
- The panel's toolbar has Back, Forward, Reload and an address field.

Nothing stops you and the human from acting at the same time. The page can
change between two of your commands. Take a new `snapshot` before you use
element refs again, and check `get url` when the page looks wrong.

The human may type passwords and other secrets into the shared page. Never
copy what the human types into logs, commits or messages.

## Snippet for a project's agent instructions

Paste this into a project's `AGENTS.md` or `CLAUDE.md`:

```markdown
## Browser

This project runs in Herdr. Its Browser panel shows the agent-browser session
named `herdr-$HC_TERMINAL_ID`. Use that session, so the human can see and
share the page:

    agent-browser --session "herdr-${HC_TERMINAL_ID:?not in a Herdr terminal}" <command>

If `HC_TERMINAL_ID` is empty, you are not in Herdr. Run agent-browser without
`--session` there. Do not use `--namespace`, and never run `close --all`. The
panel may start the session before you do, restarts it if it closes, ends it
when the human hides the panel, and resets its viewport to the panel's size.
If you set a viewport, add the scale 2, as in `set viewport 1280 800 2`, so
the page keeps its 2x pixel ratio. The human can click and type in the same
page. Take a new snapshot before you reuse element refs. Never copy what the
human types into logs, commits or messages.
```
