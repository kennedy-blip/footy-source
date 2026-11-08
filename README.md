# FootyPulse Hub

Next.js 14 + TypeScript live football scoreboard. The application has **no seeded fixtures, mock scores, synthetic commentary, or silent fallback feed**.

## Live feed

`GET /api/matches?date=YYYYMMDD` fetches the selected Nairobi calendar date from ESPN's public soccer scoreboard endpoint and normalizes fixtures for the Premier League, La Liga, UEFA Champions League, Serie A, and Bundesliga. The browser polls the server route every 30 seconds with caching disabled.

Displayed kick-off times use the IANA timezone `Africa/Nairobi` (EAT) and include UTC for reference. When ESPN provides no fixture, a score, a venue, or broadcast information, the UI shows that it is unavailable instead of inventing a value. A feed failure is surfaced as an error; it is never replaced by demo data.

**Provider caveat:** ESPN's public scoreboard endpoint is undocumented and has no published uptime/latency guarantee. The live feed depends on that upstream service. For a commercial/production service-level commitment, replace it with an appropriately licensed provider and credentials.

## Run

```bash
npm install
npm run dev
```

## Odds and experimental match model

Click a fixture to request `/api/matches/{eventId}/analysis?league=...`, which queries ESPN's event summary for source-listed 1X2 prices, the totals market, recent results, standings, and head-to-head records. Price-to-probability conversions use American odds and normalize the three outcomes to remove the overround. Missing odds are shown as missing; a 1X2 model output is withheld if source 1X2 prices are absent.

The experimental, uncalibrated 1X2 blend starts with 68% market, 15% recent form, 10% table points-per-game, and 7% H2H weights. If a component is unavailable, remaining available components are reweighted. The goals estimate uses each club's actual recent goals-for/goals-against rates in a simple Poisson calculation, blended with the source over/under market when it exists. Model estimates are not betting recommendations and are not guaranteed outcomes.

The ESPN summary does not reliably supply structured transfer-impact history or assigned referees for every fixture. Those factors are explicitly excluded rather than guessed. The displayed market may be a US sportsbook price and may not be available in Kenya; no bookmaker link or bet placement is provided. A licensed, Kenya-appropriate odds/football-data provider and API credentials are required for regional market coverage, verified transfers/referee data, and a production-calibrated model.
