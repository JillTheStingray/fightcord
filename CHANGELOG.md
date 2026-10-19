# Changelog

## 2.16.0

- **Profiles other Fightcord players can see.** Click your avatar → **Edit profile**: a status line, an
  About me and a banner game. Your **badges** come from your own history (100/500/1,000 sets, 5/10/20 wins
  in a row, a top 100 or top 10 spot). Fightcord players see them on your hover and scout cards, and you
  see theirs. Settings → Voice chat has **Share my profile**, **Show my badges** and **Show other players’
  profiles**; any scout card's ⋯ has **Hide their profile**.
- **Member list:**
  - **Search** at the top: type a name, Esc clears it.
  - **Fold a group** by clicking its heading (Rank B — 11); remembered.
  - **A ⚔ on the player you point at** challenges them (Fightcade asks the FT); **Shift+click** sends the
    FT you played them at last.
  - **From your lobbies:** members of your private lobbies who are in the channel get their own group.
- **Settings:**
  - **Changed settings** (under App): every setting you changed from the defaults, each with its own Reset.
  - **New** badges on settings that arrive in an update, until you've seen them.
  - **Share your setup** (Backup & restore): a code with your look and layout for a friend to paste. Never
    your notes, friends, history, lobbies or account.
- Fixed: the VS screen sometimes showed up after the match had started (accepting from the challenge card,
  or the other player accepting yours). It now shows the moment the set is agreed.

## 2.15.0

- **Pictures, GIFs and clips in the chat** (Fightcord players see them).
  - **Sending:** paste a picture into the message box, drop one on the chat, or click the new **+**.
    You see it first; **Upload** sends it. It goes to catbox.moe (free, no account) and its link is the
    message, so Fightcord players see the picture and everyone else sees the link. Photos are redrawn
    first, which removes hidden details like location. Up to 200 MB, GIFs stay animated.
  - **Seeing:** pictures, GIFs and clips from trusted sites (catbox, imgur, KLIPY, Tenor, Giphy, Discord)
    show in the chat; a message that's only the link shows only the picture. KLIPY, Tenor and Giphy
    links play as small looping videos, like on Discord. Click one to see it full size. Settings → Chat can
    blur them until clicked.
  - **The GIF button** in the message box: search GIFs (KLIPY, the GIF service Discord uses, with Tenor
    as a fallback), or pick one of your favorites (hover a GIF or picture in the chat and click its ★
    to keep it). One click sends it.
- **The profile popout** (your avatar, bottom-left) is rebuilt on the same card parts as the scout card,
  with an Online / Away switch, and closes with Esc.
- **Quick settings**, in the profile popout and the ⋯ menu: the Looks, voice chat, streamer mode,
  music (with volume) and a new **Do not disturb** (only challenges and @mentions pop up).
- **Tonight** (your record in the header): a chart of the night, your best win and your toughest
  opponent.
- **One look for every pop-up:** Find a match, goals, Tonight, notes and the events list share the same
  title row with a close button, and the same footer.
- Fixed: with a chat font style on, links you sent turned into fancy letters and stopped working. Links
  now always go out exactly as typed.

## 2.14.0

