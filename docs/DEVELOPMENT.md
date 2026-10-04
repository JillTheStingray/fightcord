# Fightcade chat plugins

Fightcade inject plugins:

* **`fontstyle.js`** — chat font styles everyone can see, inline markup, macros, and an
  "un-style incoming" mode.
* **`scout.js`** — opponent card: rank, ELO, recent form and your head-to-head record.
* **`emoji.js`** — Discord-style `:sob:` → 😭 shortcodes with a suggestion popup and a picker.
* **`discord-theme.js`** — makes the lobby look like Discord (local only).
* **`translate.js`** — translates other players' chat into your language, Discord style.
* **`chat-extras.js`** — mention highlight, NEW line, hover actions, link previews, jump to present.
* **`member-list.js`** — Discord-style player list: rank groups, status lines, signal bars, filters, sort.
* **`match-screens.js`** — cinematic VS screen when a challenge is accepted, YOU WON! / YOU LOST! after.
* **`discover.js`** — the search tab as Discord's Discover page: sidebar, spotlight, instant search, game pages, live matches.
* **`snapshot.js`** — dev helper: saves the page layout/CSS/screenshot so the UI can be worked on offline.

All hang off Fightcade's own settings page and coexist with Cerberus.

## Install

These plugins ship as **Fightcord**: run `..\fightcord\dist\FightcordSetup.exe` (see
`..\fightcord\README.md`). It installs its own loader as `inject\inject.js` and the plugins into
`<Fightcade>\fc2-electron\resources\app\inject\fightcord\`, replacing Cerberus (backed up).
While developing, `install.bat` copies the current `.js` files into that folder; restart Fightcade after.
Settings are saved next to the plugins (`fontstyle-config.json`, `scout-config.json`, …).

Both option blocks are injected into **every** settings panel Fightcade renders, and the plugins
put up their own panel on the **login screen** (which has no settings of its own): a small
`Aa chat plugins` pill in the bottom-left corner opens it, so everything can be configured before
signing in. It disappears the moment you're logged in. All panels stay in sync — change something
in one and the others follow. Each injection logs a line to devtools (`settings block added to …`)
naming the panel it landed in.

---

## fontstyle.js

Your outgoing messages are rewritten with Unicode look-alike characters, so **everyone in the
channel sees the styling** — it travels as plain text and needs no mod on their end.

### Controls

| | |
| --- | --- |
| `Aa` button by the chat box | style picker with live previews; ★ marks favourites |
| `Ctrl+Shift+F` | cycle favourites |
| `Ctrl+Shift+X` | toggle styling off / back on |
| Settings → "Chat font style" | dropdown, decoration, and the two toggles |
| `/font`, `/font fraktur`, `/font off` | list / set / disable |
| `/mac F1 gg wp`, `/mac F1`, `/mac` | set / clear / list macros |
| `F1`–`F8` in the chat box | insert macro (`Ctrl+Fn` inserts **and** sends) |

`/font`, `/mac` and `/scout` lines are swallowed — they are never sent to the channel.

### Inline markup

Style one word instead of the whole line — works even with the global style set to Normal:

| Markup | Result |
| --- | --- |
| `*gg*` | 𝐠𝐠 bold |
| `_wp_` | 𝑤𝑝 italic |
| `~ez~` | e̶z̶ strikethrough |
| `` `cvs2` `` | 𝚌𝚟𝚜𝟸 monospace |
| `__ul__` | u̲l̲ underline |

Markers only fire at word boundaries, so `snake_case_name`, `2*3 = 6` and URLs are left alone,
and `\*literal\*` escapes a marker.

### Styles (31)

| Group | Styles |
| --- | --- |
| Serif | bold, italic, bolditalic |
| Sans-serif | sans, sansbold, sansitalic, sansbolditalic, mono |
| Decorative | script, boldscript, fraktur, boldfraktur, doublestruck, fullwidth, smallcaps, superscript, subscript |
| Boxed | circled, negcircled, squared, negsquared, parenthesized, regional |
| Effects | strike, underline, slashed, spaced, upsidedown, mirrored, zalgo |
| Text tricks | faux (Cyrillic), leet, alternating, upper, lower |

Plus a **decoration** preset that wraps the finished message (`✧ text ✧`, `【text】`, …).

### Readable chat

Off by default. Turns *other people's* fancy Unicode back into plain ASCII in the chat pane —
hover a message to see what they actually sent. Zalgo and combining-mark overlays are stripped too.
Reversal is deliberately limited to glyphs no language writes with, so real Cyrillic, upside-down
text and leetspeak are left as-is rather than being mangled.

### Adding your own style

Each entry in `STYLES` uses one of four map kinds:

* `ranged(A, a, 0, holes)` — a contiguous Unicode block; `holes` covers letters that live outside
  it (the math blocks have reserved slots).
* `table({...})` — explicit per-character substitution.
* `overlay('̶')` — a combining mark appended to every character.
* `fn(text => ...)` — any whole-string transform.

`group` slots it into the dropdown; a new group name creates a new optgroup. Add `revSafe: true`
if the style's glyphs are safe to reverse in Readable chat.

---

## scout.js

Opens a card for a player with everything that matters before the set:

* **header** — flag, name, and their rank in this channel as a colour-coded pill
  (S gold, A red, B purple, C blue, D green, E grey)
* **status line** — online / away / in a match dot, ping, and the current rom name
* **three stat tiles** — RANKED (rank pill, ELO, match count from `getuser`), FORM (W-L over the
  recent scored sets with a win-rate bar), VS YOU (your head-to-head, bar, and when you last played)
* **recent sets** — a fixed-column table: W/L mark, opponent (ellipsised), score, and age

Everything from FC's own state (flag, channel rank, ping, status) renders instantly; the API-backed
tiles fill in a moment later and degrade to a short "unavailable" note if Cloudflare pushes back.

### Triggers

* an incoming challenge (on by default)
* the 🔍 badge next to names in chat and the user list
* `/scout <name>` in chat — `/scout debug <name>` dumps the raw API JSON to devtools

### Behaviour

API calls are strictly on demand: cached for 5 minutes, no background polling, and an exponential
cool-off when Cloudflare or a 429 pushes back (the card then shows "unavailable" rather than
retrying). The challenge hook re-wraps itself whenever Fightcade swaps its callbacks object and
always chains to the previous handler, so Cerberus's auto-reject filters keep working.

---

## emoji.js

Type a shortcode the way you would on Discord and it turns into the real emoji **before it is
sent**, so everyone sees it, plugin or not.

| | |
| --- | --- |
| `:so` | suggestion popup — ↑/↓ to move, Tab/Enter to pick, Esc to close |
| `:sob:` | converted the moment you type the closing colon (and again on send, as a safety net) |
| 🙂 button by the chat box | searchable picker with Recent, Custom and category sections |
| `:flag_jp:` | any two-letter country code |
| `/emoji add salt 🧂` | your own shortcode (any text works, `/emoji add bruh 💀🤡`) |
| `/emoji del salt`, `/emoji find cry`, `/emoji on`/`off`, `/emoji` | manage / search / toggle / help |

About 450 names, using Discord/GitHub shortcodes plus some aliases (`:laugh:`, `:lol:`, `:dead:`,
`:think:`, …) and a small FGC set (`:gg:` 🤝, `:parry:` 🛡️, `:lag:` 🐌, `:salty:` 🧂, `:rip:` ⚰️).
The list stops at Unicode 12, so players on older Windows builds don't get empty boxes.

Left alone: `/` commands, URLs, times like `10:30:45`, codes glued onto a word (`a:sob:`), and
unknown names (`:notreal:` is sent as typed).

Works with `fontstyle.js`. `emoji.js` listens on `window` in the capture phase, so it always runs
before fontstyle's `document` listener, whatever order the plugins load in. Font styles skip
over emoji, so zalgo/strike marks don't pile onto them and upside-down doesn't split them.

---

## discord-theme.js

Restyles Fightcade after Discord's dark theme. Only you see it.

* **Rail:** your games as 48px icons (game artwork, or initials if it won't load), rounded-square +
  white pill for the active one, name tooltip on hover, green browse button.
* **Chat:** avatar + name + time headers, continuation lines with the time in the gutter on hover,
  mention pills, and the rules message as an embed card. Game artwork behind the chat is off by default.
* **Message box:** rounded, with the 🙂 / Aa buttons inside it.
* **Member list:** "LOOKING TO PLAY — 84" headings, 32px avatars with a status dot (green looking to
  play, yellow not available), flag/rank/ping on the right.
* **Settings:** Discord toggle switches, blurple buttons.

| | |
| --- | --- |
| `Ctrl+Shift+T` | on / off |
| `/theme on`, `/theme off`, `/theme art`, `/theme icons` | same from chat (never sent) |
| Settings → "Discord theme" | the same three toggles |

It works by overriding FC's own theme variables (`#app.theme-*`) and adding CSS under two classes on
`<html>`: `dc-theme` (colours/font) and `dc-layout` (sizes/positions). **Safe mode:** if an FC update
removes the elements the layout is written against (`.mainToolbar`, `.channelsList`, `.buttonBar`),
only the colours are applied, so the app stays usable.

