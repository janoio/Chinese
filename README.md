# Chinese Poker Live - Phone Final Version

This version is made for phones and includes:
- 4-player live multiplayer
- spectators and queue
- bots
- green table with 4 seats/chairs
- card throwing animation
- card selection sounds
- strong smash sound when playing a hand
- installable phone app/PWA files
- Render deployment file

Read `STEP_BY_STEP_PHONE_PUBLIC.md` to publish it for friends.

# Chinese Poker Live

A real-time 4-player Chinese Poker / Big Two style browser game.

## What is included

- 4 players per table
- Live multiplayer using Socket.IO
- Extra players join as spectators
- Spectators cannot see player cards
- Spectators are kept in queue order
- If a player reaches 101 points, they lose and may continue watching
- First spectator in queue can take the open seat
- If 4 extra spectators are waiting, a new table is opened automatically
- Option to add bots when seats are empty
- Players select cards first, then press **Play hand**
- Wrong hand / wrong card messages are shown privately only to that player
- Pass button supported
- Cards sorted from 3 up to 2, with suit order ♦ ♣ ♥ ♠

## Rules implemented

Card power from weakest to strongest:

`3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A, 2`

Suit power from weakest to strongest:

`diamonds ♦, clubs/leaf ♣, hearts ♥, spades ♠`

The player with `3♦` starts the round. In this version, the first hand must include `3♦`.

Valid hands:

- Single: 1 card
- Pair: 2 cards with the same rank
- Triplet: 3 cards with the same rank
- 5-card poker hands:
  - Straight
  - Flush
  - Full house
  - Quads + 1 extra card
  - Straight flush

When the active play is single, all players must play singles until everyone passes. Same for pair, triplet, or 5-card hands.

Round scoring when a player finishes all cards:

- 1 to 4 cards left: cards × 1
- 5 to 9 cards left: cards × 2
- 10 to 13 cards left: cards × 3

The first player to reach 101 points loses.

## Run locally

Install Node.js 18 or later.

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

To test with friends on the same Wi-Fi, run on your laptop and share your local network IP, for example:

```text
http://192.168.1.20:3000
```

## Make it public online

GitHub Pages is not enough for this project because the game needs a live backend server. Use GitHub only for storing the code, then deploy it to a Node.js hosting service.

### Option A: Render

1. Create a new GitHub repository.
2. Upload all files from this folder.
3. Go to Render.
4. Create a new **Web Service**.
5. Connect your GitHub repository.
6. Use these settings:
   - Build command: `npm install`
   - Start command: `npm start`
7. Deploy.
8. Share the Render URL with your friends.

### Option B: Railway

1. Create a new GitHub repository.
2. Upload all files from this folder.
3. Go to Railway.
4. Create a new project from GitHub.
5. Select this repository.
6. Railway detects Node.js automatically.
7. Deploy and share the public URL.

## Files

```text
server.js              Main backend: rooms, tables, rules, bots, scoring
public/index.html      Browser page
public/style.css       Game design
public/client.js       Browser logic and Socket.IO client
package.json           Dependencies and start command
render.yaml            Optional Render blueprint
```

## Easy rule changes

Open `server.js` and edit these constants:

```js
const SUITS = ['D', 'C', 'H', 'S'];
const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const TARGET_SCORE = 101;
```

To allow the first player to play any hand, search for this line and remove it:

```js
if (table.firstMove && !ids.includes('3D')) return privateError(socketId, 'First hand must include 3♦.');
```

## Important note

This is a first complete playable version. The game rules you described are implemented, but card games often have small family-rule differences. After you test with friends, you can adjust the rules inside `server.js`.


## Phone / PWA version

This project is phone-friendly and installable as a Progressive Web App.

After you deploy it online, open the public link on your phone.

### Android
1. Open the link in Chrome.
2. Tap the three dots menu.
3. Tap **Install app** or **Add to Home screen**.
4. The game will appear like an app icon.

### iPhone
1. Open the link in Safari.
2. Tap the Share button.
3. Tap **Add to Home Screen**.
4. The game will appear like an app icon.

Important: the app can be installed on the phone, but live multiplayer still needs the online server. If the laptop is hosting `localhost` and the laptop is off, nobody can play. Deploy it on Render/Railway/Fly to keep it available from phones.


## V2 fixes
- Bots now choose singles, pairs, triplets, and 5-card hands when they lead.
- Phone table view is more compact so the green table is easier to see.
- There are two play buttons: **Play normal** and **Smash hand**.
- Normal play has a softer card sound. Smash hand has the strong table impact sound.


## V3 highest rule

When any player has only 1 card left, the player on his right must play the strongest legal hand on their turn.

The app now:
- shows a HIGHEST warning,
- says “highest” using phone/browser voice,
- blocks pass if the right-side player has any legal hand,
- blocks weaker hands and only accepts the strongest legal hand,
- makes bots follow the same rule.


## V4 end game fixes

- If all human players leave, the bots leave too and the table ends/reset automatically.
- If a player closes the app during a live game, a bot still takes over only when at least one human remains.
- Added **End game** voting when there are no bots at the table.
- All human players must confirm before the game ends.


## V5 leave button fix

- Added a visible **Leave game** button.
- On phones, closing the browser/app can delay the disconnect, so use **Leave game** before closing.
- If the last human player presses **Leave game**, bots immediately leave and the game resets.
- If a player disconnects and no other human players remain, bots also leave and the table resets.


## V6 tables and stronger bots

- Added **New table** button so players can open another table immediately.
- Players can join another table instead of waiting as spectators.
- Players can take over a **bot seat** during a game.
- Bots are stronger and play more combinations: pairs, triplets, five-card hands, and stronger blocking hands.
- **Leave game** remains available.
- **End game** voting remains available and now also works at tables with bots; all human players must confirm.


## V7 winner starts rule

- In the first round only, the player with **3♦** starts and must play 3♦.
- After that, the winner of the previous round starts the next round.
- The winner does not need to include 3♦ when starting later rounds.


## V8 lobby and score design

- Redesigned the lobby: enter name, choose a table, tap an empty seat, take a bot seat, or create a new table with + New table.
- Lobby now shows player names in each table instead of only showing "1 human".
- Mobile view hides the side panel and puts scores in a compact bottom score bar near the cards.
- The hand panel is sticky at the bottom on phone so players do not need to scroll up and down as much.
- Table list inside the game also shows names instead of only counts.
