import * as cheerio from 'cheerio';
import { createEvents } from 'ics';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEAM_ID = '011MIC3SQK000000VTVG0001VTR8C1K7';
const TEAM_NAME = 'FC Hertha 03 IV';
const HOME_VENUE = 'Ernst-Reuter-Sportfeld KR6, Onkel-Tom-Str. 40, 14169 Berlin';
const OUT_DIR = join(__dirname, '..', 'public');
const OUT_ICS = join(OUT_DIR, 'schedule.ics');
const OUT_JSON = join(OUT_DIR, 'schedule.json');
const MATCH_DURATION_MINS = 90;
const DETAIL_CONCURRENCY = 6;

const ENDPOINTS = {
  prev: `https://www.fussball.de/ajax.team.prev.games/-/mode/PAGE/team-id/${TEAM_ID}`,
  next: `https://www.fussball.de/ajax.team.next.games/-/mode/PAGE/team-id/${TEAM_ID}`,
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': 'https://www.fussball.de/',
  'Cache-Control': 'no-cache',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, retries = 3, delayMs = 1500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`  Fetching (attempt ${attempt}): ${url}`);
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(9000) });
      if (res.ok) return await res.text();
      console.warn(`  HTTP ${res.status} — retrying in ${delayMs}ms...`);
    } catch (err) {
      console.warn(`  Network error: ${err.message} — retrying in ${delayMs}ms...`);
    }
    if (attempt < retries) await sleep(delayMs);
  }
  throw new Error(`Failed to fetch ${url} after ${retries} attempts`);
}

