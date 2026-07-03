# Casefile — Deployment Instructions

## Step 1: Set up the free database (do this FIRST, ~5 min)
1. Go to https://console.firebase.google.com
2. Click "Add project" → name it (e.g. "casefile") → skip Google Analytics if asked
3. In the left menu, click "Build" → "Realtime Database" → "Create Database"
4. Choose a location, then select **"Start in test mode"** (fine for launch — see security note below)
5. Copy the database URL shown at the top (looks like `https://casefile-xxxxx-default-rtdb.firebaseio.com`)
6. Open `src/App.jsx`, find this line near the top:
   ```js
   const FIREBASE_DB_URL = "https://YOUR-PROJECT-ID-default-rtdb.firebaseio.com";
   ```
   Replace it with your real URL from step 5.

**Security note:** "test mode" allows anyone to read/write for 30 days, then locks by default. Before that window closes, go to Realtime Database → Rules and set:
```json
{
  "rules": {
    "reports": {
      ".read": true,
      ".write": true
    }
  }
}
```
This keeps it open for anyone to submit reports (which is the point) while you don't need a login system yet.

## Step 2: Add your app icons
Drop two square PNG images into the `public/` folder:
- `icon-192.png` (192x192 px)
- `icon-512.png` (512x512 px)

Any simple logo works — even a plain colored square with the ◈ mark or your initials is fine to start.

## Step 3: Deploy on Netlify
**Easiest path — no local setup needed:**
1. Create a free GitHub account if you don't have one, and a new repository
2. On the repo page, click "Add file" → "Upload files" → drag this whole project folder in → commit
3. In Netlify, choose **"Import from Git"** (not the drag-and-drop uploader)
4. Connect your GitHub, pick the repo
5. Build settings: build command = `npm run build`, publish directory = `dist` (Netlify usually auto-detects this since it's a Vite project)
6. Click Deploy — first build takes 1-2 minutes

Netlify installs everything and builds it for you — you don't need Node.js installed on your own computer for this path.

## Step 4: Connect your domain
Once `scam-notme.com` (or whatever you land on) is purchased, in Netlify go to Site settings → Domain management → Add custom domain, and follow the DNS instructions it gives you.

## Step 5: Test it live
- Upload a photo, confirm the scan runs
- Submit a report, then reload the page and upload the same photo again — confirm the match shows up (this proves Firebase is actually saving data)
