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

// (3.15) every other character's own tips, so "You play" works for everyone, not only Akuma. Only tips that
// add something to the general ones; the rest of a matchup falls back to them. Gill isn't covered (almost nobody allows him)
Object.assign(SF3_PAIRS, {
    'Alex|Akuma': ["His health is the lowest: one Power Bomb guess or a stomp combo takes a huge chunk","Parry or dash under the air fireballs instead of blocking and getting chipped"],
    'Alex|Alex': ["Fight for the first knockdown with pokes: the stomp / Power Bomb mixup decides the round","You're both slow to recover: whiff-punish the other Alex's big buttons"],
    'Alex|Chun-Li': ["One of your hardest: she out-pokes you, so walk in and parry cr.MK instead of trading buttons","A blocked or whiffed big move is a free SA2 for her: only commit on a clear read"],
    'Alex|Dudley': ["He anti-airs well: get in on the ground with dashes and parries, not jumps","Up close, mix stomps and Power Bomb; he has no strong meterless reversal"],
    'Alex|Elena': ["Her long legs keep you out: parry the pokes and dash in","Once she's knocked down, stay on her: she struggles against your throw and stomp mix"],
    'Alex|Hugo': ["You're faster: poke him and back off before you're in SPD range","He's huge: your combos and Hyper Bomb land easily on him"],
    'Alex|Ibuki': ["She's slippery: don't chase her, let her come to you and anti-air the jumps","Her health is low: a couple of good Power Bomb guesses end the round"],
    'Alex|Ken': ["His cr.MK into SA3 punishes your slow moves: don't throw Flash Chops at his poke range","Parry his jump-ins and fireballs to get in, then make him guess"],
    'Alex|Makoto': ["You both want to be close: parry her Hayate and punish it","She walks slowly: dash pressure and stomp mixups work well on her"],
    'Alex|Necro': ["His long limbs keep you out: parry the pokes and dash in","He's weak up close: stay on him and mix throws and stomps"],
    'Alex|Oro': ["Don't sit in his Tengu Stone pressure: parry the stones or block patiently","Push him to the corner: his escapes are weak against your Power Bomb mix"],
    'Alex|Q': ["Q is big and slow: your combos land easily, so keep pressing","Watch for his command grab up close: hit him first or jump it"],
    'Alex|Remy': ["Parry his high and low fireballs and walk forward: he has little up close","Bait his flash kick before you jump in, then punish it"],
    'Alex|Ryu': ["Parry the fireballs to close the distance; don't whiff big moves into his super range","Up close, mix Power Bomb and stomps, and bait the Shoryuken"],
    'Alex|Sean': ["Your damage is much higher: one good guess is worth several of his","Block his tackles and punish; anti-air his jumps"],
    'Alex|Twelve': ["Walk him into the corner and mix grabs and stomps there","Anti-air his air dashes early; don't chase him across the screen"],
    'Alex|Urien': ["His tackles and headbutts out-range you: parry them and get in","Don't guess against every Aegis setup: sometimes taking the chip is the safer choice"],
    'Alex|Yang': ["Block the Mantis Slashes and punish the gap","His health is low: two good Power Bomb guesses end the round"],
    'Alex|Yun': ["Get to him before Genei Jin; once it's on, block and parry, don't mash","His health is low: your big punishes count double here"],
    'Chun-Li|Akuma': ["His health is the lowest: one cr.MK into SA2 takes a huge chunk","Anti-air or parry the Demon Flip, and don't let air fireballs walk you into the corner"],
    'Chun-Li|Alex': ["You out-range him: keep him at the tip of cr.MK and far HP","Don't let him get close: a blocked Flash Chop starts his mixups"],
    'Chun-Li|Chun-Li': ["Whoever has SA2 owns the ground: play safe when only she has it","Win the poke range with cr.MK and far HP, and confirm into SA2"],
    'Chun-Li|Dudley': ["He has no good low poke: win the ground with cr.MK","Stay out of the corner, where his mixups into super hurt most"],
    'Chun-Li|Elena': ["Out-poke her and punish Healing with SA2","Crouch more: some of her combos whiff on crouching opponents"],
    'Chun-Li|Hugo': ["Poke him from far away: he struggles badly against your range","Don't let him walk you into the corner: back off and keep poking"],
    'Chun-Li|Ibuki': ["She wants a knockdown for her mixups: stop her approach with pokes","Her health is low: one SA2 punish hurts a lot"],
    'Chun-Li|Ken': ["Don't throw careless pokes at his range: his cr.MK into SA3 punishes","A blocked or whiffed Shoryuken is a free SA2"],
    'Chun-Li|Makoto': ["Keep her out: she walks slowly and has to dash or jump in","Punish blocked Hayates; respect Karakusa up close"],
    'Chun-Li|Necro': ["Your far HP out-ranges most of his pokes: whiff-punish the long limbs","Get in on him: he's weak up close"],
    'Chun-Li|Oro': ["Poke him at range and anti-air his flips","Block his Tengu Stone pressure patiently instead of mashing"],
    'Chun-Li|Q': ["He's easy to poke: keep him at range and confirm into SA2","Keep pressure on so he can't taunt for free"],
    'Chun-Li|Remy': ["Parry or jump his fireballs, then poke him","Punish his flash kick when it's blocked"],
    'Chun-Li|Ryu': ["He anti-airs well: win the ground instead of jumping","Parry fireballs at mid range and punish with SA2 when you're close enough"],
    'Chun-Li|Sean': ["Out-poke him and punish his tackles","Your SA2 punishes almost every mistake he makes"],
    'Chun-Li|Twelve': ["Anti-air his air dashes and stay patient","Pin him in the corner with pokes"],
    'Chun-Li|Urien': ["Block or parry his tackles and headbutts, then punish with SA2","Stay out of the corner against Aegis setups"],
    'Chun-Li|Yang': ["Win the poke battle and stop his dash-ins","Punish when the Mantis Slashes stop"],
    'Chun-Li|Yun': ["Your hardest: poke him so he can't build Genei Jin for free","When Genei Jin is on, block and parry; don't press buttons into it"],
    'Dudley|Akuma': ["His health is the lowest: one corner mixup into super can end the round","Anti-air the Demon Flip and air fireball jumps; don't chase him"],
    'Dudley|Alex': ["Stay out of his grab range and poke; he's slow to recover from big moves","Your combos land easily on him: punish every whiffed Flash Chop"],
    'Dudley|Chun-Li': ["You have no good low poke against hers: get in with dashes and parries","Don't do unsafe moves when she has SA2"],
    'Dudley|Dudley': ["Fight for the corner: whoever gets there gets the 50/50 into super","Anti-air the other Dudley's jumps; his arc is easy to read"],
    'Dudley|Elena': ["Get in close: she's weak up close and you hit hard there","Punish Healing with a full combo"],
    'Dudley|Hugo': ["Stay out of SPD range and hit him with big combos when he whiffs","Use Rose before a combo: he has so much health that every bit helps"],
    'Dudley|Ibuki': ["Her health is low: one corner mixup into super ends the round","She's slippery: be ready to anti-air her jumps and Kunai approaches"],
    'Dudley|Ken': ["Respect his cr.MK into SA3; don't walk into it","Bait the Shoryuken on his wakeup and punish with a full combo"],
    'Dudley|Makoto': ["Respect her damage: one Karakusa can stun you","Pressure her: she has no strong reversal without meter"],
    'Dudley|Necro': ["Get past his long limbs with dashes and parries","Once you're in, stay in: he's weak up close"],
    'Dudley|Oro': ["Pressure him before he can set up Tengu Stone"],
    'Dudley|Q': ["He's big and slow: your combos land easily","Keep pressure on so he can't taunt"],
    'Dudley|Remy': ["Parry the fireballs and walk in","Up close he has little: stay on him"],
    'Dudley|Ryu': ["Parry fireballs to get in, then mix him up","Bait the Shoryuken: he leans on it on wakeup"],
    'Dudley|Sean': ["Your damage is much higher: play solid and punish his tackles","Anti-air his jumps; he has few ways in"],
    'Dudley|Twelve': ["Anti-air his air dashes instead of chasing him","Corner him: he has little to get out once he's there"],
    'Dudley|Urien': ["Get past his tackles with parries; up close you trade well","Stay out of the corner, where his Aegis setups are strongest"],
    'Dudley|Yang': ["Block the slashes and punish the gap","His health is low: your corner mixups can end the round"],
    'Dudley|Yun': ["Rush him before Genei Jin, then block patiently while it's on","His health is low: one good corner mixup ends it"],
    'Elena|Akuma': ["His health is the lowest: one Brave Dance or a long combo goes a long way","Crouch and wait for him to whiff; don't chase the air fireballs"],
    'Elena|Alex': ["Keep him out with your long legs and odd angles","Don't let him get close: his damage up close is far higher than yours"],
    'Elena|Chun-Li': ["She out-pokes you: look for ways in with jumps and parries","Only Heal when she can't reach you with SA2"],
    'Elena|Dudley': ["Stay at mid range: he has no good low poke to fight your legs","Avoid the corner: his mixups into super are strongest there"],
    'Elena|Elena': ["Whoever Heals safely wins the long game: punish each other's Healing","Crouch: several of her combos whiff on crouching opponents"],
    'Elena|Hugo': ["Your legs and speed keep him out: poke, then move","Don't stand next to him: his SPD range is big"],
    'Elena|Ibuki': ["She's fast: keep her at the tip of your legs","Her health is low: one long combo goes a long way"],
    'Elena|Ken': ["Respect his cr.MK into SA3 at your poke range","Bait the Shoryuken before you go in"],
    'Elena|Makoto': ["Keep her out: she walks slowly and must dash in","Don't get thrown in the corner: Karakusa combos stun you fast"],
    'Elena|Necro': ["Your legs match his reach: whiff-punish his pokes"],
    'Elena|Oro': ["Poke him at range and anti-air his flips","Block his Tengu Stone pressure patiently instead of mashing"],
    'Elena|Q': ["Keep pressure on so he can't taunt","He's big and slow: your pokes hit him easily"],
    'Elena|Remy': ["Jump or parry his fireballs and get in","He has little up close: stay on him"],
    'Elena|Ryu': ["Respect his anti-airs: don't jump in from his sweet spot"],
    'Elena|Sean': ["Poke him out and punish his tackles","Heal when he's far away: he can't punish it from there"],
    'Elena|Twelve': ["Stay patient: he wins when you chase"],
    'Elena|Urien': ["Parry his tackles and headbutts","Stay out of the corner against Aegis"],
    'Elena|Yang': ["Block the slashes and punish the gap"],
    'Elena|Yun': ["Block during Genei Jin and wait for a real gap"],
    'Hugo|Akuma': ["His health is the lowest: one SPD or Gigas Breaker does huge damage","Parry the air fireballs; don't let him chip you from far away"],
    'Hugo|Alex': ["Your grabs reach further than his: walk him down and SPD","He's slow to recover too: whiff-punish his big moves"],
    'Hugo|Chun-Li': ["A very hard one: parry her cr.MK and walk in, don't jump at her","Once she's in grab range, SPD: that's where you win"],
    'Hugo|Dudley': ["His approach is direct: walk him down and grab","Anti-air his jumps with j.HP or an anti-air grab"],
    'Hugo|Elena': ["Walk her down and parry her long legs","Grab her on wakeup: she has little to stop it"],
    'Hugo|Hugo': ["Whoever lands the first SPD takes a big lead: watch the walk-in","Jump when he whiffs a grab and punish"],
    'Hugo|Ibuki': ["She's fast and small: anti-air her jumps and grab her on wakeup","Her health is low: two SPDs end the round"],
    'Hugo|Ken': ["Parry his fireballs and walk forward","Grab him on wakeup when he has no meter for a reversal"],
    'Hugo|Makoto': ["She has to come close too: grab her when she does","Respect her damage up close: don't stand still in Karakusa range"],
    'Hugo|Necro': ["His long limbs keep you out: parry them and walk in","Up close, SPD: he has little to stop it"],
    'Hugo|Q': ["A battle of the big ones: SPD him whenever he's close","Pressure him so he can't taunt"],
    'Hugo|Remy': ["Parry his fireballs and walk forward","Once you're in, he has little to stop the SPD"],
    'Hugo|Ryu': ["Grab him when he has no meter for a reversal"],
    'Hugo|Twelve': ["He air dashes away: walk him to the corner","Grab him whenever he lands close"],
    'Hugo|Urien': ["Stay out of the corner against Aegis"],
    'Hugo|Yang': ["His health is low: two SPDs end the round"],
    'Hugo|Yun': ["Walk him down before Genei Jin"],
    'Ibuki|Akuma': ["You both have tiny health: play for the first knockdown, then run your mixups","Dash under high air fireballs instead of blocking them"],
    'Ibuki|Alex': ["Stay out of his grab range; your speed keeps him guessing","He's slow to get up and defend: knock him down and mix him up"],
    'Ibuki|Chun-Li': ["She out-pokes you on the ground: get in with jumps and Kunai","Respect SA2: don't do unsafe moves when she has it"],
    'Ibuki|Dudley': ["Get a knockdown and run your mixups: he has no strong meterless reversal","Stay out of the corner, where his 50/50 into super is strongest"],
    'Ibuki|Elena': ["Get past her long legs with jumps and dashes, then mix her up","Punish Healing with your longest combo"],
    'Ibuki|Hugo': ["Stay out of SPD range: poke and move","He's huge: your combos and crossups land easily"],
    'Ibuki|Ibuki': ["Whoever lands the first knockdown runs the mixups: fight for it","You both have low health: one good guess is a big lead"],
    'Ibuki|Ken': ["Bait the Shoryuken before you go for mixups on his wakeup","Respect his cr.MK into SA3 at mid range"],
    'Ibuki|Makoto': ["Stay out of her grab range: Karakusa combos stun you fast","Get the first knockdown: she has no reversal without meter"],
    'Ibuki|Necro': ["Get past his long limbs with speed","Mix him up up close: he's weak there"],
    'Ibuki|Oro': ["Pressure him before he can set up Tengu Stone"],
    'Ibuki|Q': ["He's slow: knock him down and keep him guessing","Pressure him so he can't taunt"],
    'Ibuki|Remy': ["Jump over his fireballs and get in","Up close he has little: stay on him"],
    'Ibuki|Ryu': ["Bait the Shoryuken before you mix him up","Get past his fireballs with jumps and dashes"],
    'Ibuki|Sean': ["Out-move him and run your mixups"],
    'Ibuki|Twelve': ["Corner him and mix him up: he struggles to get out"],
    'Ibuki|Urien': ["Stay out of his corner Aegis setups","Your speed beats his slow moves: whiff-punish them"],
    'Ibuki|Yang': ["You're both fast with low health: be patient and punish first","Punish the end of his Mantis Slashes"],
    'Ibuki|Yun': ["Block during Genei Jin and wait for a real gap"],
    'Ken|Akuma': ["His health is the lowest: one cr.MK into SA3 nearly kills him","Parry the air fireballs instead of chasing him"],
    'Ken|Alex': ["Poke him with cr.MK and confirm into SA3","Keep him out: up close his damage is huge"],
    'Ken|Dudley': ["Win the ground with cr.MK: he has no good low poke","Avoid the corner, where his mixups into super are strongest"],
    'Ken|Elena': ["Out-poke her and punish Healing","Crouch: some of her combos whiff on crouching opponents"],
    'Ken|Hugo': ["Fireballs and pokes keep him out","Stay out of SPD range; a careless Shoryuken is a free grab for him"],
    'Ken|Ibuki': ["Stop her approach with pokes and anti-airs","Her health is low: one SA3 confirm hurts a lot"],
    'Ken|Ken': ["Whoever lands cr.MK into SA3 first takes a big lead: watch the range","Bait each other's Shoryuken on wakeup"],
    'Ken|Makoto': ["Keep her out with pokes and fireballs: she walks slowly"],
    'Ken|Necro': ["Get past his long limbs and pressure him","He's weak up close: stay on him"],
    'Ken|Oro': ["Poke him and anti-air his flips","Block his Tengu Stone pressure patiently"],
    'Ken|Q': ["Keep pressure on so he can't taunt"],
    'Ken|Remy': ["Parry his fireballs and close in","Up close he has little: stay on him"],
    'Ken|Ryu': ["Win the ground and bait his Shoryuken","Parry his fireballs at mid range"],
    'Ken|Sean': ["Out-poke him and punish his tackles","Your SA3 punishes almost every mistake he makes"],
    'Ken|Twelve': ["Corner him: he struggles to get out"],
    'Ken|Urien': ["Parry his tackles and headbutts","Stay out of the corner against Aegis"],
    'Makoto|Akuma': ["His health and stun are the lowest: one Karakusa combo can stun him","Anti-air his jumps instead of chasing the air fireballs"],
    'Makoto|Alex': ["He's slow: dash in and pressure him","Respect his damage up close: don't get thrown twice"],
    'Makoto|Chun-Li': ["She keeps you out: get in with parries and Hayate","Respect SA2: don't do unsafe moves when she has it"],
    'Makoto|Dudley': ["Up close you both hit hard: get there first","Avoid the corner, where his mixups are strongest"],
    'Makoto|Elena': ["Get past her legs and pressure her"],
    'Makoto|Hugo': ["He's huge: your combos and stun land easily"],
    'Makoto|Ibuki': ["Her health is low: one Karakusa combo hurts a lot","Stop her mixups before they start: get the first knockdown"],
    'Makoto|Ken': ["Get in with Hayate and parries","Bait his Shoryuken before you go in on wakeup"],
    'Makoto|Makoto': ["Whoever lands Karakusa first gets the stun: be careful up close"],
    'Makoto|Necro': ["Get past his long limbs and pressure him"],
    'Makoto|Oro': ["Pressure him before he sets up Tengu Stone"],
    'Makoto|Q': ["He's slow: pressure him and go for stun"],
    'Makoto|Remy': ["Parry his fireballs and get in"],
    'Makoto|Ryu': ["Get past his fireballs with parries and Hayate"],
    'Makoto|Sean': ["Pressure him: he has few ways out"],
    'Makoto|Urien': ["Get past his tackles with parries"],
    'Makoto|Yang': ["His health is low: one stun combo can end it"],
    'Makoto|Yun': ["Block during Genei Jin and wait for a real gap"],
    'Necro|Akuma': ["Poke him from the tip of your limbs: his lowest health melts to chip and whiff punishes","Save SA1 (Magnetic Storm) for his jumps and Demon Flips"],
    'Necro|Alex': ["Your limbs out-range all his pokes: poke, then back away","Magnetic Storm or an anti-air stops his jump-ins: up close his damage is huge"],
    'Necro|Chun-Li': ["Her far HP and cr.MK beat your limbs at mid range: poke from further out, or get in","Don't stick out a long limb when she has SA2: it's a free punish"],
    'Necro|Dudley': ["He has no good low poke: your long lows beat his approach","Anti-air his jumps; his arc is easy to read"],
    'Necro|Elena': ["Your limbs match her legs: whiff-punish her pokes","Punish Healing with Electric Blast or a full combo"],
    'Necro|Hugo': ["Your reach is the whole matchup: poke him and never stand in SPD range","He's huge: your combos land easily when he whiffs"],
    'Necro|Ibuki': ["Her health is low: every poke and whiff punish adds up","Magnetic Storm catches her jumps and Kunai approaches"],
    'Necro|Ken': ["Poke from beyond his cr.MK range so SA3 can't reach you","Don't jump at him: Shoryuken beats it"],
    'Necro|Makoto': ["She walks slowly: your limbs keep her out, so poke her as she walks in","Up close she wins: anti-air her jumps and stop her dashes"],
    'Necro|Necro': ["Whoever controls the range wins: whiff-punish his limbs","You're both weak up close: when he whiffs, dash in"],
    'Necro|Oro': ["Poke him at range: he has to flip or jump to get in, so anti-air it","Block his Tengu Stone pressure patiently instead of mashing"],
    'Necro|Q': ["He's slow and big: your limbs hit him from far away","Pressure him from range so he can't taunt for free"],
    'Necro|Remy': ["Your limbs out-range his low fireball game at mid range: parry, then poke","Bait his flash kick before you jump"],
    'Necro|Ryu': ["Parry his fireballs at range, then poke","Respect his Shoryuken when you jump"],
    'Necro|Sean': ["Your reach beats his: poke and whiff-punish"],
    'Necro|Twelve': ["Magnetic Storm and anti-airs catch his air dashes","Your limbs keep him off the ground"],
    'Necro|Urien': ["Your limbs out-range his tackles: poke as he comes","Stay out of the corner against Aegis"],
    'Necro|Yang': ["Your limbs stop his dash-ins and slashes from far away"],
    'Necro|Yun': ["Poke him before Genei Jin so he can't build meter for free","During Genei Jin, block and wait: don't stick out limbs"],
    'Oro|Akuma': ["His health is the lowest: one Tengu Stone combo ends the round","Oni Yanma (DP) and anti-airs stop his Demon Flips"],
    'Oro|Alex': ["Use your flips and jumps to stay out of his grab range","Tengu Stone pressure keeps him blocking: he's slow to escape it"],
    'Oro|Chun-Li': ["She out-pokes you: don't trade pokes, build meter for Tengu Stone","A whiffed Oni Yanma is a free SA2 for her"],
    'Oro|Dudley': ["Anti-air his jumps with Oni Yanma","Avoid the corner, where his mixups into super are strongest"],
    'Oro|Elena': ["Punish Healing with Tengu Stone or a full combo","Your flips get past her long legs"],
    'Oro|Hugo': ["Stay away and let Tengu Stone do the work","Never stand in SPD range: jump or flip away"],
    'Oro|Ibuki': ["Her health is low: one Tengu Stone combo ends the round","Anti-air her jumps and Kunai approaches"],
    'Oro|Ken': ["Don't whiff at his cr.MK range: SA3 punishes","Bait his Shoryuken before your Tengu Stone mixups"],
    'Oro|Makoto': ["Keep her out: she walks slowly and must dash in","Don't get thrown in the corner: Karakusa combos stun you"],
    'Oro|Necro': ["Flip and jump past his long limbs","He's weak up close: pressure him there"],
    'Oro|Oro': ["Whoever sets up Tengu Stone first runs the round","Block the stones patiently instead of mashing"],
    'Oro|Q': ["He's slow: Tengu Stone pressure keeps him blocking","Keep pressure on so he can't taunt"],
    'Oro|Remy': ["Up close he has little to stop your pressure"],
    'Oro|Ryu': ["Parry his fireballs and get in","Bait the Shoryuken before your mixups"],
    'Oro|Sean': ["Your pressure is much stronger: stay on him"],
    'Oro|Twelve': ["Corner him and keep the pressure on"],
    'Oro|Urien': ["Parry his tackles and headbutts","Stay out of the corner against Aegis"],
    'Oro|Yang': ["His health is low: Tengu Stone pressure ends it fast"],
    'Oro|Yun': ["Block during Genei Jin and wait for a real gap"],
    'Q|Akuma': ["His health is the lowest: your command grab and combos take huge chunks","Taunt when he's far away: it raises your defense and he can't punish it there"],
    'Q|Alex': ["Taunt at range to build defense before he gets in","You're both slow: whiff-punish his big moves"],
    'Q|Chun-Li': ["She out-pokes you badly: parry her pokes and dash in","Don't do unsafe dash attacks when she has SA2"],
    'Q|Dudley': ["Taunt when he's far away to build defense against his combos"],
    'Q|Elena': ["Punish Healing with a full combo","Parry her long legs and dash in"],
    'Q|Hugo': ["He's huge and slow: your dash attacks hit him easily"],
    'Q|Ibuki': ["Her health is low: your grabs and combos hurt","Anti-air her jumps and Kunai approaches"],
    'Q|Ken': ["Respect his cr.MK into SA3: don't dash in at his poke range","Bait the Shoryuken before you go for the grab"],
    'Q|Makoto': ["Taunt at range: she walks slowly","Don't get thrown in the corner"],
    'Q|Necro': ["Parry his long limbs and dash in"],
    'Q|Oro': ["Block his Tengu Stone pressure"],
    'Q|Q': ["Taunt when you can to build defense","Whoever lands the first grab takes the lead"],
    'Q|Remy': ["Parry his fireballs and dash in","Up close he has little: grab him"],
    'Q|Ryu': ["Parry his fireballs and dash in","Bait the Shoryuken before you grab"],
    'Q|Sean': ["Your damage is higher: play solid"],
    'Q|Yang': ["His health is low: a grab and a combo hurt a lot"],
    'Q|Yun': ["Block during Genei Jin and wait for a real gap"],
    'Remy|Akuma': ["His air fireballs beat your ground fireballs: don't just zone","Anti-air his jumps with your flash kick"],
    'Remy|Alex': ["Zone him with high and low fireballs: he has to parry each one to get in","Don't let him get close: you have little up close"],
    'Remy|Chun-Li': ["She out-pokes you and walks through slow fireballs: mix high and low"],
    'Remy|Dudley': ["Zone him with fireballs: he has to walk through them","Anti-air his jumps with flash kick"],
    'Remy|Elena': ["Her long legs beat your pokes: stay further out"],
    'Remy|Hugo': ["Zone him with fireballs: he's slow to get in"],
    'Remy|Ibuki': ["Anti-air her jumps with flash kick","Her health is low: chip and fireballs add up"],
    'Remy|Ken': ["Mix high and low fireballs so he can't parry them all"],
    'Remy|Makoto': ["Keep her out with fireballs: she walks slowly","Anti-air her jumps with flash kick"],
    'Remy|Necro': ["Out-zone him: his limbs don't beat fireballs"],
    'Remy|Q': ["Pressure him so he can't taunt"],
    'Remy|Remy': ["Whoever gets in first takes the lead"],
    'Remy|Ryu': ["Mix high and low fireballs so he can't parry them all on one guess"],
    'Remy|Twelve': ["Anti-air his air dashes with flash kick"],
    'Remy|Yang': ["Anti-air his dive kicks with flash kick"],
    'Remy|Yun': ["Anti-air his dive kicks with flash kick"],
    'Ryu|Alex': ["Fireballs and st.MK keep him out: make him parry his way in","Shoryuken his jumps; up close his damage is huge"],
    'Ryu|Chun-Li': ["She out-pokes you: don't throw fireballs at mid range when she has SA2","Win with anti-airs and patience, not by trading pokes"],
    'Ryu|Dudley': ["He has no good low poke: your cr.MK and fireballs control the ground","Anti-air his jumps; avoid the corner, where his 50/50 into super kills"],
    'Ryu|Elena': ["Fireballs and pokes beat her approach","Punish Healing with a full combo or SA2"],
    'Ryu|Hugo': ["Fireballs keep him out: make him parry every one","Never whiff Shoryuken near him: it's a free SPD"],
    'Ryu|Ibuki': ["Shoryuken her jumps and Kunai approaches","Her health and stun are low: Denjin and SA2 punishes hurt"],
    'Ryu|Ken': ["He wins up close: keep him out with fireballs and st.MK","Respect his cr.MK into SA3 at mid range"],
    'Ryu|Necro': ["Fireballs beat his long pokes: zone him","Get in when he whiffs: he's weak up close"],
    'Ryu|Oro': ["Anti-air his flips with Shoryuken","Block his Tengu Stone pressure patiently"],
    'Ryu|Q': ["Fireballs and pokes keep him out: he's slow","Pressure him so he can't taunt"],
    'Ryu|Remy': ["Parry his fireballs; he has little up close"],
    'Ryu|Ryu': ["Whoever controls the fireball range wins: parry his fireballs"],
    'Ryu|Sean': ["Out-zone him: your fireball game is stronger"],
    'Ryu|Urien': ["Parry his tackles and headbutts","Stay out of the corner against Aegis"],
    'Ryu|Yun': ["Block during Genei Jin and Shoryuken his dive kicks"],
    'Sean|Akuma': ["His health is the lowest: one tackle mixup or super hurts","Don't trade fireballs: his air fireballs beat yours"],
    'Sean|Alex': ["Stay out of his grab range and poke","Anti-air his jumps with Dragon Smash"],
    'Sean|Chun-Li': ["She out-pokes you: be patient and look for a parry"],
    'Sean|Dudley': ["Anti-air his jumps with Dragon Smash"],
    'Sean|Hugo': ["He's huge: your combos land easily"],
    'Sean|Makoto': ["Keep her out: she walks slowly","Don't get thrown in the corner"],
    'Sean|Oro': ["Block his Tengu Stone pressure"],
    'Sean|Q': ["Keep pressure on so he can't taunt","He's slow: your tackles mix him up"],
    'Sean|Remy': ["Parry his fireballs and get in"],
    'Sean|Sean': ["Whoever lands the tackle mixup first takes the lead","Anti-air jumps with Dragon Smash"],
    'Twelve|Akuma': ["Your air mobility can't beat his air fireballs: stay grounded more","His health is the lowest: one X.C.O.P.Y. combo hurts"],
    'Twelve|Alex': ["Use your air dash to stay out of his grab range","Don't get cornered: his mixups there are strong"],
    'Twelve|Chun-Li': ["She anti-airs and out-pokes you: be very patient"],
    'Twelve|Dudley': ["His Jet Upper beats your air approach: get in on the ground"],
    'Twelve|Hugo': ["Stay in the air and out of SPD range","He's huge: your air attacks hit him easily"],
    'Twelve|Ken': ["Don't air dash in carelessly: Shoryuken beats it"],
    'Twelve|Makoto': ["Keep her out with air mobility: she walks slowly","Don't get thrown in the corner"],
    'Twelve|Oro': ["Block his Tengu Stone pressure"],
    'Twelve|Q': ["Pressure him so he can't taunt"],
    'Twelve|Ryu': ["Respect his Shoryuken: don't air dash in carelessly"],
    'Urien|Akuma': ["His health is the lowest: one Aegis setup or tackle combo takes a huge chunk","Parry his Demon Flips and anti-air his jumps"],
    'Urien|Alex': ["Your tackles and headbutts out-range his pokes","Aegis setups work well: he's big and slow to escape"],
    'Urien|Chun-Li': ["She out-pokes you at range: get her into the corner","Respect SA2: don't do unsafe tackles when she has it"],
    'Urien|Dudley': ["Your reach beats his: keep him at tackle range","Corner him and run Aegis setups"],
    'Urien|Elena': ["Corner her and run Aegis setups"],
    'Urien|Hugo': ["He's huge: Aegis combos land easily"],
    'Urien|Ibuki': ["Her health is low: one Aegis setup ends the round"],
    'Urien|Ken': ["Bait the Shoryuken before your mixups"],
    'Urien|Makoto': ["Keep her out with tackles: she walks slowly","Don't get thrown in the corner"],
    'Urien|Necro': ["Get past his long limbs with tackles"],
    'Urien|Oro': ["Block his Tengu Stone pressure"],
    'Urien|Q': ["He's slow: Aegis setups work well","Pressure him so he can't taunt"],
    'Urien|Remy': ["Parry his fireballs and get in"],
    'Urien|Ryu': ["Bait the Shoryuken before your mixups"],
    'Urien|Sean': ["Your reach and damage are much higher: play solid"],
    'Urien|Twelve': ["Corner him and run Aegis setups"],
    'Urien|Urien': ["Whoever gets the corner first runs Aegis"],
    'Urien|Yang': ["His health is low: one Aegis setup ends it"],
    'Yang|Akuma': ["You both have low health: play for the first knockdown","Dive kick over his ground fireballs, but watch the air fireballs"],
    'Yang|Alex': ["Your speed beats his slow moves: dash in, hit, get out"],
    'Yang|Chun-Li': ["She out-pokes you: get in with dive kicks and dashes"],
    'Yang|Dudley': ["Stay out of the corner against his mixups","Dive kick pressure works on him"],
    'Yang|Elena': ["Get past her legs with dive kicks"],
    'Yang|Hugo': ["Your speed keeps you out of SPD range","He's huge: your slashes and combos land easily"],
    'Yang|Ibuki': ["You're both fast with low health: be patient"],
    'Yang|Ken': ["Don't end slashes where Shoryuken punishes"],
    'Yang|Makoto': ["Keep her out: she walks slowly","Don't get thrown in the corner"],
    'Yang|Oro': ["Block his Tengu Stone pressure"],
    'Yang|Q': ["He's slow: dive kick pressure works","Pressure him so he can't taunt"],
    'Yang|Ryu': ["Don't dive kick into his Shoryuken range"],
    'Yang|Sean': ["Your speed and pressure are much stronger"],
    'Yang|Yang': ["Whoever lands the first dive kick combo takes the lead"],
    'Yun|Akuma': ["His health is the lowest: one Genei Jin combo can end the round","Dive kick over his ground fireballs, but watch the air fireballs"],
    'Yun|Alex': ["Your speed beats his slow moves: dive kick pressure and stay out of grab range","Genei Jin destroys him: he's big and slow to block it"],
    'Yun|Chun-Li': ["Your hardest: she out-pokes you, so build Genei Jin safely","Respect SA2: don't do unsafe moves when she has it"],
    'Yun|Dudley': ["Stay out of the corner against his mixups","Dive kick pressure works on him"],
    'Yun|Elena': ["Get past her legs with dive kicks"],
    'Yun|Hugo': ["Your speed keeps you out of SPD range","Genei Jin combos land easily on him"],
    'Yun|Ibuki': ["You're both fast with low health: be patient"],
    'Yun|Ken': ["Don't dive kick into his Shoryuken range"],
    'Yun|Makoto': ["Keep her out: she walks slowly","Don't get thrown in the corner"],
    'Yun|Oro': ["Block his Tengu Stone pressure"],
    'Yun|Q': ["He's slow: dive kick pressure works","Pressure him so he can't taunt"],
    'Yun|Ryu': ["Don't dive kick into his Shoryuken range"],
    'Yun|Sean': ["Your speed and pressure are much stronger"],
    'Yun|Yun': ["Whoever gets Genei Jin first takes the lead","Block during his Genei Jin and wait for a real gap"]
});
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
    // your own 3rd Strike busts (own-art.js) first, then the big art (3rd Strike), the small face, the initial
    const oa = fc && fc.modules ? fc.modules.get('own-art') : null, own = e && oa && oa.face ? oa.face(rom, e.name) : '';
    const img = own ? `<img class="own${oa.isOval && oa.isOval(rom, e.name) ? ' oval' : ''}" src="${esc(own)}" alt="">` : e ? `<img${e.art ? ` class="art"${e.fo ? ` style="--fo:${esc(e.fo)}"` : ''}` : ''} src="${esc(e.face)}"${e.art ? ` data-alt="${esc(e.small)}"` : ''} alt="" loading="lazy" referrerpolicy="no-referrer" ` +
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
.fc-mu-face img.own { object-position: 50% 0; }
.fc-mu-face img.own.oval { object-position: 50% 45%; transform: scale(1.32); }
.fc-mu-face img.art { object-position: 50% 0; transform: scale(1.6); transform-origin: var(--fo, 50% 8%); }
.fc-mu-face b { display: none; color: #fff; font-weight: 800; font-size: calc(var(--s) * .44); line-height: 1; }
.fc-mu-face.nof b { display: block; }
/* (the initial only without a picture: screens that style their own <b>, like the VS name plates, mustn't bring it back) */
.fc-mu-face:not(.nof) > b { display: none !important; }
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

// every character of a game, in the guide's order ([] for a game it doesn't know)
const charsOf = (rom) => { const g = gameOf(rom); return g ? Object.keys(g.chars) : []; };
const api = { find, tips, hasPair, faceHtml, cardHtml, gameOf, charsOf, games: () => GAMES.map(g => ({ id: g.id, name: g.name })) };

function start(f) {
    fc = f;
    fc.ui.style('fcMuStyle', CSS);
    fc.own(() => fc.ui.style('fcMuStyle', null));
    return api;
}

module.exports = { id: 'matchup-guide', name: 'Matchup guide', start, _test: { GAMES, resolve, find, tips, hasPair, faceHtml, cardHtml, imgUrl, thumbUrl, gameOf, charsOf } };