If an update breaks something, take snapshots with `snapshot.js` (below) and rebuild against them.

## translate.js

Other players' messages get a translation underneath, like Discord's:

    pasni aku buat kat kau pulak ye
    文A I'll do it for you later.
       (translated from Malay – Dismiss)

| | |
| --- | --- |
| `/tr` | status + help (never sent) |
| `/tr on`, `/tr off` | toggle |
| `/tr es`, `/tr pt`, `/tr ja`, … | change the language you translate *into* (default English) |
| Settings → "Chat translator" | toggle + language dropdown |
| Dismiss | hides that one translation |

Uses Google Translate's free web endpoint (the one Google's own translate widgets call): no key,
no account. It's unofficial, so Google can rate-limit it; the plugin then pauses (30s, doubling)
instead of hammering it. Only incoming messages are sent, one at a time, and a lot never are:
your own messages, system notices, links/emoji-only lines, FGC slang (`gg`, `ft3`, `games`,
`run it back`…) and, when translating into English, lines made mostly of everyday English words.
Results are cached, and on joining a busy channel only the newest 25 lines are looked at.

## chat-extras.js

Discord touches for the chat. Each one has its own switch in Settings → "Chat extras". Only you see them.

* **Mention highlight** — messages that @ you (or say your name) get Discord's amber highlight across
  the whole message, name row included.
