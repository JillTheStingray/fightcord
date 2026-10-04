# Changelog

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
