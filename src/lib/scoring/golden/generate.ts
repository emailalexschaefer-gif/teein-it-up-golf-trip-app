// Run on purpose only: tsx src/lib/scoring/golden/generate.ts
import { writeFileSync } from 'node:fs'
import { computeGolden } from './goldenCases'
writeFileSync('src/lib/scoring/golden/stableford.golden.json', JSON.stringify(computeGolden(), null, 1) + '\n')
console.log('golden fixture written')
