# Game 05 v2: Chapter One content plan (ids are binding)

Every lane uses these ids exactly. Names and prose are original. Types are in `lib/game-05/contract.ts`.

## Story shape

Wren (default name, editable) lives with Grandpa Oren, the village's old warden, in Larkmoor on the shore of the lake. Under the valley sleeps the Hollow King, held by three wardstones. Tremors crack the first one, down in the Barrow beyond the Mossgloam Wood, and creatures spill into the fields. Oren's leg is bad, so he gives Wren his blade. Chapter One ends when Wren kills the Thornmother, which is choking the wardstone. As the stone relights, a hooded figure is seen taking a shard and says "One of three." Back in the hall, Maren names the other two stones. Chapter Two hook.

Tone: warm and sincere, small jokes, short lines (at most 3 lines of about 38 characters per box).

## Maps and exits

| Map | Exits |
|---|---|
| `home` (12×10) | door (south wall, x 6) → `larkmoor` at Wren's door |
| `larkmoor` (64×48) | doors → `inn`, `shop`, `smithy`, `tavern`, `hall`, `home`; south gate (bottom edge, x 30–33) → `southfold` north edge |
| `inn`, `shop`, `smithy`, `tavern`, `hall` | door (south) → `larkmoor` in front of that building |
| `southfold` (72×48) | north edge (x 30–33) → `larkmoor` south gate; east edge (y 22–25) → `mossgloam` west edge |
| `mossgloam` (64×64) | west edge (y 30–33) → `southfold`; barrow mouth (stairs, NE, about 52,8) → `barrow1` |
| `barrow1` (48×40) | stairs up (south, about 24,37) → `mossgloam` barrow mouth; stairs down behind the iron gate (north, about 24,3) → `barrow2` |
| `barrow2` (32×28) | stairs up (south, about 16,26) → `barrow1` north stairs |

Larkmoor layout: lake across the north with a sand shore and a dock (Dunn); Wren's house north-west with the training dummy in its yard; plaza in the centre with the fountain; elder's hall on a raised terrace north-centre (stairs); inn east of the plaza; item shop and smithy on the main street; tavern south-east; Lottie's sheep pen west; the old well south-west; south gate (Cato) at the bottom centre; flowers, fences, lamps, barrels.

## NPCs (`NpcDef.id` → name, where, role)

| id | Name | Where | Role |
|---|---|---|---|
| `oren` | Grandpa Oren | home | gives the blade, sends you to the dummy |
| `maren` | Elder Maren | hall | main quest giver |
| `bram` | Bram | inn | innkeeper: rest (free) flips day/night; Baker's Round stop |
| `tilda` | Tilda | shop | item shop; gives Feverroot |
| `hask` | Hask | smithy | armourer; Baker's Round stop |
| `rosa` | Rosa | tavern | rumours; a 5 g drink gives a hint |
| `pell` | Pell | larkmoor, by the bakery stall | gives the Baker's Round |
| `dunn` | Dunn | larkmoor dock | gives the Fisher's Rod |
| `lottie` | Lottie | larkmoor sheep pen | gives the Lost Lamb |
| `cato` | Cato | larkmoor south gate | guard; Baker's Round stop; lets you out once `metMaren` |
| `nessa` | Old Nessa | larkmoor, near the well (day) | mentions the lights at the well at night |
| `wellSpirit` | The Well Spirit | larkmoor well (night only) | gives Well Spirit |
| `pip` | Pip | larkmoor plaza | a child; lines change with progress |
| `villagerA`, `villagerB`, `villagerC` | Villagers | larkmoor | ambient lines |
| `lamb` | Lamb | southfold east pasture, then follows | escort follower |
| `hooded` | Hooded Figure | barrow2, after the boss | one line, then vanishes |
| `sheepA`, `sheepB`, `sheepC` | Sheep | larkmoor sheep pen | ambient, wander 1.5 tiles, "Baa." |

The bounty board is a prop (`sign`, id `bountyBoard`) in the plaza; reading it offers the next available bounty as a quest card.

## Flags (`SaveState.flags`)

`dressed`, `gotBlade`, `dummyDone`, `metMaren`, `gateOpen`, `wolvesCleared`, `bridgeLever`, `barrowGateOpen`, `leverB1`, `bossDown`, `wardstoneLit`, `sawHooded`, `chapterClear`, `lambHome`, `ringFound`, `rodFound`, `loaf_bram`, `loaf_hask`, `loaf_cato`, `drankRosa`.

