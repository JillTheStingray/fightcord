# Changelog

## 2.8.0

- **A music visualizer.** Settings → Appearance → Animated background → **Music visualizer**. It moves with
  your background music, behind the chat, in your theme colours. Three looks:
  - **Bars:** frequency bars rising from above the message box, bass in the middle.
  - **Wave:** a glowing neon curve of the music.
  - **Pulse:** a ring that swells with the bass, with particles that rush on the beat.
  It finds the kick drum: the bars jump and the floor lights up, the wave swells, the ring sends out
  a shockwave. It evens out quiet and loud tracks and any music volume, rests when no music plays,
  and pauses in matches and when Fightcade isn't in front. The Music settings link to it.
- **Frame rate:** the visualizer runs at your screen's refresh rate (up to 144 Hz), or at 60 / 30 fps
  if you'd rather it used less of your computer.
- With an animated background on, hovering a chat message gives it a soft see-through tint instead of
  a dark box.
- With Animations off, the neon particles stand still too.

## 2.7.0

- **Your style in the emulator.** Settings → Appearance → Emulator overlay (off until you turn it on).
  The bar with the names and score at the top of your matches, and the spectators panel, are drawn in
  Fightcord's style, in your theme colour. Fightcade's rank badges and flags stay.
- **Pick the emulator's font.** Twelve fonts for the names, the score and the chat in your matches:
  your theme font, Fightcade's own, and pixel, arcade, terminal, esports and sci-fi fonts (Press Start 2P,
  Pixelify Sans, Silkscreen, VT323, Teko, Russo One, Chakra Petch, Orbitron, Audiowide, Exo 2). Each card
  shows a preview, and the big one shows exactly what the emulator will draw. The fonts come free from
  Google Fonts (open licence); Fightcord turns the one you pick into the emulator's bitmap font.
- How: Fightcade's emulator draws that bar from image and font files in `emulator\fbneo\ui`. Fightcord
  keeps Fightcade's originals and puts them back when you turn it off or uninstall. It never writes while
  a match is running, and the emulator itself isn't changed. Only you see it.

## 2.6.0

- **Live from the emulator.** Fightcade's emulator writes the running match to small files for stream
  overlays (`emulator\fbneo\fightcade`). Fightcord now reads them:
  - The **OBS overlay** score updates the moment a game ends (it used to be every 15 seconds), and
    shows both characters under the names.
  - **Characters in your stats.** Every set remembers which character you and your opponent played
    the most. They show in your sets list, as "your record against each of their characters" on a
    head-to-head, as By your character / By their character in Analytics, and on the challenge card
    ("3–2 · Chun-Li", what they played against you last time).
  - Sets whose result Fightcade didn't report get their score from those files too.
  Sets from before 2.6 have no characters. This works for FBNeo games (most of Fightcade).

## 2.5.0

- **A new login screen.** Fightcade's log-in screen gets an "attract mode" makeover. Game art slowly
  pans and cross-fades behind it (your own games first) under a neon tint, and the FightCord mascot
  floats above a sleek card. The card is Fightcade's own form, restyled, so logging in works exactly as
  before. If you've logged in before, it says **Welcome back** with your rank badge and last session.
  It remembers only that account's name and avatar, nothing else. Settings → Appearance → Login screen
  (Background art: your games / popular / off).
- **Discover, made for you.** New rows on the Discover home:
  - **Friends playing now**, with Watch.
  - **Rivals online:** people you've played in the last 30 days who are free now, with your record
    and a Challenge button.
  - **Events this week:** Fightcade's tournaments with Today / Tomorrow labels, countdowns and
    reminder bells. Your games come first.
  Each row has its own switch. Your games tiles now also show your rank badge, ELO and how far you are
  to the next rank.
- Goal pop-ups now wait until you've logged in.

## 2.4.0

- **Updates from inside Fightcade.** When you open Fightcade, Fightcord checks for a new version and
  installs it before it loads, so you're on the newest Fightcord in that same start. The splash shows
  "Updating Fightcord…". It gives up quietly when you're offline or the connection is slow.
- **No more installer for updates.** Updates now also carry the Discord-status library and remove
  modules Fightcord no longer has. After the first install, nobody needs to download anything from
  GitHub again.
- **Restart when it suits you.** If Fightcade stays open and an update arrives, a green button
  appears at the bottom of the left rail, and the pop-up has a **Restart now** button. It never
  restarts during a match.
- **What's new, in the app.** Settings → Updates shows these release notes, instead of pointing to
  the GitHub release page.
- Updating from 2.3.x: this one arrives the usual way (restart once); from then on updates install
  as Fightcade starts.

## 2.3.1

- **Fightcade's own rank badges.** Everywhere Fightcord shows a rank now uses Fightcade's badges
  (?, E, D, C, B, A, S) instead of coloured letters. That includes the scout and challenge cards,
  Find a match, the member list's group headers, the VS and rank-up screens, Discover, Stats and the
  OBS overlay. Name colours and charts now use the same colours as the badges.
- **Icons instead of emoji.** The trophy, swords, fire, eye, stars, warning, Wi-Fi / VPN and other
  emoji used as icons are now clean line icons that follow your theme colours. This covers the
  right-click menu and the emoji button by the chat box too. Emoji you type in chat are untouched.
- Discover's results title no longer shows a genre icon's name ("sword Fighter").

## 2.3.0

