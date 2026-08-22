import fs from 'node:fs/promises';
import path from 'node:path';

const dir = new URL('./data/', import.meta.url);
const files = await fs.readdir(dir).catch(() => []);
const csv = files.find(f => f.toLowerCase().endsWith('.csv'));
if (!csv) throw new Error('No CSV found in ebay-sold/data/. Add an eBay Product Research CSV first.');

const text = await fs.readFile(new URL(csv, dir), 'utf8');
const rows = parseCsv(text);
if (!rows.length) throw new Error('CSV contains no data rows.');

const keys = Object.keys(rows[0]);
const pick = (...names) => {
  const lower = new Map(keys.map(k => [normal(k), k]));
  for (const n of names) if (lower.has(normal(n))) return lower.get(normal(n));
  const fuzzy = keys.find(k => names.some(n => normal(k).includes(normal(n))));
  return fuzzy;
};
const priceKey = pick('sold price','sale price','price','soldprice');
const sizeKey = pick('size','uk size','item size');
const colourKey = pick('colour','color','colourway','colorway');
const titleKey = pick('title','item title','product','product title');
const conditionKey = pick('condition','item condition');
const dateKey = pick('sold date','sale date','date','end date');

const sales = rows.map(r => ({
  price: money(r[priceKey]),
  size: clean(r[sizeKey]),
  colour: clean(r[colourKey]),
  title: clean(r[titleKey]),
  condition: clean(r[conditionKey]),
  date: parseDate(r[dateKey])
})).filter(x => Number.isFinite(x.price) && x.price > 0 && x.price < 1000);
if (!sales.length) throw new Error(`Could not find usable sold prices. Detected columns: ${keys.join(', ')}`);

const avg = average(sales.map(x=>x.price));
const med = median(sales.map(x=>x.price));
const sorted = sales.map(x=>x.price).sort((a,b)=>a-b);
const p10 = percentile(sorted,.10), p90 = percentile(sorted,.90);
const groups = (key) => Object.entries(groupBy(sales.filter(x=>x[key]), x=>x[key]))
  .map(([name, arr])=>({name,count:arr.length,avg:average(arr.map(x=>x.price)),median:median(arr.map(x=>x.price))}))
  .sort((a,b)=>b.count-a.count).slice(0,12);

const sizes = groups('size');
const colours = groups('colour');
const conditions = groups('condition');
const now = Date.now();
const recent = sales.filter(x=>x.date && now-x.date.getTime() <= 30*86400000);
const older = sales.filter(x=>x.date && now-x.date.getTime() > 30*86400000 && now-x.date.getTime() <= 90*86400000);
const trend = recent.length && older.length ? ((average(recent.map(x=>x.price))-average(older.map(x=>x.price)))/average(older.map(x=>x.price)))*100 : null;

const buyTarget = Math.max(0, med*0.60-3);
const resaleLow = Math.max(0, med*0.95);
const resaleHigh = p90;
const msg = {
  title: `📊 DAN'S VAULT • eBAY SOLD TRAINERS`,
  text: `**Sales analysed:** ${sales.length}\n💷 **Average sold:** £${avg.toFixed(2)}\n📊 **Median sold:** £${med.toFixed(2)}\n🔻 **10th percentile:** £${p10.toFixed(2)}\n🔺 **90th percentile:** £${p90.toFixed(2)}\n\n**SIZE BREAKDOWN**\n${formatGroups(sizes)}\n\n**COLOURWAY BREAKDOWN**\n${formatGroups(colours)}\n\n**CONDITION BREAKDOWN**\n${formatGroups(conditions)}\n\n📈 **30-day price trend:** ${trend===null?'not enough dated data':`${trend>=0?'+':''}${trend.toFixed(1)}%`}\n\n🎯 **Indicative resale range:** £${resaleLow.toFixed(0)}–£${resaleHigh.toFixed(0)}\n💰 **Indicative max buy:** £${buyTarget.toFixed(0)}\n\n*This is an analysis of the supplied eBay Product Research data, not a guarantee of future sale price.*`
};
console.log(JSON.stringify(msg, null, 2));

function normal(v){return String(v??'').toLowerCase().replace(/[^a-z0-9]+/g,'')}
function clean(v){return String(v??'').trim()}
function money(v){if(v==null)return NaN; const n=String(v).replace(/[^0-9.\-]/g,''); return Number(n)}
function parseDate(v){const d=new Date(v);return Number.isNaN(d.getTime())?null:d}
function average(a){return a.reduce((s,x)=>s+x,0)/a.length}
function median(a){const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2}
function percentile(a,p){if(!a.length)return 0;const i=(a.length-1)*p,b=Math.floor(i),r=i-b;return a[b]+(a[b+1]-a[b])*r}
function groupBy(a,fn){return a.reduce((o,x)=>(o[fn(x)]=(o[fn(x)]||[]).concat(x),o),{})}
function formatGroups(a){return a.length?a.map(x=>`• ${x.name}: £${x.avg.toFixed(0)} avg / £${x.median.toFixed(0)} median (${x.count})`).join('\n'):'No usable breakdown data'}
function parseCsv(s){const lines=s.replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean);if(!lines.length)return[];const head=split(lines[0]);return lines.slice(1).map(line=>{const vals=split(line),o={};head.forEach((h,i)=>o[h]=vals[i]??'');return o})}
function split(line){const out=[];let cur='',q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){cur+='"';i++}else q=!q}else if(c===','&&!q){out.push(cur);cur=''}else cur+=c}out.push(cur);return out}