## Quests

Main `wardstone` ("The First Wardstone"):
1. `dress`: "Open the chest by your bed" (flag `dressed`)
2. `oren`: "Talk to Grandpa Oren" (talk `oren`) → gives `wornBlade`, flag `gotBlade`
3. `dummy`: "Practise at the dummy" (flag `dummyDone`; a 3-hit combo on the dummy in the yard)
4. `maren`: "See Elder Maren at the hall" (talk `maren`) → flag `metMaren`, `gateOpen`
5. `southfold`: "Cross Southfold to the wood" (reach `mossgloam` west edge)
6. `grove`: "Drive the wolves from the grove" (flag `wolvesCleared`: the wolf wave at the flame barrier)
7. `barrow`: "Find the Barrow key" (collect `barrowKey`)
8. `thorn`: "Defeat the Thornmother" (flag `bossDown`)
9. `return`: "Return to Elder Maren" (talk `maren`) → `chapterClear`

Side (one active at a time; leaving a map never fails a quest):
- `feverroot` (giver `tilda`): collect 10 `feverroot` (cut grass drops it 35% while active). Reward 60 g, 2 `manaDraught`.
- `lostLamb` (giver `lottie`): `find` (reach the lamb in the southfold pasture), `lead` (flag `lambHome`: the follower reaches the pen). Reward `lambsBell` charm, 40 g.
- `bountyMoss` (bounty board): kill 8 `mossling`. Reward 80 g, 40 XP.
- `bountyTusk` (bounty board, minLevel 4): kill 1 `oldTusk` (elite boar in the southfold north-west thicket). Reward `boarhideHelm`, 150 g.
- `wellSpirit` (giver `wellSpirit`, night): `ring` (collect `silverRing` from its chest in `barrow1`), `give` (talk `wellSpirit` at night). Reward spell `thornbreak`, `travelersKnot` charm.
- `fishersRod` (giver `dunn`): collect `fishingRod` (chest by the collapsed bridge in `mossgloam`). Reward 2 `tonic`, 120 g.
- `bakersRound` (giver `pell`): talk `bram`, `hask`, `cato` (flags `loaf_*`), then talk `pell`. Reward `elixir`, 100 g.

## Items (ids)

Consumables: `herb`, `tonic`, `manaDraught`, `elixir`, `stoneskin`, `fury`, `fortune`, `quickstep`.
Key items: `feverroot`, `barrowKey`, `silverRing`, `fishingRod`, `loaves`.
Gear:
- head: `clothHood` (start), `leatherCap1..3`, `boarhideHelm` (quest), `boarCap1..3`, `bronzeHelm1`
- body: `clothTunic` (start, from the bedside chest), `leatherVest1..3`, `boarVest1..3`, `bronzeMail1`
- boots: `clothShoes` (start), `leatherBoots1..3`, `boarBoots1..3`, `bronzeGreaves1`
- weapon: `wornBlade` (Oren), `ironSword` (smithy), `emberBlade` (barrow1 chest, burn)
- charm: `travelersKnot` (quest), `wolfFang` (mossgloam den chest: +ATK −DEF), `lambsBell` (quest: gold find, +SPD)

## Monsters (ids)

`mossling` L1 hopper · `duskbat` L2 swooper · `bristleboar` L3 charger · `sporecap` L4 spore · `greywolf` L5 packWolf · `webspinner` L6 spitter · `barrowGuard` L7 shieldGuard · `thornmother` L9 boss (3 phases) · `thornling` L6 brood (hopper) · `oldTusk` L5 elite charger · `dummy` (training, never dies, no XP).

Placement: Southfold: mosslings, duskbats near trees, bristleboars in the open, sporecaps near the east edge, `oldTusk` in the NW thicket (only while `bountyTusk` is active). Mossgloam: greywolf packs, sporecaps, duskbats, webspinners near the barrow mouth; the grove wave = 5 greywolves (spawn id `groveWolves`, `once`), and clearing it sets `wolvesCleared`. Barrow1: webspinners, barrowGuards, duskbats. Barrow2: the Thornmother.

## Chests (ids → loot)

