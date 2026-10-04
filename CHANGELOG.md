# Changelog

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
