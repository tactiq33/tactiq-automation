/**
 * analyze.js — تحليل مباراة: يسحب النتيجة + الإحصائيّات + التشكيلات من API-Football،
 * ويبني «برومت تحليل» لـGemini (إيجابيّات/سلبيّات كل مدرّب + ليش فاز/خسر) + كابشن جاهز،
 * ويبعتهم على تيليغرام. للمباريات المهمّة فقط.
 *
 * التشغيل:
 *   node analyze.js --fixture=ID           # معاينة
 *   node analyze.js --fixture=ID --send    # يبعت على تيليغرام
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { sendTelegram } = require('./notify');

const KEY = process.env.FOOTBALL_API_KEY;
const HOST = 'https://v3.football.api-sports.io';
function arg(n){ var a=process.argv.find(x=>x.startsWith('--'+n)); return a? (a.includes('=')?a.split('=')[1]:true):null; }
const FIXTURE = arg('fixture'), SEND = !!arg('send');

async function api(p){ const r=await fetch(HOST+p,{headers:{'x-apisports-key':KEY}}); const j=await r.json(); if(j.errors&&Object.keys(j.errors).length) throw new Error(JSON.stringify(j.errors)); return j; }

function statVal(arr, type){ var s=(arr||[]).find(x=>x.type===type); return s? s.value : '—'; }

(async () => {
  if(!KEY){ console.error('❌ FOOTBALL_API_KEY ناقص'); process.exit(1); }
  if(!FIXTURE){ console.error('❌ لازم --fixture=ID'); process.exit(1); }

  const fx = (await api(`/fixtures?id=${FIXTURE}`)).response[0];
  const t = fx.teams, g = fx.goals, lg = fx.league;
  const stats = (await api(`/fixtures/statistics?fixture=${FIXTURE}`)).response || [];
  const lineups = (await api(`/fixtures/lineups?fixture=${FIXTURE}`)).response || [];

  function teamBlock(teamId, name){
    const st = (stats.find(s=>s.team.id===teamId)||{}).statistics || [];
    const lu = lineups.find(l=>l.team.id===teamId) || {};
    return `${name} (خطة ${lu.formation||'?'}): استحواذ ${statVal(st,'Ball Possession')}, تسديدات ${statVal(st,'Total Shots')} (على المرمى ${statVal(st,'Shots on Goal')}), تمريرات دقيقة ${statVal(st,'Passes accurate')}, أخطاء ${statVal(st,'Fouls')}, ركنيّات ${statVal(st,'Corner Kicks')}, بطاقات صفرا ${statVal(st,'Yellow Cards')}`;
  }

  const scoreLine = `${t.home.name} ${g.home}-${g.away} ${t.away.name}`;
  const home = teamBlock(t.home.id, t.home.name);
  const away = teamBlock(t.away.id, t.away.name);
  const winner = g.home>g.away? t.home.name : g.away>g.home? t.away.name : 'تعادل';

  const prompt = `أنت محلّل كرة قدم خبير. اكتب تحليلًا موجزًا بالعربيّة (لا يتجاوز ٦ أسطر) لمباراة:
${scoreLine} — ${lg.name} (${lg.round}).
بيانات الفريقين:
- ${home}
- ${away}
النتيجة: ${winner==='تعادل'?'تعادل':winner+' فاز'}.
اكتب: (١) سببان لفوز/تعادل الأفضل، (٢) سببان لخسارة/تعثّر الآخر، (٣) نقطة تكتيكيّة واحدة لكل مدرّب. بأسلوب واضح واحترافيّ، بلا مبالغة.`;

  const caption = `📊 تحليل: ${t.home.flag||''} ${scoreLine}\n🏆 ${lg.name} — ${lg.round}\n\n[الصق تحليل Gemini هنا]\n\nتحليل تكتيكيّ يوميّ مع TactIQ ⚽\n#TactIQ #تحليل #كرة_قدم`;

  const msg = [
    `📊 تحليل مباراة: ${scoreLine}`,
    `🏆 ${lg.name} — ${lg.round}`,
    '',
    '🤖 برومت التحليل (الصقه بـGeminI):',
    prompt,
    '',
    '📝 قالب الكابشن (حطّ تحليل Gemini مكان القوس):',
    caption
  ].join('\n');

  console.log('\n──────────────\n' + msg + '\n──────────────');
  if(SEND){ try{ await sendTelegram(msg); console.log('✅ انبعت'); }catch(e){ console.log('⚠️', e.message); } }
})().catch(e=>{ console.error('❌ خطأ:', e.message||e); });
