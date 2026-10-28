/**
 * Fightcord matchup guide (3.5)
 *
 * What each character is good and bad at, how to fight them, and who they struggle against, for
 * the games the emulator reports characters for: 3rd Strike, Vampire Savior, Alpha 3, Super Turbo
 * and Garou. Written for Fightcord from the SuperCombo wiki's character and matchup pages plus
 * common community knowledge (the wiki's own text isn't copied); each entry links to its page.
 *
 * The icons are the wiki's own pictures, loaded from wiki.supercombo.gg when shown (nothing of the
 * games' art ships with Fightcord). No picture (offline, a moved file): a coloured initial instead.
 *
 * Used by the VS screen (match-screens.js), the matchup notes pop-up (notes.js) and Analytics.
 *   find(rom, char)            -> the guide entry (any emulator spelling: "Remya", "Gouki (Akuma)")
 *   tips(rom, myChar, oppChar) -> short tips: your matchup's own first, then the general ones
 *   faceHtml(rom, char, size)  -> the icon
 *   cardHtml(rom, oppChar, myChar) -> the full guide block
 */
'use strict';

let fc = null;
const WIKI = 'https://wiki.supercombo.gg/';

/* ---------------------------------------------------------------------- data */
// per character: img (wiki file, after its md5 folder), art (a bigger picture, shown as the wiki's 160 px copy; fo = where its face is), a (other spellings), p (wiki page when not the name),
// s strengths, w weaknesses, t how to fight them, good (does well against), hard (struggles against)

