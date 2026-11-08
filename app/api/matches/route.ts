import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard';
const leagueFor = (label: string, seasonSlug: string) => {
  const value = `${label} ${seasonSlug}`.toLowerCase();
  if (value.includes('premier league') && !value.includes('women')) return 'Premier League';
  if (value.includes('laliga') || value.includes('la liga')) return 'La Liga';
  if (value.includes('champions league')) return 'Champions League';
  if (value.includes('serie a')) return 'Serie A';
  if (value.includes('bundesliga') && !value.includes('2. bundesliga')) return 'Bundesliga';
  return null;
};

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get('date');
  if (!date || !/^\d{8}$/.test(date)) {
    return NextResponse.json({ error: 'Provide a match date as YYYYMMDD.', source: 'ESPN' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const response = await fetch(`${ESPN}?dates=${date}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json', 'User-Agent': 'FootyPulseHub/1.0 (scoreboard)' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      return NextResponse.json({ error: `Live football feed returned HTTP ${response.status}.`, source: 'ESPN' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    const body = await response.json();
    const matches = (body.events ?? []).flatMap((event: any) => {
      const competition = event.competitions?.[0];
      const league = leagueFor(competition?.altGameNote ?? '', event.season?.slug ?? '');
      if (!league || !competition) return [];
      const home = competition.competitors?.find((team: any) => team.homeAway === 'home');
      const away = competition.competitors?.find((team: any) => team.homeAway === 'away');
      if (!home || !away) return [];
      const status = competition.status?.type;
      const state = status?.state ?? 'pre';
      return [{
        id: String(event.id),
        league,
        name: event.name,
        startTime: event.date ?? competition.startDate,
        status: state,
        statusText: status?.shortDetail ?? status?.detail ?? status?.description ?? 'Status unavailable from source',
        clock: competition.status?.displayClock ?? null,
        home: { id: String(home.id ?? home.team?.id ?? ''), name: home.team?.displayName ?? home.team?.name ?? 'Home team', abbreviation: home.team?.abbreviation ?? '', logo: home.team?.logo ?? null, score: state === 'pre' ? null : (home.score ?? null) },
        away: { id: String(away.id ?? away.team?.id ?? ''), name: away.team?.displayName ?? away.team?.name ?? 'Away team', abbreviation: away.team?.abbreviation ?? '', logo: away.team?.logo ?? null, score: state === 'pre' ? null : (away.score ?? null) },
        venue: competition.venue?.fullName ?? null,
        venueCity: competition.venue?.address?.city ?? null,
        broadcasters: (competition.broadcasts ?? []).flatMap((broadcast: any) => broadcast.names ?? []),
        sourceUrl: (event.links ?? []).find((link: any) => link.rel?.includes('summary'))?.href ?? null,
      }];
    });
    return NextResponse.json({ matches, source: 'ESPN', fetchedAt: new Date().toISOString(), date }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown upstream error';
    return NextResponse.json({ error: `Unable to retrieve the live football feed: ${message}`, source: 'ESPN' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