- **Private lobbies, like a Discord server** (Fightcord players only). The **+** under your game
  channels creates a lobby or joins one with an invite code (FC-XXXXXX-XXXXXX-XXXXXX-XXXXXX).
  - **A chat that keeps its history:** you see what was said while you were away. @mentions,
    links, and a notification when someone mentions you (or for every message, or never).
  - **A member list:** who's online, away, in a match or in voice. Click someone to challenge
    them, open their scout card or mention them.
  - **Challenge from the lobby:** each lobby plays one game. Fightcord gets you both into that
    game's Fightcade channel and sends Fightcade's own challenge.
  - **A voice room** for up to 8 people, straight between players like voice chat, with the same
    mic settings and **Ctrl+Shift+M** to mute.
  - **Only people with the code (and Fightcord) can get in.** Everything is encrypted with a key that
    only exists in the invite code. The owner can remove someone (everyone else gets a new key, so
    they can't read anything new), make a new invite code, rename the lobby or change its game.

## 2.13.0

- **A calmer Fightcord.**
  - **The channel header is one row:** tonight's record with your goals, a **Find a match** button,
    then small icons for the Feed (with a dot for what's new), the Game hub and your Stats. A **⋯** menu
    holds Test Game, Training, Replays, Events, Profile and "Slim banner". The banner's second row of
    buttons is gone.
  - **The channel notice folds to one line** ("Channel info · Rules · 13 links · 4 events"); click it to
    open. Remembered per channel, and it can be switched off in Settings → Chat.
  - **Cards are simpler and match:** the scout card is one 2×2 grid (ELO, your odds, vs you, form), one
    warning line, recent sets folded away and one row of buttons. The hover card is smaller, with one
    line and one button row. The challenge card shows its warnings on one line.
  - **Fewer pop-ups:** at most 2 at once. "Friend is online", the matchup note during a match and the
    "Last session" summary are off by default; each can be switched back on in Settings.
- **New rank icons** for S, A, B, C, D, E and unknown, everywhere ranks show (the in-match bar too), with
  names in the icons' colours. Settings → Appearance → Rank icons switches back to Fightcade's own.
- **System logos** in Discover: the real logos of each system (Dreamcast, PlayStation, Super NES, …).
- Fightcade's "New messages" bar above the message box now matches the theme.
- Fixed: some spacing (the new-messages bar, the "F" marks) didn't apply in Fightcade's browser engine.

## 2.12.0

- **Voice chat with your opponent** (Fightcord players only, off until you turn it on in Settings →
  Voice chat). When a set starts and your opponent has voice on too, you're asked "Join / Not now"
  (or join straight away with friends or everyone, your choice), and once you both join you can talk
  for the set. It ends with the match.
  - Voice-activated, with a mic sensitivity slider that keeps stick clicks out, and **Ctrl+Shift+M**
    to mute / unmute that works even with the emulator in front.
  - Pick your microphone and speakers, test your mic, set the opponent's volume; the background music
    dips while someone talks. Right-click a player → "Never voice with" to never be asked.
  - Voice goes straight between the two PCs (like the match itself), encrypted. The "let's connect"
    handshake passes through free public relays, encrypted too. Nothing is stored or recorded.
- **See who has Fightcord.** An **F** next to a name in the member list, the hover and scout cards and
  incoming challenges means that player has Fightcord; a green F with a mic means voice chat is on,
  and challenges say "Voice chat available". Voice only starts with players who have it, so nobody
  waits for nothing. You're visible by default: Settings → Voice chat → "Show that I use Fightcord"
  turns it off (names travel hashed, but anyone listening who knows your name could tell).

## 2.11.0

- **Looks.** Settings → Appearance starts with a gallery of whole looks, each a click:
  - **Arcade CRT:** black glass, amber accent, a terminal font (Share Tech Mono), faint scanlines
    and a soft phosphor glow; the Bars visualizer and VT323 in the emulator.
  - **3rd Strike:** charcoal and fight-poster orange, Chakra Petch, the game's art drifting behind
    the chat, Teko in the emulator.
  - **Neon Tokyo:** midnight indigo, hot pink and cyan, Exo 2, neon waves, Orbitron in the emulator.
  - plus **Discord** and **FightCord Neon** as before.
  A Look sets the theme's colours, accent and font, and the animated background and emulator font to
  go with it (untick "Also set the background and emulator font" to keep yours). The fonts come free
  from Google Fonts and load only when picked; they're in the theme's Font list too. Theme codes and
  the welcome screen know the new looks.

## 2.10.0

- **Rankings, Replays, Events and Profile inside Fightcade.** The channel banner's buttons open one page
  with four tabs instead of fightcade.com:
  - **Rankings:** the game's leaderboard (100 at a time), you highlighted, search and "Jump to me";
    a row opens that player's profile, a name the scout card;
  - **Replays:** recent matches (All / Mine / Friends / Top 100) with **Watch**, which plays them in
    Fightcade;
  - **Events:** this game's tournaments first, with countdowns, the reminder bell and Info;
  - **Profile:** Fightcade's rank, matches and hours, your leaderboard spot, your record and
    characters, your ELO trend; for others Challenge / Head-to-head / Notes. Fightcade's own
    right-click **Profile** opens it too (in game channels).
  Each tab keeps a link to fightcade.com.
- **A new VS screen:** the game's art behind it, both halves in the players' rank colours, the
  character they played against you last time, and your record vs them and tonight. The result
  screen shows both characters ("Akuma vs Chun-Li").
- **Characters on Discord:** your status reads "You (B · Akuma) 3 - 1 Rival (D · Yang)", with the score
  straight from the emulator (instant). Settings → Discord status → **Show characters**.
- **Matchup notes:** Stats → Analytics → **Matchups** lists every character you've faced with your record;
  click one to write a note. When the emulator shows your opponent picked them, a card with your record
  and note waits in the lobby. The challenge card links to it.
- **Gentler on Fightcade's servers:** one request at a time (at most ~3 a second), Fightcade's own
  "retry after" respected, and what you click on waits out a slow-down instead of failing.

## 2.9.0

- **A calmer lobby.** The member list moves to the left of the chat (Settings → Member list → **Side**
  puts it back on the right), one line per player:
  - country, ping and Wi-Fi moved to the hover card (**Details under names** brings the second line back);
  - the filter chips are one **Filter** button (ranks, < 100 ms, My region) with a count, next to the sort;
  - Fightcade's **Playing** list folds away; click "Playing" to open it (remembered);
  - the leaderboard `#12` next to names is off by default (your ⚔ record with people stays).
- **Icon buttons in the channel banner:** Stats, Rankings, Replays, Events and Profile are small icons
  with their names in the tooltip.
- **Goals at a glance.** Tonight's record and your goals are one strip in the top bar: the record, your
  win streak (from 2 in a row), and a thin bar per goal that pulses when it moves and flashes green
  when it's done.
- The hover card opens on whichever side of the list has room.

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
  shortcodes, font styles, scout card, match screens and Discord status, in one installer.
- Challenge filters, the stats page (with Fightcade history import), friends, player notes & tags,
  the challenge card, channel banner, hover cards, profile popout, right-click menu, notification
  inbox, animated backgrounds, lobby music and the splash screen.
- The Fightcord settings screen (Ctrl+,) and in-app updates from GitHub Releases.
- 1.1.1: challenge hooks no longer stack up over time; the music volume no longer sticks at 0;
  the installer refuses to run while Fightcade is open.