const SF3 = {
    Akuma: { img: 'a0/3S_Akumaface_small.jpg', art: '0f/3S_Akuma_Art.png', fo: '45% 8%', a: ['Gouki', 'Shin Akuma'],
        s: ['Air fireball and Demon Flip give him a scary mix of zoning and mixups', 'Huge damage, and three strong supers (Raging Demon among them)'],
        w: ['The lowest health and stun in the game', 'No EX moves, so his meter only goes into supers'],
        t: ['Every clean hit counts: he has the lowest health and stun, so play for the stun', 'Dash under air fireballs fired high, or parry them, instead of blocking all day', 'After a knockdown, block the Demon Flip mixup patiently and tech throws'],
        good: ['Hugo', 'Alex', 'Q', 'Twelve', 'Sean'], hard: ['Chun-Li', 'Yun', 'Ken'] },
    Alex: { img: 'cd/3S_Alexface_small.jpg', art: 'b3/3S_Alex_Art.png',
        s: ['Big damage from Flash Chop, Powerbomb and Hyper Bomb', 'Fast jump and long pokes for a big character; strong stomp and throw mixups'],
        w: ['Slow and big: easy to combo and juggle', 'Weak reversals; his moves recover slowly when they whiff'],
        t: ['Keep him out with pokes; make him whiff and punish the slow recovery', 'Stay out of the corner, where his stomp / powerbomb mixups are strongest', 'He jumps fast: be ready to anti-air the forward jump'],
        good: ['Hugo', 'Q', 'Twelve', 'Sean'], hard: ['Chun-Li', 'Yun', 'Ken', 'Makoto', 'Dudley'] },
    'Chun-Li': { img: '57/3S_Chunliface_small.jpg', art: 'e7/3S_Chun_Li_Art.png', fo: '42% 8%', a: ['Chun Li', 'Chun'],
        s: ['The best pokes in the game (cr.MK, far HP, b+HP)', 'SA2 (Houyoku-sen) is fast, does huge damage and punishes almost anything'],
        w: ['No strong reversal without meter', 'Most of her damage needs SA2'],
        t: ['Rush her while SA2 isn\'t charged: that\'s your window', 'With her SA2 ready, don\'t throw fireballs or unsafe moves at mid range', 'Stay just outside her cr.MK range and make her come to you'],
        good: ['Akuma', 'Alex', 'Hugo', 'Ryu', 'Oro', 'Q', 'Twelve'], hard: ['Yun'] },
    Dudley: { img: '28/3S_Dudleyface_small.jpg', art: '29/3S_Dudley_Art.png', fo: '36% 10%',
        s: ['Damaging juggles (Machine Gun Blow, Jet Upper)', 'A strong corner 50/50 into super; Rose taunt raises his next hit\'s damage'],
        w: ['No good low poke', 'His jump arc is easy to read and his approach is fairly direct'],
        t: ['Stay out of the corner: his high/low mixups into super hurt most there', 'Respect st.HP and 6HP; parry them only on a clear read', 'He lacks a good low poke, so win the footsie range with your own lows'],
        good: ['Hugo', 'Alex', 'Twelve', 'Q', 'Sean'], hard: ['Chun-Li', 'Yun', 'Ken'] },
    Elena: { img: 'bd/3S_Elenaface_small.jpg', art: '46/3S_Elena_Art.png',
        s: ['Long legs, odd hit angles and a good kara throw', 'Healing (SA3) wins long rounds; Brave Dance (SA2) for damage'],
        w: ['Few combos and low damage without meter', 'Several of her combos whiff on crouching opponents'],
        t: ['Punish Healing: she\'s open while she heals', 'Crouch more: some of her combos miss crouching opponents', 'Get close and pressure her; she isn\'t strong up close'],
        good: ['Alex', 'Hugo', 'Twelve'], hard: ['Chun-Li', 'Yun', 'Makoto', 'Ken'] },
    Gill: { img: '03/3S_Gillface_small.jpg', art: 'db/3S_Gill_Art.png', fo: '18% 10%',
        s: ['The boss: Resurrection super, two elements, huge damage', 'High health and stun'],
        w: ['Banned from normal play almost everywhere', 'No EX moves'],
        t: ['Most players don\'t allow Gill; ask before you play it', 'Don\'t get hit by cr.HP: it starts his most damaging combos', 'Save meter to finish him before Resurrection'],
        good: [], hard: [] },
    Hugo: { img: '20/3S_Hugoface_small.jpg', art: 'c1/3S_Hugo_Art.png',
        s: ['Command throws (Moonsault Press, Gigas Breaker) that end rounds', 'Massive health; j.HP and Clap control space'],
        w: ['The slowest character, with a huge hitbox (easy combos and unblockables)', 'Struggles against zoning and keep-away'],
        t: ['Keep him at range and keep moving; never stand next to him on his wakeup', 'Up close, every guess is a command-grab risk: back off rather than stay in', 'Zone him with pokes and fireballs; he can\'t walk through them'],
        good: ['Sean', 'Makoto', 'Q'], hard: ['Chun-Li', 'Remy', 'Twelve', 'Ken', 'Yun'] },
    Ibuki: { img: '5b/3S_Ibukiface_small.jpg', art: '13/3S_Ibuki_Art.png',
        s: ['Fast movement and lots of mixups (kunai, neck breaker, target combos)', 'Very dangerous once she has you in the corner'],
        w: ['Low health and stun', 'Low damage per hit; outclassed on the ground by many characters'],
        t: ['Anti-air her: she jumps a lot when she\'s out-normalled on the ground', 'Stay out of the corner; her mixups there are the main danger', 'Her health is low: one big punish swings the round'],
        good: ['Alex', 'Hugo', 'Sean', 'Twelve'], hard: ['Chun-Li', 'Yun', 'Makoto', 'Oro'] },
    Ken: { img: '4b/3S_Kenface_small.jpg', art: '8c/3S_Ken_Art.png',
        s: ['SA3 (Shippu Jinrai Kyaku) is easy to hit-confirm from cr.MK', 'Great anti-airs, double Shoryuken and a dangerous EX air tatsu'],
        w: ['A weaker fireball game than Ryu', 'A blocked or whiffed Shoryuken is a big punish'],
        t: ['Stay out of his cr.MK range: he confirms it into SA3', 'Don\'t dash in his cr.MK zone unless he just whiffed a move', 'Block and punish: a blocked SA3 or Shoryuken leaves him wide open'],
        good: ['Alex', 'Hugo', 'Q', 'Twelve', 'Sean', 'Remy'], hard: ['Chun-Li', 'Yun'] },
    Makoto: { img: '67/3S_Makotoface_small.jpg', art: '7d/3S_Makoto_Art.png',
        s: ['Huge damage and stun; Karakusa (command grab) leads to big combos', 'Safe, strong normals and Hayate for pressure'],
        w: ['The slowest walk speed, so she has to dash and jump in', 'No meterless reversal (only SA1)'],
        t: ['Keep her out: she walks slowly and has to dash or jump in', 'Stop her dashes with quick pokes', 'Don\'t get thrown twice near the corner: Karakusa there can lead to a stun'],
        good: ['Ryu', 'Alex', 'Ibuki', 'Elena'], hard: ['Chun-Li', 'Yun', 'Hugo'] },
    Necro: { img: '22/3S_Necroface_small.jpg', art: '08/3S_Necro_Art.png', fo: '22% 10%',
        s: ['Long stretchy limbs for poking from far away', 'High stun output; Electric Snake and tricky crossups'],
        w: ['A floaty jump and slow movement', 'Much weaker up close than at range'],
        t: ['Parry his long pokes and dash in: he\'s weak up close', 'Don\'t jump at him carelessly: SA1 and his anti-airs catch jumps', 'Watch for crossups and the dive into a jump-back attack'],
        good: ['Hugo', 'Q', 'Twelve'], hard: ['Chun-Li', 'Yun', 'Ken', 'Ibuki'] },
    Oro: { img: 'd5/3S_Oroface_small.jpg', art: 'c1/3S_Oro_Art.png',
        s: ['Strong neutral, quick ground movement and a tricky double jump', 'Tengu Stone and Yagyou Dama supers; unblockable setups after a parry'],
        w: ['Converts stray hits into little damage without meter', 'His pokes lose to long crouching normals'],
        t: ['Out-poke him with long crouching normals', 'One careless parry can lead to an unblockable: stay on the ground and be patient', 'During Tengu Stone, block patiently and parry the stones'],
        good: ['Hugo', 'Twelve', 'Q', 'Alex'], hard: ['Chun-Li', 'Ken', 'Yun'] },
    Q: { img: '0a/3S_Qface_small.jpg', art: '35/3S_Q_Art.png',
        s: ['Very high damage after taunting (taunts raise his attack and defense)', 'Command grabs, dash punches and strong supers'],
        w: ['Slow, big and has weak pokes', 'Needs time to taunt to become dangerous'],
        t: ['Don\'t give him free time to taunt: keep the pressure on', 'Parry his dash punches (high or low, the voice gives it away) and punish', 'Zone and poke: he\'s slow and has trouble getting in'],
        good: ['Twelve'], hard: ['Chun-Li', 'Yun', 'Ken', 'Hugo', 'Alex', 'Urien'] },
    Remy: { img: '9d/3S_Remyface_small.jpg', art: 'bd/3S_Remy_Art.png', a: ['Remya'],
        s: ['Two fireballs (high and low Light of Virtue) for keep-away', 'A charge Flash Kick and Cold Blue Kick to stop approaches'],
        w: ['Weak low attacks and a poor close-range game', 'A short stun bar; relies a lot on EX fireballs'],
        t: ['Duck or low-profile the high fireballs and keep walking forward', 'Get close: his close-range game is weak', 'Punish blocked Flash Kicks and parry the second hit of his sweep'],
        good: ['Hugo', 'Q'], hard: ['Chun-Li', 'Yun', 'Ken', 'Makoto', 'Alex'] },
    Ryu: { img: 'd9/3S_Ryuface_small.jpg', art: '1e/3S_Ryu_Art.png',
        s: ['A strong all-rounder: good pokes, anti-airs and a fast dash', 'Denjin Hadouken (SA3) for stun and chip; EX fireballs control mid range'],
        w: ['Fewer tricks than the top characters', 'His tatsu and Shoryuken are big punishes on block'],
        t: ['Respect Denjin setups: parry the fireball and watch your stun bar', 'Punish blocked hurricane kicks and Shoryukens', 'Mid range is his best range (EX fireballs): fight up close or far away'],
        good: ['Hugo', 'Alex', 'Q', 'Twelve', 'Sean'], hard: ['Chun-Li', 'Yun', 'Makoto'] },
    Sean: { img: '88/3S_Seanface_small.jpg', art: '37/3S_Sean_Art.png',
        s: ['Tackle and roll mixups; solid normals', 'Hadou Burst and Shoryu Cannon supers'],
        w: ['Like a weaker Ryu: fewer combos and weaker space control', 'Many of his moves are punishable up close'],
        t: ['Treat him like a weaker shoto: control space and punish', 'Punish blocked tackles and rolls', 'His Shoryuken goes almost straight up: bait it from just outside'],
        good: ['Twelve'], hard: ['Chun-Li', 'Yun', 'Ken', 'Hugo', 'Urien'] },
    Twelve: { img: 'a7/3S_Twelveface_small.jpg', art: '6d/3S_Twelve_Art.png',
        s: ['Very mobile: air dash and glides', 'Decent pokes; X.C.O.P.Y. copies your character'],
        w: ['One of the weakest characters: low health and defense', 'Little damage without meter'],
        t: ['Anti-air his air dashes and glides: he\'s fragile', 'Don\'t chase him around the screen; let him come to you', 'Air fireballs and anti-airs hurt him a lot'],
        good: [], hard: ['Urien', 'Chun-Li', 'Yun', 'Ken', 'Akuma'] },
    Urien: { img: 'f8/3S_Urienface_small.jpg', art: 'e0/3S_Urien_Art.png',
        s: ['Aegis Reflector (SA3) unblockable setups that end rounds', 'High health; Chariot Tackle and headbutt for damage'],
        w: ['Blocked Chariot Tackles are easy to punish', 'Weak when he has no meter and no knockdown'],
        t: ['Don\'t get cornered when he has Aegis meter', 'Punish blocked Chariot Tackles', 'Fight for space; once an Aegis is out, be patient and look for a safe parry'],
        good: ['Twelve', 'Sean', 'Q', 'Hugo', 'Alex'], hard: ['Chun-Li', 'Yun', 'Ken', 'Akuma', 'Ibuki', 'Yang'] },
    Yang: { img: 'c5/3S_Yangface_small.jpg', art: '17/3S_yang_Art.png',
        s: ['Mantis Slashes (EX ones are almost mini-supers) and fast dive kicks', 'Seiei Enbu (SA3) for huge damage and unblockables'],
        w: ['Low health and stun', 'Has to get in; weaker at long range'],
        t: ['Block the Mantis Slashes: if he stops after three or four, punish', 'Watch the dive kick: anti-air it or parry it', 'His health is low, so a big punish goes a long way'],
        good: ['Alex', 'Hugo', 'Q', 'Twelve'], hard: ['Chun-Li', 'Yun', 'Ken'] },
    Yun: { img: '77/3S_Yunface_small.jpg', art: 'd2/3S_Yun_Art.png', fo: '60% 6%',
        s: ['Genei Jin (SA3): huge pressure and damage, and he builds meter fast', 'Dive kicks, a command grab and strong pokes'],
        w: ['Low health', 'Much weaker before he has Genei Jin'],
        t: ['Rush him before he has Genei Jin; once it\'s on, block', 'Don\'t mash during Genei Jin: wait for a real gap', 'His health is low: two good guesses can end the round'],
        good: ['Alex', 'Hugo', 'Q', 'Twelve', 'Sean', 'Elena', 'Remy'], hard: ['Chun-Li'] }
};

