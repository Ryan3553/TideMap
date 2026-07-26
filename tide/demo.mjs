// Quick eyeball check: today's tide curve + next 4 turning points.
// Run: node demo.mjs

import { predict, predictRange, nextTurningPoints } from './tauranga-tide.js';

const now = new Date();
console.log(`Tauranga tide — now: ${now.toISOString()}`);
console.log(`Height right now: ${predict(now).toFixed(2)} m above chart datum\n`);

console.log('Next 4 turning points:');
for (const tp of nextTurningPoints(now, 4)) {
  console.log(`  ${tp.type.padEnd(4)}  ${tp.time.toISOString().replace('T', ' ').slice(0, 16)} UTC  ${tp.height.toFixed(2)} m`);
}

console.log('\n24h curve, sampled hourly:');
const start = new Date(Math.floor(now.getTime() / 3600000) * 3600000);
const end = new Date(start.getTime() + 24 * 3600000);
for (const { t, h } of predictRange(start, end, 60)) {
  const barLen = Math.round(h * 20);
  console.log(`  ${t.toISOString().slice(11, 16)}  ${h.toFixed(2)} m  ${'#'.repeat(Math.max(0, barLen))}`);
}
