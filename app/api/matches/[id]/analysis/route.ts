import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
const leagueSlugs: Record<string,string> = {
  'Premier League':'eng.1','La Liga':'esp.1','Champions League':'uefa.champions','Serie A':'ita.1','Bundesliga':'ger.1',
};
type Outcome = {home:number;draw:number;away:number};
const americanImplied=(value:unknown):number|null=>{const n=typeof value==='number'?value:Number(String(value??'').replace('+',''));if(!Number.isFinite(n)||n===0)return null;return n>0?100/(n+100):(-n)/(-n+100)};
const norm=(values:number[]):number[]=>{const total=values.reduce((a,b)=>a+b,0);return total>0?values.map(v=>v/total):values.map(()=>1/values.length)};
const distribution=(diff:number):number[]=>{const d=Math.max(-1,Math.min(1,diff));return norm([.35+d*.25,.30,.35-d*.25])};
const pct=(xs:number[])=>{const raw=xs.map(x=>Math.round(x*100));const delta=100-raw.reduce((a,b)=>a+b,0);if(delta)raw[raw.indexOf(Math.max(...xs.map(x=>Math.round(x*100))))]+=delta;return raw};
function statsFor(entries:any[],teamId:string){
  const entry=entries.find((x:any)=>String(x.id??x.team?.id)===teamId||String(x.team?.id)===teamId);
  if(!entry)return null;const stats=entry.stats??[];const get=(...names:string[])=>{const s=stats.find((x:any)=>names.includes(String(x.name).toLowerCase())||names.includes(String(x.abbreviation).toLowerCase()));return Number(s?.value??s?.displayValue)};
  const played=get('gamesplayed','gp'),points=get('points','pts'),rank=get('rank','r'),goalDiff=get('pointdifferential','gd');
  return {played:Number.isFinite(played)?played:null,points:Number.isFinite(points)?points:null,rank:Number.isFinite(rank)?rank:null,goalDifference:Number.isFinite(goalDiff)?goalDiff:null,pointsPerGame:Number.isFinite(played)&&played>0&&Number.isFinite(points)?points/played:null};
}
function formFor(items:any[],teamId:string){
  const bucket=items.find((x:any)=>String(x.team?.id)===teamId);if(!bucket)return null;
  const events=(bucket.events??[]).filter((e:any)=>['W','D','L'].includes(String(e.gameResult??'').toUpperCase())&&e.homeTeamScore!=null&&e.awayTeamScore!=null).slice(0,5);
  if(!events.length)return null;let points=0,wins=0,draws=0,losses=0,goalsFor=0,goalsAgainst=0;
  for(const e of events){const isHome=String(e.homeTeamId)===teamId;const own=Number(isHome?e.homeTeamScore:e.awayTeamScore),opp=Number(isHome?e.awayTeamScore:e.homeTeamScore);if(!Number.isFinite(own)||!Number.isFinite(opp))continue;goalsFor+=own;goalsAgainst+=opp;if(own>opp){points+=3;wins++}else if(own===opp){points++;draws++}else losses++}
  const played=wins+draws+losses;return played?{played,wins,draws,losses,points,pointsPerGame:points/played,goalsFor,goalsAgainst,goalsForPerGame:goalsFor/played,goalsAgainstPerGame:goalsAgainst/played}:null;
}
function h2hFor(series:any[],homeId:string,awayId:string){
  const seriesItem=series.find((s:any)=>String(s.type).toLowerCase().includes('head-to-head'))??series[0];if(!seriesItem)return null;
  const events=(seriesItem.events??[]).filter((e:any)=>e.statusType?.completed||e.status==='post').filter((e:any)=>(e.competitors??[]).some((c:any)=>String(c.team?.id)===homeId)&&(e.competitors??[]).some((c:any)=>String(c.team?.id)===awayId)).slice(0,5);
  if(!events.length)return null;let home=0,draw=0,away=0;
  for(const e of events){const h=e.competitors.find((c:any)=>String(c.team?.id)===homeId),a=e.competitors.find((c:any)=>String(c.team?.id)===awayId);if(h?.winner===true)home++;else if(a?.winner===true)away++;else if(Number(h?.score)===Number(a?.score))draw++;}
  return {sample:events.length,home,draw,away,summary:seriesItem.shortSummary??seriesItem.summary??'Recent head-to-head'};
}
export async function GET(request:NextRequest,{params}:{params:{id:string}}){
  const league=request.nextUrl.searchParams.get('league')??'';const slug=leagueSlugs[league];
  if(!slug)return NextResponse.json({error:'Unsupported competition for analysis.'},{status:400,headers:{'Cache-Control':'no-store'}});
  try{
    const response=await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${encodeURIComponent(params.id)}`,{cache:'no-store',headers:{Accept:'application/json','User-Agent':'FootyPulseHub/1.0 (match analysis)'},signal:AbortSignal.timeout(12000)});
    if(!response.ok)return NextResponse.json({error:`ESPN match analysis returned HTTP ${response.status}.`},{status:502,headers:{'Cache-Control':'no-store'}});
    const body=await response.json();const header=body.header?.competitions?.[0];const competitors=header?.competitors??[];const home=competitors.find((x:any)=>x.homeAway==='home');const away=competitors.find((x:any)=>x.homeAway==='away');
    if(!home||!away)return NextResponse.json({error:'The source has not published both teams for this match.'},{status:404,headers:{'Cache-Control':'no-store'}});
    const homeId=String(home.id??home.team?.id??''),awayId=String(away.id??away.team?.id??'');
    const pick=(body.odds??body.pickcenter??[]).find((o:any)=>o.provider?.name||o.moneyline||o.homeTeamOdds||o.total);
    let market:null|{provider:string;homeAmerican:string|null;drawAmerican:string|null;awayAmerican:string|null;homeProbability:number;drawProbability:number;awayProbability:number;totalLine:number|null;overAmerican:string|null;underAmerican:string|null;overProbability:number|null;underProbability:number|null}=null;
    let marketRaw:number[]|null=null;
    if(pick){
      const homePrice=pick.moneyline?.home?.close?.odds??pick.homeTeamOdds?.moneyLine;
      const drawPrice=pick.moneyline?.draw?.close?.odds??pick.drawOdds?.moneyLine;
      const awayPrice=pick.moneyline?.away?.close?.odds??pick.awayTeamOdds?.moneyLine;
      const raw=[americanImplied(homePrice),americanImplied(drawPrice),americanImplied(awayPrice)];
      if(raw.every((x):x is number=>x!==null))marketRaw=norm(raw);
      const overPrice=pick.total?.over?.close?.odds??pick.overOdds,underPrice=pick.total?.under?.close?.odds??pick.underOdds;
      const overRaw=americanImplied(overPrice),underRaw=americanImplied(underPrice),totalRaw=overRaw!==null&&underRaw!==null?norm([overRaw,underRaw]):null;
      const rawLine=pick.overUnder??(pick.total?.over?.close?.line==null?null:String(pick.total.over.close.line).replace(/^[ou]/i,''));const line=rawLine==null||String(rawLine).trim()===''?Number.NaN:Number(rawLine);
      market={provider:pick.provider?.name??'ESPN-listed market',homeAmerican:homePrice==null?null:String(homePrice),drawAmerican:drawPrice==null?null:String(drawPrice),awayAmerican:awayPrice==null?null:String(awayPrice),homeProbability:marketRaw?marketRaw[0]:0,drawProbability:marketRaw?marketRaw[1]:0,awayProbability:marketRaw?marketRaw[2]:0,totalLine:Number.isFinite(line)?line:null,overAmerican:overPrice==null?null:String(overPrice),underAmerican:underPrice==null?null:String(underPrice),overProbability:totalRaw?totalRaw[0]:null,underProbability:totalRaw?totalRaw[1]:null};
    }
    const formHome=formFor(body.lastFiveGames??[],homeId),formAway=formFor(body.lastFiveGames??[],awayId);
    const entries=(body.standings?.groups??[]).flatMap((g:any)=>g.standings?.entries??[]);const tableHome=statsFor(entries,homeId),tableAway=statsFor(entries,awayId);
    const h2h=h2hFor(body.seasonseries??[],homeId,awayId);
    const components:{key:string;weight:number;probs:number[];label:string}[]=[];
    if(marketRaw)components.push({key:'market',weight:.68,probs:marketRaw,label:'Current source-listed 1X2 odds (vig removed)' });
    if(formHome?.pointsPerGame!=null&&formAway?.pointsPerGame!=null){const range=Math.max(1,Math.abs(formHome.pointsPerGame)+Math.abs(formAway.pointsPerGame));components.push({key:'form',weight:.15,probs:distribution((formHome.pointsPerGame-formAway.pointsPerGame)/range),label:'Each team’s latest available results'});}
    if(tableHome?.pointsPerGame!=null&&tableAway?.pointsPerGame!=null){const range=Math.max(1,Math.abs(tableHome.pointsPerGame)+Math.abs(tableAway.pointsPerGame));components.push({key:'table',weight:.10,probs:distribution((tableHome.pointsPerGame-tableAway.pointsPerGame)/range),label:'Current competition points per game'});}
    if(h2h){const total=h2h.home+h2h.draw+h2h.away;components.push({key:'h2h',weight:.07,probs:total?norm([h2h.home,h2h.draw,h2h.away]):[1/3,1/3,1/3],label:`Last ${h2h.sample} available head-to-head result${h2h.sample===1?'':'s'}`});}
    let prediction:null|{home:number;draw:number;away:number;inputs:string[];quality:'market-led'}=null;
    if(marketRaw&&components.length){const weight=components.reduce((s,c)=>s+c.weight,0);const combined=[0,0,0];for(const c of components)c.probs.forEach((v,i)=>combined[i]+=v*c.weight/weight);const p=pct(norm(combined));prediction={home:p[0],draw:p[1],away:p[2],inputs:components.map(c=>c.key),quality:'market-led'};}
    const poissonOver=(line:number,lambda:number)=>{const cap=Math.floor(line);let term=Math.exp(-lambda),under=term;for(let k=1;k<=cap;k++){term*=lambda/k;under+=term}return Math.max(0,Math.min(1,1-under))};
    const goalModel=market?.totalLine!=null&&formHome?.goalsForPerGame!=null&&formHome?.goalsAgainstPerGame!=null&&formAway?.goalsForPerGame!=null&&formAway?.goalsAgainstPerGame!=null?(()=>{const h=(formHome.goalsForPerGame+formAway.goalsAgainstPerGame)/2;const a=(formAway.goalsForPerGame+formHome.goalsAgainstPerGame)/2;const expected=h+a;const historical=poissonOver(market.totalLine!,expected);const marketOver=market.overProbability;const blended=marketOver==null?historical:.65*marketOver+.35*historical;return {line:market.totalLine,expectedTotal:Number(expected.toFixed(2)),formOverProbability:Math.round(historical*100),marketOverProbability:marketOver==null?null:Math.round(marketOver*100),overProbability:Math.round(blended*100),underProbability:Math.round((1-blended)*100),lean:blended>.54?'Over':blended<.46?'Under':'No clear lean',inputs:['home attack and away defence over each team’s last five available results','away attack and home defence over each team’s last five available results',...(marketOver==null?[]:['source-listed over/under odds'])]}})():null;
    const officials=(body.gameInfo?.officials??header?.officials??[]).map((o:any)=>o.displayName??o.fullName??o.name).filter(Boolean);
    const output={source:'ESPN',retrievedAt:new Date().toISOString(),teams:{home:home.team?.displayName??home.team?.name,away:away.team?.displayName??away.team?.name},market,form:{home:formHome,away:formAway},standings:{home:tableHome,away:tableAway},headToHead:h2h,prediction,goalModel,officials,transferImpact:{available:false,reason:'No verified transfer-impact data is provided by this feed; excluded from the calculation.'},limitations:['This is a transparent, uncalibrated informational model, not a guaranteed outcome or a betting instruction.','Market odds may reflect a bookmaker and region that are not available where you are.','Referee and transfer-impact factors are excluded unless this data source actually publishes verified values.']};
    return NextResponse.json(output,{headers:{'Cache-Control':'no-store, max-age=0'}});
  }catch(error){const message=error instanceof Error?error.message:'Unknown upstream error';return NextResponse.json({error:`Match analysis unavailable: ${message}`},{status:502,headers:{'Cache-Control':'no-store'}});}
}