// your matchup's own tips ("<your character>|<theirs>"), for the user's characters first
const SF3_PAIRS = {
    'Akuma|Chun-Li': ['Use air fireballs and Demon Flip to stay out of her ground game', 'Save risky moves for when she has no SA2: a blocked tatsu or DP is a free super'],
    'Akuma|Yun': ['Block out Genei Jin: your low health can\'t afford two bad guesses', 'Air fireballs stop him from building meter for free'],
    'Akuma|Ken': ['Don\'t dash into his cr.MK range: one confirm into SA3 nearly kills you', 'Air fireballs are your edge; he has no air fireball of his own'],
    'Akuma|Ryu': ['Your stun bar is the shortest: Denjin setups stun you fast, so parry the fireballs', 'Fire air fireballs low: high ones can be dashed under and punished'],
    'Akuma|Hugo': ['Zone him with fireballs; his j.HP is his main answer, so anti-air it', 'Never tatsu on block near him: every tatsu is SPD-punishable'],
    'Akuma|Alex': ['A blocked cr.HK or tatsu is a free punish for Alex: space them', 'Keep him out with fireballs; up close his damage is huge'],
    'Akuma|Urien': ['Reversal teleport gets you out of a planted Aegis', 'Urien parries Demon Flip well: don\'t lean on it'],
    'Akuma|Ibuki': ['She dashes under air fireballs and Demon Flips: mix up your timing', 'Both of you have tiny health: play for the first big hit'],
    'Akuma|Oro': ['Play at the tip of your cr.HK and st.MK range: Oro struggles to damage you there', 'Watch for Tengu Stone; Raging Demon punishes a careless approach'],
    'Akuma|Makoto': ['Keep her out with fireballs and anti-air her jumps', 'Don\'t get thrown in the corner: Karakusa combos stun you fast'],
    'Akuma|Dudley': ['Anti-air his jumps; his jump arc is easy to read', 'Stay out of the corner: his 50/50 into super kills you fast'],
    'Akuma|Yang': ['Block the slashes and punish when he stops', 'Anti-air his dive kicks early'],
    'Akuma|Twelve': ['Air fireballs and anti-airs wreck him: stay patient', 'Don\'t chase him; he wins when you overcommit'],
    'Akuma|Q': ['Keep pressure on so he can\'t taunt', 'Parry dash punches and punish with a full combo'],
    'Akuma|Remy': ['Air fireballs beat his fireball game: jump over and close in', 'Up close he has little: stay on him'],
    'Akuma|Necro': ['Parry his long pokes and get in', 'Don\'t jump in blindly: SA1 catches jumps'],
    'Akuma|Elena': ['Punish Healing with a full combo or Raging Demon', 'Crouch: several of her combos whiff on crouchers'],
    'Akuma|Sean': ['Out-zone him; his fireball game is weaker than yours', 'Punish blocked tackles'],
    'Akuma|Akuma': ['First to land a clean combo usually wins: both of you have tiny health', 'Block the Demon Flip mixups and wait for a whiffed tatsu'],
    'Ken|Chun-Li': ['Don\'t let her get a free SA2 off a blocked fireball', 'Rush her before SA2 is charged'],
    'Ken|Yun': ['Rush him before Genei Jin and block once it\'s active', 'Without SA3 he can whiff-punish your cr.MK: hold it until you have meter'],
    'Ryu|Akuma': ['Denjin works great: his stun bar is the shortest in the game', 'Punish tatsus with SA2 or EX Shoryuken right after he lands'],
    'Ryu|Makoto': ['Possibly Ryu\'s toughest: all her normals are safe on block', 'She has no good wakeup reversal except SA1: pressure her knockdowns']
};

const VSAV = {
    Anakaris: { img: '45/VSAV-Anakaris-Portrait.gif',
        s: ['Huge reach, coffin drop and sarcophagus control', 'Strong command throws and curses that shrink you'],
        w: ['Slow and big; can\'t dash, only float', 'Struggles against fast rushdown'],
        t: ['Rush him down: he\'s slow and can\'t dash', 'Stay low: his long limbs are weaker against crouching', 'Watch for the coffin drop from above'],
        good: [], hard: [] },
    'B.B. Hood': { img: 'af/VSAV-BBHood-Portrait.gif', a: ['Bulleta', 'BB Hood', 'Bb Hood'],
        s: ['Strong zoning with guns, mines and missiles', 'Good chip and big supers'],
        w: ['Low health', 'Weak once you get in close'],
        t: ['Close the gap fast: she\'s weak up close', 'Watch for the guns and mines at mid range', 'Her health is low: one big combo hurts a lot'],
        good: [], hard: [] },
    Bishamon: { img: 'ba/VSAV-Bishamon-Portrait.gif', a: ['Oboro Bishamon'],
        s: ['Long sword reach and high damage', 'Strong command grabs and guard-crushing pressure'],
        w: ['Slow walk and slow moves', 'Gets overwhelmed by fast characters'],
        t: ['Use speed: he\'s slow to recover', 'Stay out of sword range or get right in', 'Watch for the grab attempts up close'],
        good: [], hard: [] },
    Demitri: { img: 'bc/VSAV-Demitri-Portrait.gif', a: ['Demitry'],
        s: ['Strong fireball and Demon Cradle (DP) anti-air', 'Midnight Bliss and big damage'],
        w: ['Fairly slow', 'Predictable fireball game'],
        t: ['Bait the Demon Cradle and punish', 'Approach carefully through his fireballs', 'Don\'t jump at him from far'],
        good: [], hard: [] },
    Felicia: { img: '4e/VSAV-Felicia-Portrait.gif',
        s: ['Fast rushdown with fast dash and rolls', 'Good mixups and chains'],
        w: ['Short range and low damage per hit', 'Weak reversals'],
        t: ['Out-range her with long normals', 'Anti-air or poke her approach', 'Watch her roll; punish it on block'],
        good: [], hard: [] },
    'Hsien-Ko': { img: 'b8/VSAV-HsienKo-Portrait.gif', p: 'Darkstalkers 3/Hsien Ko', a: ['Lei-Lei', 'Hsien Ko', 'LeiLei'],
        s: ['Long reach with her claws and thrown objects', 'Reflect gong and tricky pressure'],
        w: ['Slow', 'Has trouble with fast rushdown'],
        t: ['Get in close; she\'s less dangerous up close', 'Watch the thrown objects from above', 'Bait the gong reflect'],
        good: [], hard: [] },
    Jedah: { img: '4e/VSAV-Jedah-Portrait.gif',
        s: ['Tricky movement and long-reach blood attacks', 'Strong mixups and supers'],
        w: ['Lower health', 'Some of his moves are unsafe'],
        t: ['Close in on him: he\'s tricky but fragile', 'Watch for his long-range blood attacks', 'Punish his unsafe specials'],
        good: [], hard: [] },
    Lilith: { img: '74/VSAV-Lilith-Portrait.gif',
        s: ['Fast and mobile, with good air control', 'Gloomy Puppet Show grab super'],
        w: ['Low health', 'Short range on many normals'],
        t: ['Anti-air her jumps and air dashes', 'Out-range her with long normals', 'Her health is low: punish hard'],
        good: [], hard: [] },
    'Lord Raptor': { img: '3d/VSAV-Raptor-Portrait.gif', a: ['Zabel', 'Dark Force Zabel', 'Raptor'],
        s: ['Top tier: strong rushdown and crossups', 'Hard-to-block mixups and fast chains'],
        w: ['Lower health', 'Some moves unsafe at range'],
        t: ['Block carefully; his crossups are hard to see', 'Push him away and don\'t panic', 'Punish his specials when they\'re blocked'],
        good: [], hard: [] },
    Morrigan: { img: '97/VSAV-Morrigan-Portrait.gif',
        s: ['Strong fireball game and good air mobility', 'Shadow Blade anti-air and Darkness Illusion super'],
        w: ['Low damage per hit', 'A big hitbox for her size'],
        t: ['Approach through her fireballs carefully', 'Bait the Shadow Blade and punish', 'Keep pressure on; she\'s weaker on defense'],
        good: [], hard: [] },
    'Q-Bee': { img: 'ec/VSAV-QBee-Portrait.gif', a: ['QBee', 'Q Bee'],
        s: ['Top tier: tiny hitbox, fast and evasive', 'Strong air game and damaging combos'],
        w: ['Low health', 'Struggles against strong anti-airs'],
        t: ['Anti-air her jumps and air dashes', 'Her hitbox is tiny: use fast, low moves', 'Low health: punish hard when you get a chance'],
        good: [], hard: [] },
    Rikuo: { img: '9b/VSAV-Rikuo-Portrait.gif', a: ['Aulbath'],
        s: ['Water bubbles and good space control', 'Command grabs and strong defensive options'],
        w: ['Slow', 'Struggles against fast rushdown'],
        t: ['Rush him down: he\'s slow and better at mid range', 'Watch for the bubbles at mid range', 'Don\'t get grabbed up close'],
        good: [], hard: [] },
    Sasquatch: { img: 'da/VSAV-Sasquatch-Portrait.gif',
        s: ['High damage and strong anti-airs', 'Freezing breath and big juggles'],
        w: ['Big hitbox', 'Slower movement'],
        t: ['Don\'t jump at him: his anti-airs are strong', 'Use speed and pokes against his size', 'Watch for the freezing breath'],
        good: [], hard: [] },
    'Jon Talbain': { img: '19/VSAV-Talbain-Portrait.gif', p: 'Darkstalkers 3/Jon Talbain', a: ['Gallon', 'Dark Gallon', 'Talbain'],
        s: ['Very fast, with strong rushdown', 'Good mixups and damage'],
        w: ['Short range', 'Some moves unsafe'],
        t: ['Poke him out of his approach', 'Block carefully against his rushdown', 'Punish his unsafe specials'],
        good: [], hard: [] },
    Victor: { img: 'e7/VSAV-Victor-Portrait.gif',
        s: ['Huge damage and strong command grabs', 'Electric moves and big normals'],
        w: ['Slow and big', 'Low tier: has trouble getting in'],
        t: ['Keep him out; he\'s slow and has trouble getting in', 'Don\'t stand next to him: his grabs hurt', 'Poke and move: he\'s slow and big'],
        good: [], hard: [] }
};

