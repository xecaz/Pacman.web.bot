# Pac-Man Bot for pacman.live

A Chrome extension that plays Pac-Man on [pacman.live](https://pacman.live/play.html) on its own.
Click the toolbar icon, press **▶ NEW TURBO GAME**, and watch it clear level after level.

Best results so far, in Turbo mode:

| Run | Levels cleared | Game over on | Notes |
|---|---|---|---|
| T1 | 60 | level 61 | Turbo high score 174,780 |
| T2 | 52 | level 53 | 2 dots left; average 111 key presses per level |

In normal mode, the best run reached level 8 (high score 26,220).

## Install

The extension is not on the Chrome Web Store. You load it from this folder:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (`pacbot-ext`).
4. Optional: pin the icon. Click the puzzle-piece menu, then the pin next to **Pac-Man Bot**.
5. Open or reload https://pacman.live/play.html.

After changing any file here, click ↻ on the extension's card in `chrome://extensions`, then reload the game tab.

The extension only runs on `https://pacman.live/*`. It asks for no extra permissions and has no dependencies.

## Use

Click the Pac-Man icon in the toolbar:

| Button | What it does |
|---|---|
| **▶ NEW TURBO GAME** | Starts a Turbo game from the "choose your game" screen and plays it. |
| **▶ NEW NORMAL GAME** | The same, in normal mode. |
| **▶ PLAY CURRENT GAME** | Takes over a game that is already running. |
| **■ STOP** | Stops the bot. Pac-Man stops taking input from it. |

The icon shows a green **ON** badge while the bot is playing.

The game pauses whenever its window loses focus. The popup closes itself after a start button, and the bot waits
until the game window has focus again before it uses the menus. If the popup says "Waiting", click the game.

### On the page

While the bot plays, the page shows:

- **A banner** at the top: "Xecaz Pacman bot is playing, enjoy!".
- **The key panel** (top right): the number of key presses on this level and the latest direction.
  It flashes green on every press.
- **The status panel**: level, lives, deaths, and the bot's state (TURBO / PLAY / WAIT / OFF).
- **The level log**: one line per cleared level with the number of key presses it took. Fewer is better.

### From the DevTools console

The bot is also available as `__pac` in the page:

```js
__pac.newTurboRun()   // new Turbo game from the menu
__pac.newRun()        // new normal game
__pac.attach()        // take over the current game
__pac.stop()
__pac.levelLog        // [{level, keys}, ...]
```

## How it works

Everything runs inside the page. The bot reads the screen and sends keyboard events, the way a player would. It
does not change the game's code or memory.

**1. Seeing the game.** The game's state is hidden inside its own code, so the bot watches what the game draws.
The bot wraps the canvas `drawImage` call to record every sprite drawn in a frame:
- each sprite's position on the sprite sheet tells what it is: Pac-Man, Blinky, Pinky, Inky, Clyde, a frightened
  or flashing ghost, eyes, or fruit;
- its on-screen position gives its maze tile.

Dots and power pellets are checked by reading pixels at each dot's location.

**2. Fitting any screen size.** The game scales itself to fit the window and redraws at the new size whenever the
window changes: a different monitor, browser zoom, a toolbar or infobar appearing, or a resize mid-game. The bot
works out the same scale on every frame, so all its pixel measurements follow the game.

**3. Predicting the ghosts.** The game is [shaunew/Pac-Man](https://github.com/shaunew/Pac-Man), and its source
shows exactly how ghosts move. The bot simulates those rules:
- **Targets.**
  - Blinky chases Pac-Man's tile.
  - Pinky aims 4 tiles ahead of Pac-Man.
  - Inky uses a point mirrored around Blinky.
  - Clyde chases until he is close, then retreats to his corner.
- **Ghost quirks.** The original "up" targeting bug, the tiles where ghosts can't turn up, and slowdown in the
  tunnel.
- **Mode timer.** The chase/scatter schedule for the current level, including the moments when all ghosts reverse.
- **Speeds.** Per-level speeds for Pac-Man and the ghosts, taken from the game's speed table.
- **Elroy.** Blinky's speed-up when few dots remain.
- **Frightened time.** How long ghosts stay blue on the current level.
- **Turbo.** Pac-Man moves twice as fast and doesn't slow down to eat; ghosts are unchanged.

**4. Choosing a move.** At each decision the bot:
1. lists every route Pac-Man could take over the next ~29 tiles, branching at each junction;
2. simulates each route against the ghost model, under each likely chase/scatter scenario;
3. keeps each route's **worst** outcome;
4. picks the direction with the best worst case.

Routes are scored as follows:

| Event | Score |
|---|---|
| Dying | Huge penalty (dying later is less bad than dying sooner) |
| Each dot eaten | Points |
| Each ghost eaten while blue | Points, more on levels with long frightened time |
| Power pellet | Kept as bait until at least 2 ghosts are close and the blue time is long enough to catch them; a penalty before that |
| Ending near the fruit while it is shown | Bonus |
| Distance to the nearest remaining dot | Penalty |
| Keeping direction / reversing | Small bonus / penalty, so it doesn't jitter |

**5. Safety layers** around the simulation, added after watching real deaths:
- **Veto:** never step next to a hunting ghost if another way out is safe.
- **Flashing ghosts are dangerous:** they are about to turn back into hunters.
- **Pre-advance:** a ghost already past the middle of its tile counts as being on the next tile.
- **Ghost house:** a ghost inside the house is treated as already at the door.
- **Last dots:** a high value on the final 4 dots, so it finishes the level instead of circling.
- **Doomed fallback:** if every route can die in some scenario, choose by the most likely scenario instead.
- **Watchdog:** restarts the bot's loop if it ever stops during a game (it once froze and lost two lives).

**6. Pressing keys.** The game ignores a key press while that key still counts as held. Before each new direction
the bot releases the old key and the new one, then presses the new one. It only presses when the direction
changes.

**7. Menus.** The game's menus select whichever button is under the mouse cursor. While the bot navigates a menu
with the keyboard, it ignores real mouse movement over the game and clears any hovered button first. Where your
mouse rests doesn't matter.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest (Manifest V3). Runs the scripts on pacman.live only. |
| `pacbot.js` | The bot: screen reading, ghost simulation, decisions, input, page panels. Runs in the page. |
| `bridge.js` | Passes messages between the popup and the bot. Content scripts that run in the page can't talk to the extension directly. |
| `popup.html`, `popup.js` | The toolbar popup with the start/stop buttons. |
| `background.js` | Sets the green **ON** badge on the icon. |
| `icons/` | Toolbar icons. |

## Tuning

These settings can be changed live from the console:

| Setting | Default | Meaning |
|---|---|---|
| `__pac.SIM.HORIZON` | 26 | How many steps ahead to simulate. |
| `__pac.SIM.HIT_R` | 1.3 | Collision distance in tiles. Larger is more careful. |
| `__pac.GHOST_MARGIN` | 1.04 (`__pac.MARGIN`; `L1_GHOST` 1.03 on level 1), tuned in the simulator | Treats ghosts as this much faster than they are, to keep more distance. Reset at every decision from the level, so change `__pac.MARGIN` instead. |
| `__pac.ADVANCE_FRAC` | 0.2 | How far past a tile's middle a ghost counts as on the next tile. |
| `__pac.dotValue`, `__pac.distW`, `__pac.pelletValue`, `__pac.fruitTerm` | | Scoring functions. |

## Known weaknesses

- **Last few dots:** it sometimes circles over the last dots, which can cost a life. Run T2 ended with 2 dots left.
- **Pincers:** two ghosts closing in from both sides, or a dead-end corner, can still trap it on fast levels.
- **Mid-game takeover:** **PLAY CURRENT GAME** starts counting from level 1 and doesn't know the ghost mode timer,
  so it plays more cautiously until the next life or level. Set `__pac.stats.levels` (levels already cleared) for
  correct speeds.
- **Ms. Pac-Man and Cookie-Man:** these games have other mazes and are not supported.

## Credits

The game is [shaunew/Pac-Man](https://github.com/shaunew/Pac-Man) (GPL), as hosted on pacman.live. This bot is
a separate fan project: it only reads the screen and sends key presses.