home: `c_home_bed` → `clothTunic`.
larkmoor: `c_lark_dock` → 30 g; `c_lark_hall` (behind the hall) → `herb` ×2.
southfold: `c_sf_pond` → 50 g; `c_sf_thicket` → `leatherCap2`; `c_sf_fence` → `stoneskin`.
mossgloam: `c_mg_den` → `wolfFang`; `c_mg_bridge` → `fishingRod` (a key item; collect goals count what is already in the bag, so finding it first completes that step as soon as Dunn gives the quest); `c_mg_stump` → `tonic`; `c_mg_falls` → `leatherBoots3`.
barrow1: `c_b1_key` → `barrowKey`; `c_b1_ring` → `silverRing`; `c_b1_ember` → `emberBlade`; `c_b1_side` → `fury`; `c_b1_gold` → 200 g.

## Gates

`g_grove` (flame, mossgloam, opens on `wolvesCleared`), `g_bridge` (thorns, mossgloam, opens on `bridgeLever`, the lever across the river reached by a fallen log path), `g_barrow` (iron, barrow1, opens with `barrowKey`; set `barrowGateOpen`), `g_b1_lever` (iron, barrow1, opens on `leverB1`).

## Shops

- `tildaShop` (items, keeper `tilda`): `herb`, `tonic`, `manaDraught`, `elixir`, `stoneskin`, `fury`, `fortune`, `quickstep`.
- `haskShop` (arms, keeper `hask`): `ironSword`, `leatherCap1..3`, `leatherVest1..3`, `leatherBoots1..3`, `boarCap1`, `boarVest1`, `boarBoots1` (boar tier after `metMaren`), `bronzeHelm1`, `bronzeMail1`, `bronzeGreaves1` (after `wolvesCleared`).

## Music by map

home/interiors `interior` · larkmoor `village` (night `villageNight`) · southfold `field` · mossgloam `forest` · barrow1 `dungeon` · barrow2 `boss` (after the boss dies: `dungeon`).

## Asset keys (binding for art, renderer, content)

- Hero sheet `hero`: anims `stand`, `walk`, `attack1`, `attack2`, `attack3`, `attack4`, `spin`, `cast`, `dodge`, `hurt`, `dead`, `raise` (item held overhead), each with `down`/`left`/`up` frames (`right` mirrors `left` unless given).
- Monsters `mon.<monsterId>` (elites reuse their base sheet with a tint: `oldTusk` uses `mon.bristleboar`, `thornling` has its own): anims `idle`, `walk`, `windup`, `attack`, `hurt`, `dead`, optional `special`.
- NPCs `npc.<npcId>` (villagers may share a sheet: `npc.villagerA` etc. are separate keys that can point at the same image): anims `stand`, `walk`.
- Props `prop.<PropKind>`; variants are anims `v0`, `v1`, … (single frame each, fps 0). Cut/broken props also have `cut`.
- Effects `fx.slash`, `fx.slashBig`, `fx.spin`, `fx.leaves`, `fx.dust`, `fx.hit`, `fx.coin`, `fx.sparkle`, `fx.ember`, `fx.frost`, `fx.thorn`, `fx.web`, `fx.spore`, `fx.heal`, `fx.levelUp`, `fx.poof`, `fx.flame` (gate), `fx.thornLine`.
- Icons `icon.<itemId>`, `icon.spell.<spellId>`, `icon.gold`; portraits `portrait.<npcId>` and `portrait.hero`.
- Ground swatches keyed by the Ground char (`g`, `G`, `d`, …).

## Audio cues (binding)

Music (`MusicId`): `title`, `village`, `villageNight`, `interior`, `field`, `forest`, `dungeon`, `boss`; stings `sting.victory`, `sting.levelUp`, `sting.gameOver`, `sting.chapterClear`, `sting.item`.
SFX: `swing1`, `swing2`, `swing3`, `spin`, `hit`, `hitCrit`, `hitHero`, `miss`, `cutGrass`, `cutBush`, `potBreak`, `coin`, `pickup`, `chestOpen`, `heal`, `cast.ember`, `cast.frost`, `cast.thorn`, `impact`, `dodge`, `levelUp`, `unlock`, `questStart`, `questDone`, `door`, `stairs`, `gateOpen`, `lever`, `ui.move`, `ui.ok`, `ui.back`, `ui.deny`, `buy`, `equip`, `die.small`, `die.big`, `boss.roar`, `boss.slam`, `wolf.howl`, `boar.charge`, `slime.hop`, `bat.flap`, `web.spit`, `spore.puff`, `guard.block`, `step.grass`, `step.stone`, `step.wood`, `step.dirt`, `step.water`, `step.cave`, `rest`, `text.blip`.