const SFA3 = {
    Adon: { img: 'ca/Sfa3_70px_adon.png',
        s: ['Jaguar Kick and Rising Jaguar give him fast, far-reaching rushdown', 'Good damage once he gets a knockdown'],
        w: ['Jaguar Kick is punishable when it\'s blocked close', 'No projectile to control space'],
        t: ['Block Jaguar Kick and punish it when it lands close', 'Bait Rising Jaguar on his wakeup', 'Keep him at range with fireballs and long pokes'],
        good: [], hard: [] },
    Akuma: { img: '37/Sfa3_70px_akuma.png', a: ['Gouki', 'Shin-Akuma', 'Shin Akuma', 'Gouki (Akuma)', 'Akuma (Gouki)'],
        s: ['Air fireball, teleport and Demon Flip mixups', 'Big damage'],
        w: ['Low health and stun', 'A teleport read on time is a free punish'],
        t: ['His health is low: every clean combo counts', 'Dash under or block the air fireball, then close in', 'Punish the teleport where he reappears'],
        good: [], hard: [] },
    Balrog: { img: '93/Sfa3_70px_balrog.png', a: ['Boxer', 'M. Bison (Boxer)'],
        s: ['Fast Dash Straights and Dash Uppers from charge', 'Strong rushdown with good damage'],
        w: ['Charge character: predictable when he has to hold back', 'Few ways past a strong fireball game'],
        t: ['Zone him: he needs charge to get in', 'Punish blocked dash punches', 'Don\'t let him corner you'],
        good: [], hard: [] },
    Birdie: { img: '87/Sfa3_70px_birdie.png',
        s: ['Long-reaching normals and headbutts', 'Command grabs and big damage'],
        w: ['Big and slow', 'Easy to zone'],
        t: ['Keep him out with fireballs and pokes', 'Don\'t stand right next to him', 'Punish his slow whiffed normals'],
        good: [], hard: [] },
    Blanka: { img: 'e1/Sfa3_70px_blanka.png',
        s: ['Rolls and hops make his approach tricky', 'Electricity punishes careless pressure'],
        w: ['Blocked rolls are punishable', 'Struggles against good zoning'],
        t: ['Punish blocked rolls up close', 'Don\'t press buttons into his electricity', 'Zone him patiently; he struggles to get in'],
        good: [], hard: [] },
    Cammy: { img: 'b7/Sfa3_70px_cammy.png',
        s: ['Fast and mobile: Cannon Drill and Cannon Spike', 'Strong pressure and combos'],
        w: ['Low health', 'Cannon Spike is a big punish when blocked'],
        t: ['Block Cannon Spike and punish it hard', 'Anti-air her jumps; her air game is strong', 'Her health is low: one combo matters'],
        good: [], hard: [] },
    Charlie: { img: '8f/Sfa3_70px_charlie.png', a: ['Nash'],
        s: ['Sonic Boom and Somersault Shell charge zoning', 'A strong defensive game'],
        w: ['Charge character: weaker when you take away his charge', 'Can be predictable'],
        t: ['Approach carefully through the Sonic Booms', 'Bait Somersault Shell and punish', 'Pressure him so he can\'t sit and charge'],
        good: [], hard: [] },
    'Chun-Li': { img: 'cb/Sfa3_70px_chun.png', a: ['Chun-li', 'Chun Li', 'Chun-li (Ryu)'],
        s: ['Fast normals and great pokes', 'Very strong in X-ism'],
        w: ['Low damage without meter', 'Weak reversals'],
        t: ['Stay out of her poke range and make her come in', 'Pressure her knockdowns', 'Watch her X-ism super when she has meter'],
        good: [], hard: [] },
    Cody: { img: 'a7/Sfa3_70px_cody.png',
        s: ['Bad Stone zoning and strong normals', 'High damage, and the knife'],
        w: ['Slow walk', 'Few good reversals'],
        t: ['Dodge his stones and close in', 'Watch for the knife pickup', 'Pressure him: his reversals are limited'],
        good: [], hard: [] },
    Dan: { img: '9c/Sfa3_70px_dan.png',
        s: ['Taunts for meter and some surprising tricks', 'Okay damage with supers'],
        w: ['The joke character: weak tools overall', 'A very short-range fireball'],
        t: ['Respect him a little, then out-tool him', 'Punish his unsafe specials', 'Don\'t get careless just because he\'s Dan'],
        good: [], hard: [] },
    Dhalsim: { img: 'cf/Sfa3_70px_dhalsim.png', a: ['Dhalsim(old)', 'Dhalsim (old)'],
        s: ['Top tier in every ism: long limbs and great zoning', 'Yoga Teleport to escape, and strong anti-airs'],
        w: ['Weak up close', 'Low stun'],
        t: ['Get in close: he\'s weak up close', 'Watch his long limbs; parry or block them, then advance', 'Punish Yoga Teleport where he reappears'],
        good: [], hard: [] },
    'E. Honda': { img: 'cc/Sfa3_70px_honda.png', a: ['E.Honda', 'Honda', 'E Honda'],
        s: ['Headbutt and slap pressure', 'A strong command grab (Oicho Throw)'],
        w: ['Charge character', 'Struggles against zoning'],
        t: ['Zone him with fireballs; he\'s slow to get in', 'Punish blocked headbutts', 'Don\'t stand next to him'],
        good: [], hard: [] },
    'Evil Ryu': { img: 'a0/Sfa3_evilryu_face_small.jpg', a: ['Evil Ryur'],
        s: ['High damage, a lot like Akuma', 'Strong mixups and teleport'],
        w: ['Low health', 'Unsafe specials'],
        t: ['Punish blocked specials', 'His health is low: every combo counts', 'Watch for the teleport'],
        good: [], hard: [] },
    Gen: { img: '0d/Sfa3_70px_gen.png',
        s: ['Two fighting styles with tricky moves', 'Strong mixups'],
        w: ['Low health', 'Hard to play well'],
        t: ['Watch which style he\'s in: his moves change', 'Pressure him: his health is low', 'Punish his blocked specials'],
        good: [], hard: [] },
    Guy: { img: '8f/Sfa3_70px_guy.png',
        s: ['Fast rushdown, good combos and run mixups', 'A strong ground game'],
        w: ['Low health', 'Short range'],
        t: ['Out-range him with long pokes', 'Block his rushdown and look for the gap', 'Punish blocked specials'],
        good: [], hard: [] },
    Juli: { img: '49/Sfa3_70px_juli.png', a: ['Juli & Juni (Ryu)'],
        s: ['Fast and evasive', 'Good mixups'],
        w: ['Low damage', 'Short range'],
        t: ['Out-range her: her normals are short', 'Pressure her knockdowns', 'Anti-air her jumps and dives'],
        good: [], hard: [] },
    Juni: { img: '8d/Sfa3_70px_juni.png',
        s: ['Fast and evasive', 'Good mixups'],
        w: ['Low damage', 'Short range'],
        t: ['Out-range her: her normals are short', 'Pressure her knockdowns', 'Anti-air her jumps and dives'],
        good: [], hard: [] },
    Karin: { img: '89/Sfa3_70px_karin.png',
        s: ['Strong pressure and combos', 'Good command throws and counters'],
        w: ['Some of her moves are unsafe', 'Weak reversals'],
        t: ['Block her pressure carefully', 'Punish her unsafe moves', 'Don\'t let her rush you down into the corner'],
        good: [], hard: [] },
    Ken: { img: 'f2/Sfa3_70px_ken.png',
        s: ['A strong Shoryuken and rushdown', 'High damage'],
        w: ['A blocked Shoryuken is a big punish', 'A weaker fireball than Ryu'],
        t: ['Bait his Shoryuken and punish', 'Watch his crossup jump-ins and anti-air them', 'Out-zone him: his fireball is weaker than Ryu\'s'],
        good: [], hard: [] },
    'M. Bison': { img: '11/Sfa3_70px_bison.png', a: ['M.Bison', 'Bison', 'Dictator', 'M.Bison (Dictator)', 'M. Bison (Dictator)', 'Vega (Dictator)'],
        s: ['Fast Psycho Crusher and strong pressure', 'Good mobility (Head Stomp, Devil\'s Reverse)'],
        w: ['Some specials are unsafe', 'Weak reversals'],
        t: ['Punish a blocked Psycho Crusher', 'Block his pressure carefully', 'Anti-air his Head Stomps'],
        good: [], hard: [] },
    'R. Mika': { img: 'd2/Sfa3_70px_mika.png', a: ['R.Mika', 'Mika', 'Rainbow Mika'],
        s: ['Strong command grabs', 'High damage'],
        w: ['Has to get in close', 'Struggles against zoning'],
        t: ['Zone her out: she has to get in to win', 'Don\'t stand next to her', 'Punish her whiffed dashes and grabs'],
        good: [], hard: [] },
    Rolento: { img: '80/Sfa3_70px_rolento.png',
        s: ['Tricky movement (wall jumps, rolls) and mixups', 'Strong pressure'],
        w: ['Some unsafe specials', 'Lower health'],
        t: ['Punish blocked specials', 'Watch his wall jumps and rolls', 'Anti-air him when he leaves the ground'],
        good: [], hard: [] },
    Rose: { img: '40/Sfa3_70px_rose.png',
        s: ['Soul Spark zoning and Soul Reflect', 'Good normals'],
        w: ['Lower damage', 'Weaker against rushdown'],
        t: ['Rush her down: she\'s weaker up close', 'Watch for Soul Reflect when you throw fireballs', 'Pressure her knockdowns'],
        good: [], hard: [] },
    Ryu: { img: '56/Sfa3_70px_ryu.png',
        s: ['A strong fireball and Shoryuken', 'A solid all-rounder'],
        w: ['Predictable', 'A blocked Shoryuken is a big punish'],
        t: ['Bait his Shoryuken and punish the landing', 'Approach carefully through his fireballs', 'Don\'t jump in from far'],
        good: [], hard: [] },
    Sagat: { img: '58/Sfa3_70px_sagat.png',
        s: ['High and low Tiger Shots', 'Tiger Uppercut anti-air and long reach'],
        w: ['Big hitbox', 'Slow walk'],
        t: ['Close in on him: he\'s slow', 'Bait the Tiger Uppercut', 'Jump or duck his Tiger Shots at the right range'],
        good: [], hard: [] },
    Sakura: { img: '00/Sfa3_70px_sakura.png',
        s: ['Strong rushdown', 'Good combos'],
        w: ['Her fireball is short range', 'Some unsafe specials'],
        t: ['Out-range her: her fireball is short', 'Punish blocked specials', 'Anti-air her jumps; she likes to jump in'],
        good: [], hard: [] },
    Sodom: { img: '70/Sfa3_70px_sodom.png',
        s: ['Command grabs and strong normals', 'High damage'],
        w: ['Slow', 'Struggles against zoning'],
        t: ['Zone him with fireballs and pokes', 'Don\'t stand next to him', 'Punish his big whiffed normals'],
        good: [], hard: [] },
    Vega: { img: '4f/Sfa3_70px_vega.png', a: ['Claw', 'Balrog (Claw)', 'Vega (Claw)'],
        s: ['Long claw reach and wall dives', 'Fast and evasive'],
        w: ['Low damage', 'Weak reversals'],
        t: ['Anti-air the wall dive', 'Close in on him: he\'s weaker up close', 'Watch his long claw pokes at mid range'],
        good: [], hard: [] },
    Zangief: { img: 'cd/Sfa3_70px_zangief.png', a: ['Zangief(old)', 'Zangief (old)'],
        s: ['Huge command grab damage', 'Very strong up close'],
        w: ['Slow, and easily zoned', 'Few ways in'],
        t: ['Keep him out at mid range: he has few ways in', 'Don\'t stand next to him', 'Fireballs force him to jump: anti-air the jump'],
        good: [], hard: [] }
};

