# 🐺 Team Alpha Screener v3.2 — Vercel Deployment

## Deploy in 5 Minutes (Cost: $0)

### Step 1: Push to GitHub
```bash
cd team-alpha-deploy
git init && git add . && git commit -m "Team Alpha Screener v3.2"
```
Create repo at github.com/new → then:
```bash
git remote add origin https://github.com/YOUR_USERNAME/team-alpha-screener.git
git branch -M main
git push -u origin main
```

### Step 2: Deploy on Vercel
1. Go to vercel.com/new → Import your repo
2. Expand "Environment Variables" → Add: `VITE_FMP_API_KEY` = your key
3. Click Deploy → Live in 60 seconds

### Step 3: Get Free API Key
Sign up at financialmodelingprep.com → Copy key from dashboard

---

## API Budget: 250 Calls/Day Strategy

| Action | API Calls | When |
|--------|-----------|------|
| First load (all 100 stocks) | **1 call** | Bulk quote endpoint |
| Each refresh | **1 call** | Cached 2 min |
| Click a stock (detailed view) | **0-2 calls** | Historical + metrics, cached 24h in localStorage |
| Typical daily usage | **~30-70 calls** | Well within 250 limit |

The screener uses a **3-tier architecture**:
- **Tier 1**: Bulk quote (1 call = 100 stocks) → loads instantly
- **Tier 2**: Historical prices (on-demand per click, cached 24h)
- **Tier 3**: Key metrics (on-demand per click, cached 24h)

---

## Project Files
```
├── index.html           ← Entry point
├── package.json         ← Dependencies
├── vite.config.js       ← Build config (auto-detected by Vercel)
├── .env.example         ← Env var template
├── .gitignore           ← Keeps secrets out of git
└── src/
    ├── main.jsx         ← React mount
    └── App.jsx          ← Full screener (engines + UI)
```

## Costs: $0
Vercel Hobby (free) + FMP Free (250/day) + GitHub Free

Built for the community, free forever.