* **NEW line** — leave a channel or switch to the emulator, come back, and a red NEW divider marks
  where you left off. Sending a message clears it.
* **Hover actions** — hover a message for Reply (fills in `@name`), Copy text, Translate (forces a
  translation even for lines the auto-translator skipped) and Profile.
* **Link previews** — embed cards for YouTube, X posts, Twitch, Streamable, imgur and image links, and a
  "Watch replay" card for Fightcade replay links. **Only well-known sites are ever loaded**
  (YouTube, Twitch, X, imgur, Fightcade, Streamable, Reddit, Tenor, Giphy, Discord's CDN,
  SuperCombo, GitHub). Loading a preview means fetching the link from your connection, and a random
  link from a stranger is how IP grabbers get your IP. Discord avoids that by fetching on its own
  servers. Links to anything else just stay plain links.
* **Jump to present** — scroll up in a busy chat and Discord's blurple bar appears; click it to get
  back down.
* **Discord timestamps** — "10:16 PM" instead of "at 22:16" (12-hour by default; switch it off or to
  24-hour in settings).

### With the Discord theme on

* **Profile popout** — left-click an **avatar in chat** (or use Profile in the hover toolbar) for a
  Discord-style profile: banner, avatar with status, country, ping, rank/ELO, recent form, your
  head-to-head, recent sets, and a Mention button. Escape or a click outside closes it. Names and the
  member list keep Fightcade's own left-click menu (Challenge / Profile / Spectate / Ignore) — that
  menu opens on mouse-down with Challenge under the cursor, so a popout there would fight it.
* **Cleaner name line** — the thumbs-up, status dot and ping next to names are hidden, leaving
  name, flag, rank and time like Discord (`/theme names` or the settings checkbox to toggle).
* **Theme presets** — Dark (default), **AMOLED black**, or **Classic grey** (Discord's older look),
  plus an **accent colour** (6 swatches or any colour) used for buttons, mentions, chips, the active
  rail icon and the jump bar. Settings, or `/theme preset amoled`, `/theme accent pink`,
  `/theme accent #eb459e`.
* **Chat text size** — 18px by default with Discord's spacing (line height 1.375, a little padding per
  line), which matches a slightly zoomed Discord. Settings dropdown or `/theme size 16` (Discord's
  own default).