const ST = {
    Akuma: { img: 'fe/Ssf2t_akuma_css.png', a: ['Gouki', 'Gouki (Akuma)', 'Akuma (Gouki)'],
        s: ['High-priority, fast normals', 'Two ground fireballs and an air fireball almost nobody can answer'],
        w: ['Below-average range on his normals', 'No super, and banned from most play'],
        t: ['Most players ban him: ask before you play', 'Respect the air fireball; you mostly have to block it', 'Punish whiffed specials hard'],
        good: [], hard: [] },
    Balrog: { img: '24/Ssf2t_boxer_css.png', a: ['Boxer', 'M. Bison (Boxer)', 'M.Bison (Boxer)', 'Balrog (Boxer)'],
        s: ['Top tier: fast walk and dash punches that are hard to deal with', 'Fully invincible headbutt and super; his super is one of the best'],
        w: ['The headbutt starts slowly, so he\'s easy to safe-jump', 'Without super he can be abused on wakeup'],
        t: ['Safe-jump him on wakeup: his headbutt starts slowly', 'Watch for low rushes; block low by default against him', 'When he has no super, pressure him on wakeup'],
        good: ['Guile', 'Blanka', 'T. Hawk'], hard: ['Zangief'] },
    Blanka: { img: '8f/Ssf2t_blanka_css.png',
        s: ['Rolls, hops and electricity make him tricky', 'Good crossups and tick tricks'],
        w: ['One of the less-used characters: weak overall', 'Rolls are punishable on block'],
        t: ['Punish blocked rolls up close', 'Don\'t press buttons into his electricity', 'Zone him; he struggles to get in'],
        good: ['T. Hawk', 'M. Bison'], hard: ['Sagat', 'Ryu', 'Vega'] },
    Cammy: { img: '7b/Ssf2t_cammy_css.png',
        s: ['Excellent footspeed and good pokes', 'High damage combos and strong jumping attacks'],
        w: ['No projectile in a game where projectiles are strong', 'Jumps slowly, easy to anti-air'],
        t: ['Zone her with fireballs', 'Anti-air her slow jumps', 'Bait her Hooligan Roll and punish'],
        good: ['T. Hawk'], hard: ['Sagat', 'Guile', 'Dhalsim', 'Vega'] },
    'Chun-Li': { img: '6b/Ssf2t_chun_css.png', a: ['Chun Li', 'Chun-li'],
        s: ['High tier: fast walk, great pokes and fireball', 'Strong air game'],
        w: ['Lower damage', 'Struggles against Sagat'],
        t: ['Out-poke her carefully; she has great range', 'Anti-air her jumps: her air game is strong', 'Punish her whiffed pokes'],
        good: ['M. Bison', 'E. Honda', 'Fei Long'], hard: ['Sagat', 'Vega'] },
    'Dee Jay': { img: 'b8/Ssf2t_deejay_css.png', a: ['Deejay', 'DeeJay'],
        s: ['High-priority normals; the best crossup in the game', 'Good 50/50 setups'],
        w: ['Most normals have short reach', 'Unreliable reversals; struggles in fireball wars'],
        t: ['Win the fireball war; he struggles there', 'Block his crossups carefully', 'Punish his slow super on block'],
        good: ['Zangief', 'T. Hawk'], hard: ['Sagat', 'Guile', 'Dhalsim'] },
    Dhalsim: { img: 'da/Ssf2t_dhalsim_css.png',
        s: ['Top tier: long limbs and great zoning', 'A great super and strong throws'],
        w: ['Poor reversals; teleport is punishable', 'The lowest stun resistance in the game'],
        t: ['Get in close: he\'s weak up close', 'Punish his teleport on reaction', 'Stun him: he has the lowest stun resistance'],
        good: ['Zangief', 'T. Hawk', 'E. Honda', 'Cammy'], hard: ['Vega', 'Balrog'] },
    'E. Honda': { img: '1b/Ssf2t_honda_css.png', a: ['E.Honda', 'Honda', 'E Honda'],
        s: ['Nearly unbeatable up close', 'Headbutt, slaps and the oicho throw'],
        w: ['Hard time getting in from a distance', 'Lacks tools to play from afar'],
        t: ['Keep him out: he\'s deadly up close', 'Zone him with fireballs', 'Punish blocked headbutts'],
        good: ['Fei Long', 'T. Hawk'], hard: ['Chun-Li', 'Dhalsim', 'Vega'] },
    'Fei Long': { img: '6f/Ssf2t_fei_css.png', a: ['Feilong', 'Fei-Long'],
        s: ['Speed and fast rekka damage', 'Fully invincible super'],
        w: ['Big hitbox, easy to cross up', 'More bad matchups than good ones'],
        t: ['Cross him up: his big hitbox makes it easy', 'Block the rekkas and punish', 'Zone him: he struggles against fireballs'],
        good: ['Zangief'], hard: ['E. Honda', 'Chun-Li', 'Sagat'] },
    Guile: { img: '25/Ssf2t_guile_css.png',
        s: ['The fastest-recovering fireball in the game', 'Flash Kick is a great anti-air'],
        w: ['Easy to safe-jump and cross up, with no reversal special', 'Long recovery on most normals'],
        t: ['Safe-jump and cross him up', 'Approach patiently through Sonic Booms', 'Punish his slow normals'],
        good: ['Cammy', 'Dee Jay', 'T. Hawk'], hard: ['Balrog', 'Vega', 'Dhalsim'] },
    Ken: { img: 'ba/Ssf2t_ken_css.png',
        s: ['Strong rushdown and crossups', 'A great Shoryuken anti-air'],
        w: ['A weaker fireball game than Ryu', 'Struggles against Balrog'],
        t: ['Bait his Shoryuken and punish', 'Anti-air his crossup jumps', 'Out-zone him: his fireball is weaker than Ryu\'s'],
        good: ['E. Honda', 'Zangief'], hard: ['Balrog', 'Sagat'] },
    'M. Bison': { img: 'f1/Ssf2t_dictator_css.png', a: ['M.Bison', 'Bison', 'Dictator', 'M.Bison (Dictator)', 'M. Bison (Dictator)', 'Vega (Dictator)'],
        s: ['Long-reaching standing moves and fast walk', 'Good air mobility and big combos'],
        w: ['No dedicated anti-air', 'His only reversal is his super'],
        t: ['Jump at him: he has no dedicated anti-air', 'Trap him in the corner with fireballs', 'Block his tricks and punish'],
        good: ['T. Hawk'], hard: ['Ryu', 'Chun-Li', 'Sagat'] },
    Ryu: { img: '93/Ssf2t_ryu_css.png',
        s: ['A strong all-rounder: the second-best fireball in the game', 'Powerful combos and a great super'],
        w: ['Not the strongest at any single thing', 'Struggles against Dhalsim'],
        t: ['Bait his Shoryuken and punish the landing', 'Approach carefully through fireballs', 'Don\'t jump in from far'],
        good: ['Blanka', 'M. Bison'], hard: ['Dhalsim', 'Sagat'] },
    Sagat: { img: 'a8/Ssf2t_sagat_css.png',
        s: ['Great reach and damage', 'Low Tiger Shots that can\'t be low-profiled'],
        w: ['Big hurtbox and slow', 'One of the worst throw ranges'],
        t: ['Close in on him: he\'s slow', 'Jump his fireballs at the right distance', 'Throw him: his throw range is poor'],
        good: ['Blanka', 'Fei Long', 'Cammy'], hard: ['Vega', 'Balrog'] },
    'T. Hawk': { img: '7e/Ssf2t_thawk_css.png', a: ['T.Hawk', 'Hawk', 'Thunder Hawk'],
        s: ['High damage and the second-largest SPD range', 'Good walk and jump speed for a grappler'],
        w: ['Bad normals; loses to almost everyone except Zangief', 'Struggles against fireballs and keep-away'],
        t: ['Zone him with fireballs', 'Keep away from SPD range', 'Punish his unsafe dive on block'],
        good: ['Zangief'], hard: ['Dhalsim', 'Guile', 'Balrog', 'Blanka'] },
    Vega: { img: 'f7/Ssf2t_claw_css.png', a: ['Claw', 'Balrog (Claw)', 'Vega (Claw)'],
        s: ['Top tier: fastest walk speed and long range', 'Wall-dive loops that are very hard to stop'],
        w: ['He\'s weak: dizzies easily, low priority', 'Low damage; awkward up close'],
        t: ['Get close: his long normals are awkward up close', 'Anti-air the wall dive', 'Stun him: he dizzies easily'],
        good: ['Sagat', 'Dhalsim', 'E. Honda'], hard: ['Chun-Li'] },
    Zangief: { img: 'c2/Ssf2t_zangief_css.png',
        s: ['Very strong up close', 'Lariats go through fireballs'],
        w: ['Low tier: no projectile, has to be on offense', 'No invincible anti-air'],
        t: ['Keep him out: zone and run', 'Jump at him: he has no invincible anti-air', 'Don\'t stand next to him'],
        good: ['T. Hawk', 'Balrog'], hard: ['Dhalsim', 'Guile', 'Sagat', 'Vega'] }
};