- **Find a match.** A new button in the channel header (or `/find`) lists who's free in the channel
  right now, near your rank and on a good ping. People new to you and close rivalries come first.
  Each row has your odds and a **Challenge** button, which uses Fightcade's own challenge, so it asks
  for the FT as usual. Anyone your challenge filters would decline is left out. Settings → Scout &
  challenges → Find a match (highest ping, rank range).
- **Streamer mode.** Ctrl+Shift+H (or `/streamer`) blurs other players' names, avatars and chat
  messages. Your own name and messages stay readable, and your e-mail is hidden. A red LIVE pill
  shows while it's on. Feed and friend pop-ups stay quiet. Fightcade's own text is never changed;
  it's all CSS.
- **Challenge queue.** In streamer mode, or with Settings → Scout & challenges → Challenge card →
  Queue challenges, incoming challenges show one card at a time in the order they came in, with
  "2 more waiting". Nothing pops up mid-match; the first one waiting appears when it ends. Fightcord
  still never accepts or declines anything by itself.
- **OBS overlay.** Settings → Streamer mode → OBS overlay starts a small scoreboard page at
  `http://127.0.0.1:7979/` to add in OBS as a Browser Source. It shows you vs your opponent, ranks,
  the score (updated every 15 s) and tonight's record. It only answers this PC.

## 2.2.0

- **Português (Brasil) e Español.** All of Fightcord (every screen, setting, toast and the welcome tour)
  plus the installer window now come in Brazilian Portuguese and Spanish. **Automatic** follows
  your Windows language; change it in Settings → My Fightcord → Language (applies after a restart).
- **The chat translator follows your language.** New installs translate other players' messages
  into the language Fightcord is in. If you already picked a target language, it's kept.
- Translations are new: if something reads wrong, please open an issue or a pull request
  (`src/i18n-pt.js`, `src/i18n-es.js`).

## 2.1.0

- **Unfinished sets.** The scout card counts how often a player left ranked sets before anyone
  reached the FT ("Left 3 of 12 ranked sets unfinished (2 while behind)"), and the challenge card
  warns when it's 1 in 5 or more, before you accept. It comes from the same recent sets the scout
  card already loads; it can also be disconnects. Settings → Scout & challenges → Unfinished sets.
- **Event reminders.** Fightcade's tournaments (on the home page and in game channels) now remind
  you 30 minutes before they start (15 / 30 / 60) and when they begin, with Open channel and Info.
  Automatic for games you've joined or played lately; ring the bell on any event card to add or
  remove one. `/events` lists what's coming. Settings → Search tab → Event reminders.

## 2.0.1

- **Exact ELO for Fightcade supporters.** Fightcade sends your real ELO to Patreon supporters
  ("Ranked Warrior" and up) when a ranked match starts and ends. Fightcord now uses it: the scout
  card shows the real number (no "~ est."), the Progress chart plots real points, and the result
  screen shows "ELO 1,654 (+12)". Everyone else still gets the estimate from rank + leaderboard spot.
- The harness has `__sim.elo()` and a demo mode for screenshots.

## 2.0.0

A rebuild of the whole thing, plus the biggest batch of new features so far.

**New**
- **Rank & ELO history:** Stats → Progress charts your rank, ELO and leaderboard spot per game
  over time, with a RANK UP screen when you climb.
- **Training goals:** wins, sets, beating higher ranks, minutes played, win rate, streaks; per
  day, session or week. Shown in a progress ring next to tonight's record, in your profile popout
  and in a session summary.
- **Match analytics:** Stats → Analytics breaks your results down by opponent rank, rank gap,
  ping, hour of day, weekday, set length and game, with a tilt check (and an optional "take a
  break?" nudge).
- **Lobby feed:** the Feed button in every channel: joins, matches you can watch, upsets, win
  streaks, top-100 players arriving, and your friends.
- **Welcome screen & tour** on first start, and "What's new" after an update.
- **Settings 2.0:** search across all settings, Lite / Full / Competitive profiles, per-section
  reset, backup & restore to a file, and a Diagnostics page with "Copy debug info".
- **Safe mode:** hold Shift while Fightcade starts to skip Fightcord.

**Better**
- One shared core instead of 24 separate plugins: one timer, one page watcher and one Fightcade
  API client with shared caching and back-off. Much lighter while you sit in the lobby, and
  nothing runs while Fightcade is minimised.
- One design system: the same buttons, cards, toasts and icons everywhere, matching your theme.
- A module that crashes is switched off on its own and tells you, instead of breaking the rest.
- Settings save in the background (no more stutter when changing the theme).
- Smaller installer: the Discord-status plugin no longer ships an unused native helper.

**Fixed**
- The chat box being pushed down as chat scrolled with a chat background on.
- Settings blocks being rebuilt several times per change.

## 1.x (private builds)

The versions before 2.0 were shared privately; they're folded together here.

- The Discord theme, Discover search tab, member list, chat extras, translator, `:emoji:`
  shortcodes, font styles, scout card, match screens and Discord status, in one installer that
  replaces Cerberus (and can put it back).
- Challenge filters, the stats page (with Fightcade history import), friends, player notes & tags,
  the challenge card, channel banner, hover cards, profile popout, right-click menu, notification
  inbox, animated backgrounds, lobby music and the splash screen.
- The Fightcord settings screen (Ctrl+,) and in-app updates from GitHub Releases.
- 1.1.1: challenge hooks no longer stack up over time; the music volume no longer sticks at 0;
  the installer refuses to run while Fightcade is open.
