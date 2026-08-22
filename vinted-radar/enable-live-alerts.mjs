import fs from 'node:fs/promises';

const bot = process.argv[2];
if (!['trainers', 'clothing'].includes(bot)) {
  throw new Error('Usage: node enable-live-alerts.mjs trainers|clothing');
}

const monitorPath = new URL('./monitor.mjs', import.meta.url);
const runnerPath = new URL('./run-bot.mjs', import.meta.url);

let monitor = await fs.readFile(monitorPath, 'utf8');

const oldAlertBlock = `      if (shouldAlert) {
        qualifying.push({
          searchName: search.name,
          item,
          size,
          condition,
          resale,
          netProfit: profit,
          roi,
          buyScore: score,
          fakeRisk: risk,
          demand,
          strategy,
          exceptionalDeal: exceptional
        });
      }
`;

const newAlertBlock = `      if (shouldAlert) {
        const alert = {
          searchName: search.name,
          item,
          size,
          condition,
          resale,
          netProfit: profit,
          roi,
          buyScore: score,
          fakeRisk: risk,
          demand,
          strategy,
          exceptionalDeal: exceptional
        };
        qualifying.push(alert);
        await sendDiscord(webhook, alert);
      }
`;

if (monitor.includes(oldAlertBlock)) {
  monitor = monitor.replace(oldAlertBlock, newAlertBlock);
} else if (!monitor.includes('await sendDiscord(webhook, alert);')) {
  throw new Error('Could not enable immediate Discord dispatch');
}

const oldBatch = `qualifying.sort((a, b) => Number(b.exceptionalDeal) - Number(a.exceptionalDeal) || b.buyScore - a.buyScore || b.netProfit - a.netProfit);
for (const d of qualifying.slice(0, Number(config.maxAlertsPerRun ?? 10))) await sendDiscord(webhook, d);
`;
const newBatch = `// Qualifying bargains are dispatched immediately as they are detected.
qualifying.sort((a, b) => Number(b.exceptionalDeal) - Number(a.exceptionalDeal) || b.buyScore - a.buyScore || b.netProfit - a.netProfit);
`;

if (monitor.includes(oldBatch)) {
  monitor = monitor.replace(oldBatch, newBatch);
} else if (monitor.includes('for (const d of qualifying.slice')) {
  throw new Error('Could not disable end-of-scan Discord batching');
}

await fs.writeFile(monitorPath, monitor);

let runner = await fs.readFile(runnerPath, 'utf8');
const oldFreshness = 'maxAgeMinutes: 60, itemsPerSearch: 80';
const newFreshness = 'maxAgeMinutes: 10, itemsPerSearch: 80';
if (runner.includes(oldFreshness)) {
  runner = runner.replace(oldFreshness, newFreshness);
} else if (!runner.includes(newFreshness)) {
  throw new Error('Could not set 10-minute live freshness guard');
}

// Vinted sellers frequently write TN listings as "TNs", "Tans" or "Tan".
// Keep the model guard, but recognise those common seller spellings so genuine
// Air Max Plus bargains are not discarded before scoring.
const oldTnMatcher = "case 'Nike TN': return /(^|\\s)tn(\\s|$)/.test(t) || t.includes('air max plus') || t.includes('tuned');";
const newTnMatcher = "case 'Nike TN': return /(^|\\s)tns?(\\s|$)/.test(t) || /(^|\\s)tans?(\\s|$)/.test(t) || t.includes('air max plus') || t.includes('tuned');";
if (runner.includes(oldTnMatcher)) {
  runner = runner.replace(oldTnMatcher, newTnMatcher);
} else if (!runner.includes("tans?(\\s|$)")) {
  throw new Error('Could not enable TN/TNs/Tans alias matching');
}

await fs.writeFile(runnerPath, runner);

console.log(`${bot} live alerts configured: immediate Discord dispatch, 10-minute freshness guard and TN alias matching.`);