const GAROU = {
    'B. Jenet': { img: 'c8/Jenet.PNG', a: ['B.Jenet', 'Jenet', 'B Jenet'],
        s: ['Top tier: strong pokes and divekick', 'Lock-down strings that work on big characters'],
        w: ['Lower health', 'Some moves unsafe'],
        t: ['Just Defend her divekick', 'Stay out of the corner', 'Her pokes out-range yours: Just Defend and get in instead'],
        good: ['Rock', 'Freeman', 'Tizoc', 'Terry', 'Hokutomaru'], hard: ['Grant'] },
    Freeman: { img: '30/Freeman.PNG',
        s: ['Good range on normals', 'Tricky movement'],
        w: ['Low meterless damage', 'Weak defensive options'],
        t: ['Don\'t let him build meter', 'Pressure him on wakeup', 'Use long normals at mid range and make him come to you'],
        good: [], hard: ['B. Jenet', 'Gato', 'Tizoc'] },
    Gato: { img: 'f7/Gato.PNG',
        s: ['Strong pressure and combos', 'Dominant in the corner'],
        w: ['Some unsafe moves', 'Weaker midscreen'],
        t: ['Stay out of the corner', 'Punish his unsafe moves', 'Just Defend his pressure strings to find a gap'],
        good: ['Freeman', 'Rock', 'Hotaru', 'Tizoc', 'Hokutomaru', 'Terry'], hard: ['Kevin', 'B. Jenet'] },
    Grant: { img: '64/Grant.PNG',
        s: ['Great pokes and space control', 'Strong air-to-air'],
        w: ['Can\'t feint-cancel, so he works harder for combos', 'A big character'],
        t: ['Out-move him; he\'s big', 'His pokes beat most of yours: move in and out instead of trading', 'He can\'t feint-cancel, so his combos need links: block and wait'],
        good: ['Tizoc', 'Terry'], hard: ['B. Jenet'] },
    Hokutomaru: { img: '8e/Hoku.PNG', a: ['Hoku'],
        s: ['Double jump and tricky movement', 'Good anti-air slide'],
        w: ['Lower damage', 'Several bad matchups'],
        t: ['Anti-air after his double jump', 'Fast offense gives him trouble: keep pressing', 'Punish his teleport where he reappears'],
        good: ['Tizoc'], hard: ['Kevin', 'B. Jenet', 'Gato'] },
    Hotaru: { img: '9d/Hotaru.PNG',
        s: ['Fireball, invincible anti-air and air throw', 'Good damage'],
        w: ['Somewhat linear offense', 'Lower health'],
        t: ['Bait her invincible anti-air, then punish the landing', 'Approach through fireballs carefully', 'Block her offense patiently'],
        good: ['Tizoc'], hard: ['Gato', 'B. Jenet'] },
    Kain: { img: 'fa/Kain.PNG', a: ['Kain R. Heinlein'],
        s: ['Strong zoning and rushdown', 'Fireballs and good damage'],
        w: ['Some moves unsafe', 'Big character'],
        t: ['Close in through his fireballs', 'Watch for his Lanze break when you get close', 'Don\'t sit at full screen: he builds meter there'],
        good: ['Tizoc', 'Terry', 'Hokutomaru', 'Gato'], hard: ['B. Jenet'] },
    Kevin: { img: 'c6/Kevin.PNG', p: 'Garou: Mark of the Wolves/Kevin Rian', a: ['Kevin Rian'],
        s: ['Fast meter build into P-Power', 'Strong corner blockstrings'],
        w: ['Lower mobility', 'Big character'],
        t: ['Don\'t let him build meter', 'Stay out of the corner', 'Stand-block his corner blockstrings and look for the escape'],
        good: ['Terry', 'Hokutomaru', 'Gato', 'Tizoc'], hard: ['B. Jenet'] },
    'Kim Dong Hwan': { img: 'b7/KimDongHwan.PNG', a: ['Dong Hwan', 'Dong'],
        s: ['Strong aerial and anti-air moves', 'Air super'],
        w: ['Low damage output', 'Slow meter building'],
        t: ['Win the first round before he has meter', 'Watch his air attacks', 'His DP is unsafe even when broken: punish it on block'],
        good: ['Tizoc'], hard: ['B. Jenet'] },
    'Kim Jae Hoon': { img: 'dc/Jae.PNG', a: ['Jae Hoon', 'Jae'],
        s: ['Good ground normals and strong neutral', 'Damaging combos'],
        w: ['Lower health', 'Some unsafe moves'],
        t: ['Poke from just outside his range: his ground normals are strong', 'Punish his unsafe moves', 'Respect his damaging combos: block instead of mashing'],
        good: ['Terry', 'Hokutomaru'], hard: ['Tizoc', 'Gato'] },
    Marco: { img: '95/Marco.PNG', p: 'Garou: Mark of the Wolves/Khushnood Butt', a: ['Khushnood Butt', 'Butt'],
        s: ['Safe pressure and high damage', 'Strong neutral'],
        w: ['Lower mobility', 'Some unsafe specials'],
        t: ['Block his pressure carefully', 'Punish unsafe specials', 'Move around him instead of trading pokes: he\'s less mobile'],
        good: ['Tizoc', 'Terry', 'Hokutomaru'], hard: ['B. Jenet'] },
    Rock: { img: '28/Rock.PNG', a: ['Rock Howard'],
        s: ['Fast and mobile', 'Strong super (Shine Knuckle)'],
        w: ['Low health', 'Below-average combo damage'],
        t: ['Pressure him: his health is low', 'Watch for his command grab setups', 'Don\'t let him build meter'],
        good: ['Hokutomaru'], hard: ['B. Jenet', 'Gato'] },
    Terry: { img: '19/Terry.PNG', a: ['Terry Bogard'],
        s: ['Power Dunk and Burning Knuckle', 'Strong super'],
        w: ['Several bad matchups', 'Some unsafe moves'],
        t: ['Just Defend Burning Knuckle and punish', 'Watch for Power Dunk and Power Charge midscreen', 'Use your longer normals: his reach is shorter than most'],
        good: ['Tizoc'], hard: ['Kevin', 'B. Jenet', 'Gato'] },
    Tizoc: { img: '63/Griffon.PNG', a: ['Griffon', 'The Griffon', 'Griffon Mask'],
        s: ['Long-reaching normals', 'Command grabs'],
        w: ['Big and slow', 'Several bad matchups'],
        t: ['Jump and hop around him: command grabs whiff on airborne opponents', 'Don\'t get grabbed up close', 'His big normals are slow: whiff-punish them'],
        good: ['Freeman', 'Hokutomaru', 'Kim Jae Hoon'], hard: ['Marco', 'Kain', 'Grant'] }
};

