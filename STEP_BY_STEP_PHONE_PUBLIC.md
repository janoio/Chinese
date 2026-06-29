# Step by step: make the phone game public

Important: GitHub is where the code is stored. The link your friends will use to play must be the online app link from Render, because live multiplayer needs a running Node.js server.

## A. Test on your laptop first

1. Install Node.js LTS.
2. Extract this ZIP.
3. Open the folder `chinese-poker-live`.
4. Double-click `START_GAME_WINDOWS.bat`.
5. Open `http://localhost:3000`.

## B. Upload to GitHub

1. Go to https://github.com
2. Sign in.
3. Click `+` then `New repository`.
4. Repository name: `chinese-poker-live`
5. Choose `Public`.
6. Do not add README.
7. Click `Create repository`.
8. Click `uploading an existing file`.
9. Drag the CONTENTS of the `chinese-poker-live` folder:
   - public
   - server.js
   - package.json
   - render.yaml
   - README.md
   - START_GAME_WINDOWS.bat
   - .gitignore
10. Click `Commit changes`.

## C. Deploy on Render

1. Go to https://render.com
2. Sign in using GitHub.
3. Click `New +`.
4. Choose `Web Service`.
5. Choose your GitHub repository: `chinese-poker-live`.
6. Use these settings:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Health Check Path: `/health`
7. Click `Deploy Web Service`.
8. Wait until it says live.
9. Copy the Render link. It will look like:
   `https://chinese-poker-live.onrender.com`

This is the link you send to your friends.

## D. Install it on phone

### Android
1. Open the Render link in Chrome.
2. Tap the three dots menu.
3. Tap `Install app` or `Add to Home screen`.

### iPhone
1. Open the Render link in Safari.
2. Tap Share.
3. Tap `Add to Home Screen`.

## E. Important

- If you only run `localhost:3000`, your laptop must stay open.
- If you deploy on Render, your laptop can be shut down.
- Your friends do not need GitHub.
- Your friends only open the Render link on their phones.