## member-list.js

The player list, redone like Discord's member list:

* **Rank groups** — "Looking to play" is split into Rank S — 2, Rank A — 7, … Unranked — 17, like
  Discord's role groups, with names in their rank colour (S gold, A red, B purple, C blue, D green,
  E grey). "Not available" stays one block, like Discord's Offline.
* **Status line** — under each name: flag, country, ping, and Wi-Fi/VPN when Cerberus knows it
  (or Fightcade's own "Playing …" line when there is one). The 🔍 scout badge shows on hover.
* **Signal bars** — green under 100 ms, yellow under 180, red above; hover for the exact number.
* **Filters** — chips above the list: rank letters (any combination), `< 100 ms`, and `My region`
  (same continent as you). They combine with Cerberus's player search; × clears them.
* **Sort** — Name (Fightcade's order), Ping (lowest first) or Top (Cerberus leaderboard #), inside
  each rank group.
* **Played before** — `⚔ 3–1` next to players you've recently played (green if you lead, red if
  behind). One request for *your* recent sets covers everyone, refreshed every 10 minutes, so it only
  knows your most recent sets.

Settings → "Member list" toggles each part. Rows are regrouped with CSS only and nothing reacts to
clicks on a player — left-click still opens Fightcade's Challenge / Profile / Spectate / Ignore menu.

## match-screens.js

* **VS screen** — when a challenge is accepted (you accept, they accept, or the match starts), a
  full-window cinematic: both players slide in on their banner colours with avatar, name, flag and
  rank, and a glowing **VS** slams down in the middle. About 3.5 s; click or Esc skips it.
* **Result screen** — when the set ends and Fightcade is back in front: **YOU WON!** (gold rays and a
  burst of confetti), **YOU LOST!** (red, heavy slam) or **DRAW**, with the score and opponent.
  The result comes from Fightcade's own end-of-match message when it says won/lost, otherwise from
  the set score on Fightcade's API (retried for ~20 s). If neither answers, no result screen is shown
  rather than a guess.
* **Sounds** — your own clips in `inject/plugins/match-screens/`: `vs`, `win`, `lose`, `draw`
  (`.wav`, `.mp3` or `.ogg`). To use 3rd Strike's announcer, listen through
  `Mama/cps3-audio-extract/out/samples/`, copy the ones you like there and rename them. Changes apply
  on the next screen. Volume slider in Settings → "Match screens".
* **Previews** — `/vs test`, `/vs win`, `/vs lose`, `/vs draw` in chat (never sent). `/vs` alone shows
  help and the sound folder.

Everything happens inside the Fightcade window; the emulator window is never touched.

### Session tracker and streaks

* Every set you play is saved to `inject/plugins/match-history.json` (last 1000). A set whose result
  couldn't be found still counts as played, just not toward W/L or streaks.
* **🏆 7–3** pill in the channel header (left of Test Game) = tonight's record. Click it for the
  session's sets (result, opponent, score, time) and the current streak; "Clear session" starts a
  new one without deleting the history. A session runs 5 AM → 5 AM, so a late night is one session.
* The result screen adds **🔥 3 WIN STREAK** (or "Streak of 3 ended") plus your all-time record
  against that opponent and tonight's record.
* The Discord presence plugin shows it too: `3rd Strike · 7–3 tonight` (turn off with
  `"showSession": false` in `discord-rpc-config.json`).

## discover.js

The search tab (game browser), laid out like Discord's Discover page.

* **Sidebar** — Home, Your games, Favourites, then every **genre** (the common ones first, the rest
  under "More genres") and every **system**. Clicking one uses Fightcade's own view switch (the same
  call its category cards make).
* **Spotlight** — the top 5 most played games as a cinematic carousel: crisp game art, a blurred
  glow of it behind, "741 playing · ⚔ 12 matches live · Ranked", and **Join / Open**, **Favourite**
  and **Details**. It moves on every 8 s (progress bar, dots, ‹ › arrows, thumbnails) and pauses
  while the mouse is on it.
