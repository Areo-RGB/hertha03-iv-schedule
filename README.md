# FC Hertha 03 IV – Game Schedule Scraper

Automatically scrapes the game schedule for **FC Hertha 03 IV** from [fussball.de](https://www.fussball.de) and exports
it as an `.ics` file that Google Calendar (or any calendar app) can subscribe to.

## How it works

1. GitHub Actions runs the scraper daily at **06:00 UTC**
2. It fetches past and upcoming games from fussball.de
3. Generates `schedule.ics` and `schedule.json` in the repo root
4. Commits and pushes the files if anything changed
5. The files are served via GitHub Pages (and also available via the raw URL)

---

## Subscribe in Google Calendar

Use the GitHub Pages URL for the ICS file:

```
https://<username>.github.io/<repo>/schedule.ics
```

For this repo:

```
https://areo-rgb.github.io/hertha03-iv-schedule/schedule.ics
```

Then in Google Calendar:

1. Click **+** next to "Other calendars" → **From URL**
2. Paste the URL above
3. Click **Add calendar**

Google Calendar refreshes subscribed calendars roughly every **24 hours**.

---

## JSON API

The schedule is also exported as `schedule.json` — useful for building a website, widget, or any other integration:

```
https://areo-rgb.github.io/hertha03-iv-schedule/schedule.json
```

A `raw.githubusercontent.com` URL is also available if you prefer, but the Pages URL is recommended so the cache headers
don't get in the way:

```
https://raw.githubusercontent.com/Areo-RGB/hertha03-iv-schedule/master/schedule.json
```

Example response shape:

```json
{
  "team": "FC Hertha 03 IV",
  "team_id": "011MIC3SQK000000VTVG0001VTR8C1K7",
  "generated": "2026-06-26T06:00:00.000Z",
  "total": 9,
  "past": 9,
  "upcoming": 0,
  "games": [
    {
      "date": "21.06.2026",
      "time": "12:00",
      "kickoff_iso": "2026-06-21T12:00:00.000Z",
      "end_iso": "2026-06-21T13:30:00.000Z",
      "home_team": "Viktoria Berlin IX",
      "away_team": "FC Hertha 03 IV",
      "opponent": "Viktoria Berlin IX",
      "venue": "away",
      "location": null,
      "competition": "Kreisklasse C",
      "status": "played",
      "match_url": "https://www.fussball.de/spiel/..."
    }
  ]
}
```

---

## Setup (first time)

```bash
# Clone your repo
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO

# Install dependencies
npm install

# Run locally to test
npm run scrape

# Output: schedule.ics (repo root)
```

No environment variables or secrets needed — the scraper hits public endpoints on fussball.de.

---

## Manual trigger

Go to **Actions → Scrape & Update Schedule → Run workflow** to trigger a scrape immediately without waiting for the
daily cron.

---

## Customising for a different team

Edit `src/scraper.js` and change these values at the top:

```js
const TEAM_ID = '011MIC3SQK000000VTVG0001VTR8C1K7'; // ← fussball.de team ID
const TEAM_NAME = 'FC Hertha 03 IV';
const HOME_VENUE = 'Ernst-Reuter-Sportfeld KR6, Onkel-Tom-Str. 40, 14169 Berlin';
```

To find a team ID, open the team page on fussball.de and copy the `team-id` from the URL.

---

## Project structure

```
.
├── .github/
│   └── workflows/
│       └── scrape.yml      # Daily GitHub Actions cron job
├── src/
│   └── scraper.js          # Main scraper + ICS generator
├── schedule.ics            # Generated calendar file (auto-updated, served via Pages)
├── schedule.json           # Generated JSON (auto-updated, served via Pages)
├── package.json
└── README.md
```

---

## Tech

- **[cheerio](https://cheerio.js.org/)** — HTML parsing
- **[ics](https://github.com/adamgibbons/ics)** — ICS file generation
- **GitHub Actions** — free daily cron on public repos