const GAMES = [
    { id: '3s', name: 'Street Fighter III: 3rd Strike', rom: /^(fc1_)?sfiii3/, wiki: 'Street Fighter 3: 3rd Strike', chars: SF3, pairs: SF3_PAIRS },
    { id: 'vsav', name: 'Vampire Savior', rom: /^vsav(?!2)/, wiki: 'Darkstalkers 3', chars: VSAV },
    { id: 'sfa3', name: 'Street Fighter Alpha 3', rom: /^(sfa3|sfz3)/, wiki: 'Street Fighter Alpha 3', chars: SFA3 },
    { id: 'st', name: 'Super Street Fighter II Turbo', rom: /^ssf2(t|x)/, wiki: 'Super Street Fighter 2 Turbo', chars: ST },
    { id: 'garou', name: 'Garou: Mark of the Wolves', rom: /^garou/, wiki: 'Garou: Mark of the Wolves', chars: GAROU }
];

/* -------------------------------------------------------------------- lookup */

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// "M. Bison (Dictator)" in one ST version is "Vega (Dictator)" in another: the role wins
const ROLES = { dictator: 'Dictator', boxer: 'Boxer', claw: 'Claw' };

function gameOf(rom) {
    const r = String(rom || '').toLowerCase();
    return GAMES.find(g => g.rom.test(r)) || null;
}

function index(g) {
    if (g._ix) return g._ix;
    const ix = new Map();
    for (const name of Object.keys(g.chars)) {
        ix.set(norm(name), name);
        (g.chars[name].a || []).forEach(x => { if (!ix.has(norm(x))) ix.set(norm(x), name); });
    }
    return (g._ix = ix);
}

// the wiki keeps a file at images/<md5[0]>/<md5[0..1]>/<name>; img is '<md5[0..1]>/<name>'
function imgUrl(img) {
    const i = String(img).indexOf('/');
    return WIKI + 'images/' + img.charAt(0) + '/' + img.slice(0, i) + '/' + encodeURIComponent(img.slice(i + 1).replace(/ /g, '_'));
}
// the wiki's own smaller copy of a picture (it makes one once something asks for it through its API)
const thumbUrl = (img, w) => { const u = imgUrl(img), i = u.lastIndexOf('/'); return u.slice(0, i).replace('/images/', '/images/thumb/') + u.slice(i) + '/' + w + 'px-' + u.slice(i + 1); };
const pageUrl = (title) => WIKI + 'w/' + encodeURI(String(title).replace(/ /g, '_')).replace(/\?/g, '%3F');