* **Instant search** — typing in the home search box drops down matching games at once, from the
  full catalog Fightcade already loaded (no waiting). Shorthand works: `3s`, `kof98`, `kof02`,
  `sf2ce`, `st`, `vsav`, `motw`, `mvc2`, `jojo`… ↑ ↓ to pick, Enter opens the game page, or
  "See all results" (Enter with nothing picked) goes to the full results.
* **Game page** — click any game (card, spotlight, search result, Your games tile) and a panel slides
  in: art, tags, players, Join / Open / Favourite, and
  * **Live now** — matches being played right now (in channels you've joined) with **👁 Watch**,
    which spectates exactly like Fightcade's own right-click → Spectate.
  * **You** — your record, when you last played, who you played most (session tracker history).
  * **Top players** and **Recent matches** (with Replay links) from Fightcade's API.
  Esc or a click outside closes it.
* **Live now row** — on the home page: every match in your channels as a VS card (avatars, flags,
  ranks, a live timer) with Watch.
* **Rows** — Your games, Live now, Popular, categories, hidden gems and events scroll sideways
  (‹ › arrows on hover, "See all" on Popular). Events count down live ("Starts in 2h 14m", seconds in
  the last hour) and pulse **● LIVE** once they start.
* **Cards** — art, name, system, a live `● 543` player pill. They tilt toward the mouse with a light
  glare, and the page glows softly in the colours of the game you're pointing at.
* **Results page** — endless scrolling instead of Previous/Next, **Most players / A–Z** sorting, and
  chips **● Has players** and **🏆 Ranked only**. Same cards, Join / Fav / Open on hover.
* Settings → "Discover": the layout, Your games row, Live now row, 3D tilt & glow, and animations
  can each be switched off. Follows the Discord theme's preset and accent colour.
* `discover-debug.json` (next to the plugin) records the field names of Fightcade's API answers the
  first time the game page loads them, for troubleshooting. It contains no personal data beyond
  public player names.

## challenge-filters.js

Rules for incoming challenges, each **Off / Warn / Decline**: ping over N ms, Wi-Fi, VPN, country
(an allow list of ISO codes, or empty = your continent), FT length, rank below a letter, players
you haven't played, and a block list.

* **Decline** — turned down the moment it arrives with Fightcade's own "reject": no chat row, no
  sound, just a toast ("🚫 Declined KenjiRival — Wi-Fi · 190 ms"). They can challenge again.
* **Warn** — let through, with a "⚠ Wi-Fi · 190 ms" tag on the challenge in chat.
* Hooks `root.connectionCallbacks.onChallengeRequest` (what Fightcade's socket calls) and keeps
  itself the outermost wrapper. If declining ever fails, the challenge is let through.
* Settings → Scout & challenges; `/filters` in chat shows the rules and this session's log.

## stats.js

**Your stats** (Discover sidebar, the 🏆 pill → "All stats", or `/stats`): record, win rate, games
won–lost, streaks, per game, win rate over time (chart), rivals, best / toughest matchups (3+
sets) and the last 14 sessions — for 7 days, 30 days or all time, per game or all.
**Import my Fightcade history** reads your recent sets from Fightcade's public match list and merges
them into `match-history.json` by match id (sets that ended before a game was played are skipped).

**Recent sets** lists your last 25 sets with a **▶ Replay** button (opens Fightcade's replay). A replay
needs the game's emulator: new sets store it (`emu`), older ones borrow it from a joined channel. When
it's unknown there's no button, never a guessed link. **☆** keeps a set in **Highlights**.
**Share**: click a day in "Last sessions" (or "Share" in the 🏆 popover) for a 1200×630 session card
(record, win rate, best streak, the sets, game art). **Copy image** pastes straight into Discord, and
**Save PNG** writes to `Pictures\Fightcord\`.

## friends.js

Fightcade has no friends list, so this plugin keeps one in `friends-config.json`. Add friends with
**☆ Add friend** on a scout card or the box on the **Friends** page (Discover sidebar, or `/friends`).
- Friends in channels you've joined show live: online and in which game, or in a match with **Watch**.
  Others show their latest match, looked up when the page opens (1.5 s apart, cached 10 min).
- A toast plus a chime when a friend comes online or starts a match. At most one per friend every
  10 minutes, and nothing for friends who are already there when Fightcade starts.
- A gold ★ after friends' names in the member list.
- Settings: Fightcord settings → Member list & friends.

## notes.js

Private notes and coloured tags on any player, stored in `notes-config.json` and never shared.
The default tags are Good sparring, Friendly, Rival, Laggy, Mashes and Avoid; you can rename,
recolour and add your own in settings. They're shown on the scout card, as dots in the member list,
and on the challenge card, the hover card and the head-to-head page. Edit them with ✎ Notes on any
of those, or `/note name`.

## challenge-card.js

A Discord "incoming call" style card for every challenge. It shows:
- both avatars
- their flag, rank and ping
- ELO and your win odds (from scout)
- your record against them, and your notes
- any challenge-filter warnings

Accept and Decline call Fightcade's own `root.acceptChallenge` and `root.declineChallenge`. The card
closes by itself when Fightcade clears the challenge (`removeChallengeNotifications`: accepted,
declined or cancelled anywhere). Fightcade has no challenge timeout, so there's no countdown. With
`challenge-filters.js` loaded, the card only shows challenges the filters let through (via the
`fc-challenge` event). Scout's own challenge popup is skipped while the card is on.

## channel-banner.js

A banner at the top of each game channel with:
- the game's art
- players online and live matches (from `globalUsers`)
- your rank and record in that game
- friends who are there
- Stats (filtered to this game), Rankings and Replays buttons

The chevron shrinks it to a one-line bar, and that choice is remembered.

## hover-cards.js

Rest the mouse on a member-list row (350 ms by default) for a profile popout. It shows their status,
rank and ping, "In a match vs X" with Watch, your record against them and your notes, plus
Challenge, Friend, Notes, Head-to-head and Scout buttons. It never clicks Fightcade's rows.

## Also in this round

- **Rematch / Challenge:** `match-screens.js` `challenge(name, ft, channel)` calls Fightcade's
  `channel.challengeUser(user, ft)`. A number challenges straight away; no FT lets Fightcade ask for
  one. The result screen gets ⚔ Rematch (with the same FT when it's known), and the scout card, hover
  card and head-to-head page get ⚔ Challenge.
- **Head-to-head (`stats.js`):** click any opponent for a page of every set against them, with
  tiles, a chart and replays. Other plugins open it with `open({ opp })`.
- **Chat polish (`chat-extras.js`), each with its own toggle:**
  - new messages slide in
  - names coloured by channel rank
  - challenge and match-result messages as compact pills and cards
  - time dividers after a 20+ minute gap (Fightcade's chat only has times, not dates)
- **Theme editor (`discord-theme.js`):**
  - a Custom preset built from 4 colours
  - a font choice
  - a chat background picture (≤3 MB) with a dimmer
  - `FCTHEME:` export/import codes
  - a new FightCord Neon preset

## Round 4: UI

- **Splash screen** (in `fightcord\loader\inject.js`, art in `splash-art.js`). From page load until
  Fightcade has logged in, it shows the mascot logo, neon glows and a loading bar. It follows the root's
  `autoLoginning` and `initializingApp`, gives up after 30 s, and goes away on click. You can switch
  it off in My Fightcord (`fightcord.json` `splash: false`).
- **`profile-card.js`**: clicking your avatar opens a Discord-style card instead of Fightcade's small
  menu:
  - tonight, all time, best streak, main game and friends online
  - Online / Away and Log out, which click Fightcade's own buttons
  - Stats / Friends / Settings
- **`context-menu.js`**: the player right-click menu gets the Discord look, plus Add friend, Notes &
  tags, Head-to-head, Scout and Copy name. It watches `root.contextMenuData` (a sync `$watch`), adds
  items, and wraps the callback so `fc:` ids are ours.
- **`inbox.js`**: the bell panel becomes an inbox:
  - tabs All / Mentions / Challenges / Friends, with counts
  - unread dots and Clear all
  - a Friends feed from `friends.alerts()`
- **`backgrounds.js`**: Neon particles, Gradient waves or Game-art drift behind the chat (Appearance).
  It pauses while Fightcade isn't the window in front, and a theme-editor background picture takes
  priority.

## fightcord.js

The Fightcord settings screen and updater — see `..\fightcord\README.md`.

## Ping, ELO and odds (member-list.js / scout.js)

* Member rows: `42 ms` (green / yellow / red), 📶 Wi-Fi / 🛡 VPN from Fightcade's own user data,
  and **#12** when the player is in the game's top 500 (scout.js `leaderboard(rom)`, 10 min cache).
* Scout card: ELO — the real one if Fightcade's API gives it, otherwise **"~1,850 est."** from the
  rank letter's band (E 400–700 … S 1900–2300) placed by leaderboard position — plus **Your odds**:
  per game (ELO expected score) and for the whole FT (first-to-n from that), and your head-to-head.
* Incoming challenges get a "71% · FT5" pill in chat.

## snapshot.js

`Ctrl+Shift+S` (or `/snap` in chat) writes `inject/plugins/fc-snapshots/<time>-<view>/` with
`dom.html`, `styles.css`, `vars.json` and `screenshot.png`. FC's devtools are disabled and
web.fightcade.com only serves the app to the client, so this is the only way to see the real markup.
Password fields are blanked and name-keyed data is reduced to counts, but the files do contain the
chat, player names and your account email from the settings panel. They never leave your PC.

Copy a folder into `dev-harness/snapshots/` and open
`http://localhost:8765/dev-harness/snapshot.html?s=<folder>` to replay it with FC's real CSS and
all the plugins on top (`&theme=0` for the plain version). FC's own images and fonts are refused
outside the client, so flags/ranks/game art show as broken there; that's expected.

---

## dev-harness

`dev-harness/index.html` is a fake Fightcade DOM (chat pane, chat input, settings options, a stub
Vue root and a stub FC API) that loads the real plugin files from the parent directory. Useful for
testing UI changes without restarting Fightcade:

```bash
python -m http.server 8765 --directory fightcade-fontstyle
```

then open `http://localhost:8765/dev-harness/index.html`.

Also in `dev-harness/`:

* `snapshot.html?s=<snapshot>`: replays a real Fightcade screen captured with snapshot.js, with
  every plugin loaded through the core, like the real loader does.
* `sim.js` (`window.__sim` on those pages): simulates incoming challenges, matches starting and
  ending, players joining and leaving, and chat lines.
* `styleguide.html`: every design-system component, in every theme (`?theme=neon&accent=%23eb459e`).
* `smoke.js`: `node dev-harness/smoke.js` loads every snapshot and the style guide in headless
  Edge or Chrome, and fails on any script error, `console.error` or module that didn't start.

Unit tests for the core: `node --test tests/core.test.js` (also run by `build.ps1`).

## Progress, goals and analytics (2.0)

* **progress.js**: once a day for each game you've played lately, and a minute after each set,
  stores your rank, ELO (Fightcade's own, or an estimate from your rank and leaderboard spot,
  marked `~`), match count and leaderboard spot in `rank-history.json` (one point per game per
  day). It adds a **Progress** tab to Stats (ELO line, rank timeline, leaderboard spot, best
  ever) and shows a full-screen **RANK UP!** when your rank goes up.
* **goals.js**: training goals per day, session or week:
  * win N sets, or play N sets
  * beat N players ranked X or higher
  * play N minutes
  * keep a win rate over N sets
  * win N in a row

  A ring next to the 🏆 session pill (with a popover) and the profile popout show your
  progress, and a toast fires when a goal is done. The first time you play after a session,
  you get a summary of it with its share card. Set goals under Settings → Goals.
* **analytics.js**: an **Analytics** tab on Stats. It shows your win rate by opponent rank,
  rank gap, ping, set length, game and position in the session, plus a weekday × hour
  heatmap. It also has a tilt check (how you do after two losses in a row) and plain-language
  insights. An optional "take a break?" nudge comes after three losses in a row.
  * Sets recorded from 2.0 on carry the opponent's and your rank, their ping and an ELO
    estimate.
  * Older and imported sets count only where they have the data.

The pure logic (`analyze`, `evaluate`, `periodStart`, `mergePoint`, `summarize`) is covered by
`tests/*.test.js`.

## Lobby feed and welcome (2.0)

- **feed.js**: the **Feed** pill in each channel header (or `/feed`) opens "What's happening" for that channel.
  - Built only from what Fightcade already shows. It diffs `globalUsers[x].channels` and `.playing` every 2 s.
  - Events:
    - joins and leaves, grouped every 30 s; leaves are hidden by default
    - matches starting, with Watch while they're live
    - top-100 players arriving (from the cached leaderboard)
    - friends' alerts (`friends:alert`)
  - **Results:** when a match with a friend, a rank gap of 2+ or a top-100 player ends, `searchquarks {quarkid}` is queued (20 s later, at most 30 an hour, 3 tries). That produces upsets (the lower rank won by 2+ letters), plain results, and win streaks of 3+ seen this session.
  - A channel you just joined gets 20 s of grace, so its whole user list doesn't show up as "joined".
  - Filters: everything / friends / big moments. The last 200 items are kept in `feed-history.json`.
  - Pure, tested: `groupLine`, `worthLookup`.
- **welcome.js**: the first-start screen, in 5 steps:
  1. Look: preset + accent, applied live through `discord-theme.setTheme`
  2. Profile: through `fightcord.applyProfile`, which takes effect on the next start
  3. Music: `music.tracks/addTrack/pick`
  4. Friends tips
  5. The spotlight tour (`/tour`): channels, channel tools, member list, chat commands, settings. A stop whose element isn't on screen is skipped.
  - "What's new": `NEWS` is keyed by major.minor ('1.9' = the 2.0 betas) and shown once per news entry (`welcome-config.json` `seen`).
  - People with match history or old configs skip the first-run screen and only get "What's new".
  - Replay from Settings → About.
  - Harness: `?welcome=1` shows the first run, `?welcome=news` shows "What's new".
- Core: `fc.ui.layer(close)` puts your own overlay on the shared Esc stack.
- Core: `fc.elo` captures exact ELO from Fightcade's playing events. It hooks `root.onUserPlayingStateChanges(user, isStart, channel, quark, gameid, playerid, port, ranked, elo, rank, scores)`; the elo is above 0 only for Fightcade Patreon supporters.
  - `value(name, rom)` gives the number, or null to fall back to the estimate. `mine(rom)` gives `{elo, at, start, end}`, persisted as `myElo` in fightcord-core-config.json.
  - The `elo:real` event feeds scout, Progress (real points) and match-screens (`eloStart`/`eloEnd` per set, the "ELO 1,654 (+12)" result line).
  - Harness: `__sim.elo(name, elo, start)`.

## fightcord-core.js

The shared core that every module runs on. The loader loads it first, then the modules, and
starts them in dependency order. A module is
`{ id, name, needs: [...], start(fc), stop() }`. Old plugins (`module.exports = fn`) still run
unchanged.

`fc` has:

* the Fightcade app helpers (`fc.app`)
* one timer (`fc.tick`) and one MutationObserver (`fc.watch`)
* settings files with debounced async saves and migrations (`fc.config`)
* settings blocks that are rendered once and then patched (`fc.settings`)
* `/commands` (`fc.cmd`)
* one Fightcade API client with a queue, cache and backoff (`fc.api`)
* the challenge pipeline (`fc.hooks.challenge`)
* the match history (`fc.history`)
* the design system (`fc.ui`, with `--fc-*` tokens and `fc-*` classes)
* sounds (`fc.sound`)
* `fc.fmt` and `fc.data`
* a log, and diagnostics through `fightcord.diag()`

A module that keeps throwing errors is switched off and cleaned up. Holding **Shift** while
Fightcade starts runs safe mode (the settings screen only).

## Notes

* Messages starting with `/` are never restyled, so Fightcade commands keep working.
* Most styled letters are surrogate pairs, so long messages hit Fightcade's length limit sooner;
  `zalgo` and the overlay styles are the worst offenders.
* `subscript` is not a full alphabet (Unicode only has ~17 subscript letters); unmapped characters
  pass through unchanged.
* **Player names are never styled** (the "Plain @mentions" toggle, on by default). A styled name is
  a different string, so the other client would never match it and the ping would never fire. Any
  word matching someone in the channel is left as plain ASCII — with or without `@`, whatever the
  case, and ignoring trailing punctuation (`RyuFan99!`). Names come from `FCADE.globalUsers` with
  the sidebar user list as a fallback, cached for 5s. Turn the toggle off to style everything.
* Chat search on other clients likewise matches the literal characters, so styled words are not
  findable by their plain spelling.
* Fightcade updates can wipe `inject/plugins/` — rerun `install.bat` if the plugins disappear.
