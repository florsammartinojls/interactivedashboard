# FBA Dashboard

## Deploy to Vercel (5 minutes)

### Option A: From GitHub (recommended)

1. Create a new GitHub repo (e.g. `fba-dashboard`)
2. Unzip this project and push it:
   ```bash
   cd fba-dashboard
   git init
   git add .
   git commit -m "initial"
   git remote add origin https://github.com/YOUR_USER/fba-dashboard.git
   git push -u origin main
   ```
3. Go to [vercel.com](https://vercel.com) → "Add New Project"
4. Import your GitHub repo
5. Framework: **Vite** (Vercel auto-detects it)
6. Click **Deploy**
7. Done! Your dashboard is live at `your-project.vercel.app`

### Option B: Vercel CLI

```bash
cd fba-dashboard
npm install
npx vercel
```

## Local Development

```bash
cd fba-dashboard
npm install
npm run dev
```

Opens at `http://localhost:5173`

## Architecture

```
Google Sheets → Apps Script (cache every 15min) → JSONP → React Dashboard
```

- **Live data** loads in ~2 seconds (from cache)
- **History** loads on-demand when you open a Core or Bundle detail
- Auto-refreshes from Sheets every 15 minutes