// the emulator's name -> the guide's name, or ''. Copes with its spellings: a stray last letter
// ("Remya", "Evil Ryur"), "EX " versions, and the Dictator / Boxer / Claw names swapping per version
function resolve(g, char) {
    const ix = index(g);
    let raw = String(char || '').trim();
    if (!raw) return '';
    const paren = /\(([^)]*)\)\s*$/.exec(raw);
    if (paren && ROLES[norm(paren[1])] && ix.has(norm(paren[1]))) return ix.get(norm(paren[1]));
    if (ix.has(norm(raw))) return ix.get(norm(raw));
    raw = raw.replace(/^ex\s+/i, '').replace(/\s*\([^)]*\)\s*$/, '');
    const n = norm(raw);
    if (ix.has(n)) return ix.get(n);
    if (n.length > 3 && ix.has(n.slice(0, -1))) return ix.get(n.slice(0, -1));
    return '';
}

function find(rom, char) {
    const g = gameOf(rom);
    const name = g ? resolve(g, char) : '';
    if (!name) return null;
    const c = g.chars[name];
    return Object.assign({ name, game: g.id, gameName: g.name, face: c.art ? thumbUrl(c.art, 160) : imgUrl(c.img), small: imgUrl(c.img), page: pageUrl(c.p || g.wiki + '/' + name) }, c);
}

// short tips for this matchup: your character's own first, then the general ones
function tips(rom, myChar, oppChar, n) {
    const opp = find(rom, oppChar);
    if (!opp) return [];
    const g = gameOf(rom), mine = myChar ? resolve(g, myChar) : '';
    const own = (mine && g.pairs && g.pairs[mine + '|' + opp.name]) || [];
    const out = [];
    own.concat(opp.t).forEach(x => { if (out.indexOf(x) < 0) out.push(x); });
    return out.slice(0, n || 3);
}
const hasPair = (rom, myChar, oppChar) => {
    const g = gameOf(rom), opp = find(rom, oppChar);
    return !!(g && opp && myChar && g.pairs && g.pairs[resolve(g, myChar) + '|' + opp.name]);
};

/* ---------------------------------------------------------------------- html */

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const T = (s, v) => (fc ? fc.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)));
const hue = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

// the character's icon; a coloured initial when there's no picture
function faceHtml(rom, char, size, cls) {
    const e = find(rom, char);
    const name = e ? e.name : String(char || '');
    if (!name) return '';
    const s = size || 32;
    // the big art first (3rd Strike), then the small face, then the initial
    const img = e ? `<img${e.art ? ` class="art"${e.fo ? ` style="--fo:${esc(e.fo)}"` : ''}` : ''} src="${esc(e.face)}"${e.art ? ` data-alt="${esc(e.small)}"` : ''} alt="" loading="lazy" referrerpolicy="no-referrer" ` +
        `onerror="if(this.dataset.alt){this.src=this.dataset.alt;this.removeAttribute('data-alt');this.className='';this.removeAttribute('style')}else{this.parentNode.classList.add('nof');this.remove()}">` : '';
    return `<span class="fc-mu-face${e ? '' : ' nof'}${cls ? ' ' + cls : ''}" style="--s:${s}px;--h:${hue(name)}" title="${esc(name)}">${img}<b>${esc(name.charAt(0).toUpperCase())}</b></span>`;
}

function list(rom, names) {
    return names.map(n => `<span class="fc-mu-chip">${faceHtml(rom, n, 20)}${esc(n)}</span>`).join('');
}

// the whole guide for one opponent character (matchup notes pop-up)
function cardHtml(rom, oppChar, myChar) {
    const e = find(rom, oppChar);
    if (!e) return '';
    const sec = (title, items) => items && items.length ? `<div class="fc-mu-sec"><small>${esc(title)}</small><ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
    const mine = hasPair(rom, myChar, oppChar) ? find(rom, myChar) : null;
    return `<div class="fc-mu-card">
        <div class="fc-mu-head">${faceHtml(rom, e.name, 44)}<div><b>${esc(e.name)}</b><small>${esc(e.gameName)}</small></div></div>
        ${mine ? sec(T('As {char}', { char: mine.name }), tips(rom, mine.name, e.name, 2)) : ''}
        ${sec(T('How to fight them'), e.t)}
        <div class="fc-mu-two">${sec(T('Strengths'), e.s)}${sec(T('Weaknesses'), e.w)}</div>
        ${e.hard.length ? `<div class="fc-mu-sec"><small>${esc(T('Struggles against'))}</small><div class="fc-mu-chips">${list(rom, e.hard)}</div></div>` : ''}
        ${e.good.length ? `<div class="fc-mu-sec"><small>${esc(T('Strong against'))}</small><div class="fc-mu-chips">${list(rom, e.good)}</div></div>` : ''}
        <a class="fc-mu-src" href="${esc(e.page)}" target="_blank" rel="noopener">${esc(T('Based on the SuperCombo Wiki'))} ↗</a>
    </div>`;
}

const CSS = `
.fc-mu-face { position: relative; display: inline-grid; place-items: center; flex: none; width: var(--s); height: var(--s); border-radius: calc(var(--s) * .22);
    overflow: hidden; vertical-align: middle; background: hsl(var(--h) 38% 30%); box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
.fc-mu-face img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 18%; }
/* the art is a bust: zoom in on the face */
.fc-mu-face img.art { object-position: 50% 0; transform: scale(1.6); transform-origin: var(--fo, 50% 8%); }
.fc-mu-face b { display: none; color: #fff; font-weight: 800; font-size: calc(var(--s) * .44); line-height: 1; }
.fc-mu-face.nof b { display: block; }
.fc-mu-card > * + * { margin-top: 12px; }
.fc-mu-head { display: flex; align-items: center; }
.fc-mu-head > .fc-mu-face { margin-right: 10px; }
.fc-mu-head b { display: block; color: var(--fc-head, #f2f3f5); font-size: 15px; }
.fc-mu-head small { color: var(--fc-muted, #949ba4); font-size: 12px; }
.fc-mu-sec small { display: block; margin-bottom: 3px; color: var(--fc-muted, #949ba4); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .02em; }
.fc-mu-sec ul { margin: 0; padding-left: 16px; list-style: disc outside; color: var(--fc-text, #dbdee1); font-size: 13px; line-height: 1.4; }
.fc-mu-sec li + li { margin-top: 2px; }
.fc-mu-two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.fc-mu-chips { display: flex; flex-wrap: wrap; margin: 0 -2px -4px; }
.fc-mu-chip { display: inline-flex; align-items: center; margin: 0 2px 4px; padding: 2px 8px 2px 2px; border-radius: 6px; background: var(--fc-s3, rgba(255,255,255,.06));
    color: var(--fc-text, #dbdee1); font-size: 12px; }
.fc-mu-chip > .fc-mu-face { margin-right: 5px; }
.fc-mu-src { display: inline-block; color: var(--fc-link, #00a8fc); font-size: 12px; text-decoration: none; }
.fc-mu-src:hover { text-decoration: underline; }
`;

const api = { find, tips, hasPair, faceHtml, cardHtml, gameOf, games: () => GAMES.map(g => ({ id: g.id, name: g.name })) };

function start(f) {
    fc = f;
    fc.ui.style('fcMuStyle', CSS);
    fc.own(() => fc.ui.style('fcMuStyle', null));
    return api;
}

module.exports = { id: 'matchup-guide', name: 'Matchup guide', start, _test: { GAMES, resolve, find, tips, hasPair, faceHtml, cardHtml, imgUrl, thumbUrl, gameOf } };