function parseGames(html) {
  const $ = cheerio.load(html);
  const games = [];
  let pending = null;

  $('table tr').each((_, row) => {
    const $row = $(row);
    const rowText = $row.text().replace(/\s+/g, ' ').trim();
    const cls = $row.attr('class') || '';

    if (cls.includes('row-competition')) {
      const dt = parseDateFromRow(rowText);
      const competition = parseCompetition(rowText);
      pending = dt ? { dt, competition } : null;
      return;
    }

    if (!pending) return;

    const teamLinks = $row.find('a[href*="/mannschaft/"]');
    if (teamLinks.length < 2) return;

    const homeTeam = cleanText($(teamLinks[0]).find('.club-name').text() || $(teamLinks[0]).text());
    const awayTeam = cleanText($(teamLinks[1]).find('.club-name').text() || $(teamLinks[1]).text());
    const matchHref = $row.find('a[href*="/spiel/"]').last().attr('href') || '';
    const matchUrl = normalizeUrl(matchHref);
    const matchId = extractMatchId(matchUrl);

    if (homeTeam && awayTeam && (homeTeam.includes(TEAM_NAME) || awayTeam.includes(TEAM_NAME))) {
      games.push({ ...pending, homeTeam, awayTeam, matchUrl, matchId, location: null, venueName: null });
    }
    pending = null;
  });

  return games;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeUrl(href) {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  return `https://www.fussball.de${href}`;
}

function extractMatchId(url) {
  const m = String(url || '').match(/\/spiel\/([0-9A-Z]+)(?:[/?]|$)/i);
  return m ? m[1] : null;
}

function parseCompetition(text) {
  const parts = String(text).split(/\|/).map((p) => cleanText(p));
  return (parts[1] || parts[0] || 'Kreisklasse C')
    .replace(/^\d{2}:\d{2}\s+/, '')
    .replace(/\s+(ME|FS|PO|TU|HL)$/, '')
    .trim();
}

function parseDateFromRow(text) {
  const dateMatch = text.match(/(\d{2})\.(\d{2})\.(\d{2,4})/);
  const timeMatch = text.match(/(\d{2}):(\d{2})/);
  if (!dateMatch) return null;
  let [, day, month, year] = dateMatch;
  if (year.length === 2) year = '20' + year;
  return { year: +year, month: +month, day: +day, hour: timeMatch ? +timeMatch[1] : 12, minute: timeMatch ? +timeMatch[2] : 0 };
}

async function enrichLocations(games) {
  const withUrls = games.filter((g) => g.matchUrl);
  let index = 0;
  async function worker() {
    while (index < withUrls.length) {
      const game = withUrls[index++];
      try {
        const html = await fetchWithRetry(game.matchUrl, 2, 750);
        const location = parseLocationFromMatchPage(html);
        if (location) {
          game.location = location.full;
          game.venueName = location.name;
          game.venueAddress = location.address;
        }
      } catch (err) {
        console.warn(`  ⚠️ Location fetch failed for ${game.matchId || game.matchUrl}: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, withUrls.length) }, worker));
}

function parseLocationFromMatchPage(html) {
  const $ = cheerio.load(html);
  const text = cleanText($('a.location').first().text());
  if (!text) return null;
  const parts = text.split(',').map((p) => cleanText(p)).filter(Boolean);
  return { full: text, type: parts[0] || null, name: parts[1] || null, address: parts.slice(2).join(', ') || null };
}

function toDate(dt) {
  return new Date(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute);
}

function buildICS(games) {
  const events = games.map((game) => {
    const start = toDate(game.dt);
    const end = new Date(start.getTime() + MATCH_DURATION_MINS * 60 * 1000);
    const isHome = game.homeTeam.toLowerCase().includes('hertha');
    const opponent = isHome ? game.awayTeam : game.homeTeam;
    return {
      title: `${game.homeTeam} vs ${game.awayTeam}`,
      description: [`${TEAM_NAME} – ${isHome ? '🏠 Home' : '✈️ Away'} vs ${opponent}`, `Competition: ${game.competition}`, game.matchUrl ? `Details: ${game.matchUrl}` : ''].filter(Boolean).join('\n'),
      start: [game.dt.year, game.dt.month, game.dt.day, game.dt.hour, game.dt.minute],
      end: [end.getFullYear(), end.getMonth() + 1, end.getDate(), end.getHours(), end.getMinutes()],
      location: game.location || (isHome ? HOME_VENUE : ''),
      url: game.matchUrl || '',
      status: 'CONFIRMED',
      busyStatus: 'BUSY',
      calName: `${TEAM_NAME} Spielplan`,
    };
  });
  return createEvents(events);
}

function buildJSON(games) {
  const formatted = games.map((game) => {
    const kickoff = toDate(game.dt);
    const end = new Date(kickoff.getTime() + MATCH_DURATION_MINS * 60 * 1000);
    const isHome = game.homeTeam.toLowerCase().includes('hertha');
    const opponent = isHome ? game.awayTeam : game.homeTeam;
    return {
      date: `${String(game.dt.day).padStart(2, '0')}.${String(game.dt.month).padStart(2, '0')}.${game.dt.year}`,
      time: `${String(game.dt.hour).padStart(2, '0')}:${String(game.dt.minute).padStart(2, '0')}`,
      kickoff_iso: kickoff.toISOString(),
      end_iso: end.toISOString(),
      home_team: game.homeTeam,
      away_team: game.awayTeam,
      opponent,
      venue: isHome ? 'home' : 'away',
      location: game.location || (isHome ? HOME_VENUE : null),
      venue_name: game.venueName || null,
      venue_address: game.venueAddress || null,
      competition: game.competition,
      status: kickoff < new Date() ? 'played' : 'upcoming',
      match_id: game.matchId,
      match_url: game.matchUrl || null,
    };
  });
  return JSON.stringify({ team: TEAM_NAME, team_id: TEAM_ID, generated: new Date().toISOString(), total: formatted.length, past: formatted.filter((g) => g.status === 'played').length, upcoming: formatted.filter((g) => g.status === 'upcoming').length, games: formatted }, null, 2);
}

function deduplicateGames(games) {
  const seen = new Set();
  return games.filter((g) => {
    const key = g.matchId || `${g.dt.year}-${g.dt.month}-${g.dt.day}-${g.dt.hour}-${g.homeTeam}-${g.awayTeam}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  console.log(`\n🔍 Scraping schedule for ${TEAM_NAME}...\n`);
  const [prevHtml, nextHtml] = await Promise.all([fetchWithRetry(ENDPOINTS.prev), fetchWithRetry(ENDPOINTS.next)]);
  const allGames = deduplicateGames([...parseGames(prevHtml), ...parseGames(nextHtml)]).sort((a, b) => toDate(a.dt) - toDate(b.dt));
  if (allGames.length === 0) throw new Error('No games found — parser/site may have changed.');
  console.log(`  ✅ Games found: ${allGames.length}`);
  console.log('  📍 Fetching match locations...');
  await enrichLocations(allGames);

  console.log(`\n📅 Games schedule:\n`);
  allGames.forEach((g) => console.log(`  ${String(g.dt.day).padStart(2, '0')}.${String(g.dt.month).padStart(2, '0')}.${g.dt.year} ${String(g.dt.hour).padStart(2, '0')}:${String(g.dt.minute).padStart(2, '0')}  ${g.homeTeam} vs ${g.awayTeam}  ${g.location ? '📍 ' + g.location : ''}`));

  mkdirSync(OUT_DIR, { recursive: true });
  const { error, value } = buildICS(allGames);
  if (error) throw error;
  writeFileSync(OUT_ICS, value, 'utf8');
  writeFileSync(OUT_JSON, buildJSON(allGames), 'utf8');
  console.log(`\n✅ ICS written:  ${OUT_ICS}`);
  console.log(`✅ JSON written: ${OUT_JSON}`);
  console.log(`\n   ${allGames.length} games exported\n`);
}

main().catch((err) => { console.error('Fatal error:', err); process.exit(1); });
