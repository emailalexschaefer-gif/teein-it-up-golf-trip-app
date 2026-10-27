import React from 'react'
import { createRoot } from 'react-dom/client'
import EventHighlightsPlayer from '@/components/memories/EventHighlightsPlayer'
import { limitToTopFive } from '@/lib/trips/topFive'
import type { Slide } from '@/lib/trips/slideshowDeck'

const svg = (w: number, h: number, c1: string, c2: string) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w/2}" cy="${h*0.38}" r="${Math.min(w,h)*0.14}" fill="#e9c9a0"/><rect x="${w*0.38}" y="${h*0.5}" width="${w*0.24}" height="${h*0.4}" fill="#1f3b5c"/></svg>`)
const LAND = svg(1600, 900, '#7ec8ff', '#2f7d32'), PORT = svg(900, 1200, '#ffd27e', '#2f7d32')
const long = 'Christopher Montgomery-Smith'
const photo = (o: Partial<Extract<Slide,{kind:'photo'}>>): Slide => ({ kind: 'photo', momentId: 'm1', imageUrl: LAND, caption: null, roundName: 'Round 1', holeNumber: 7, playerName: 'Alex Schaefer', sourceType: 'moment' as never, sideCompName: null, organiserFavourite: false, ...o })
const names = ['Alex Schaefer','Darren "Daz" Fitzpatrick-Jones','Pat Three','Test Four','Sam Five','Jo Six','Kim Seven','Lee Eight']
const std = (pts: number[], key: 'roundPoints' | 'totalPoints') => pts.map((p, i) => ({ playerId: 'p' + i, playerName: names[i % names.length], [key]: p, position: i + 1 }))
const top = (rows: any[]) => limitToTopFive(rows)
const hl = (o: any) => ({ kind: 'maker', icon: '\u{1F525}', title: 'Hot Start', playerName: 'Alex Schaefer', statLine: 'Birdied the first 3 holes', ...o })
const tied = [1,2,3,4,4,4,7].map((position, i) => ({ playerId: 'q'+i, playerName: names[i%8], totalPoints: 40-i, position }))
const cases: Record<string, Slide> = {
  'photo-landscape': photo({ caption: 'Absolute scenes on the 7th tee as the whole group watched the longest drive of the day sail over the water and land miles past anything seen all week, a long caption that must wrap sensibly', playerName: long }),
  'photo-portrait': photo({ imageUrl: PORT, momentId: 'm2', caption: 'Portrait moment', sideCompName: 'Nearest the Pin' }),
  'photo-short': photo({ momentId: 'm3', playerName: null, holeNumber: null, caption: null, roundName: 'Round 1' }),
  'sg-photo': { kind: 'sideGameWinner', sideCompId: 's1', label: 'Nearest the Pin', holeNumber: 11, winnerName: long, winnerImageUrl: PORT } as Slide,
  'sg-photo-land': { kind: 'sideGameWinner', sideCompId: 's1', label: 'Nearest the Pin', holeNumber: 11, winnerName: 'Alex Schaefer', winnerImageUrl: LAND } as Slide,
  'sg-nophoto': { kind: 'sideGameWinner', sideCompId: 's1', label: 'Longest Drive', holeNumber: 5, winnerName: long, winnerImageUrl: null } as Slide,
  'mb-card': { kind: 'makersBreakersCard', highlight: hl({}) } as Slide,
  'mb-long': { kind: 'makersBreakersCard', highlight: hl({ kind: 'breaker', icon: '\u{1F4A5}', title: 'The Unbelievably Long Awards Title Here', playerName: long, statLine: 'Scored a staggering eleven over par across the opening nine holes of the day', roster: names.map((n, i) => ({ playerId: 'r' + i, playerName: n })) }) } as Slide,
  'mb-divider': { kind: 'makersBreakersDivider', roundId: 'r1', roundName: 'Round 1' } as Slide,
  'results-5': { kind: 'roundResults', roundId: 'r1', roundName: 'Round 1', standings: std([41,38,37,35,33], 'roundPoints'), moreTied: null } as Slide,
  'results-2': { kind: 'roundResults', roundId: 'r1', roundName: 'Round 1', standings: std([41,38], 'roundPoints'), moreTied: null } as Slide,
  'results-tied': { kind: 'roundResults', roundId: 'r1', roundName: 'Round 1', standings: top(tied.map(t => ({ ...t, roundPoints: t.totalPoints }))).rows, moreTied: top(tied).moreTied } as Slide,
  'cumulative-5': { kind: 'cumulativeResults', roundId: 'r2', roundName: 'Round 2', roundsIncluded: 2, standings: std([80,77,70,66,60], 'totalPoints'), moreTied: null } as Slide,
  'leaderboard-5': { kind: 'leaderboard', entries: std([80,77,70,66,60], 'totalPoints'), page: 1, totalPages: 1, championDeclared: true, endedEarly: false } as Slide,
  'leaderboard-2': { kind: 'leaderboard', entries: std([41,38], 'totalPoints'), page: 1, totalPages: 1, championDeclared: true } as Slide,
  'leaderboard-early-tied': { kind: 'leaderboard', entries: top(tied).rows, page: 1, totalPages: 1, championDeclared: false, endedEarly: true, moreTied: top(tied).moreTied } as Slide,
  'champion': { kind: 'champion', champions: [{ playerId: 'p1', playerName: long, totalPoints: 80 }], hasTie: false, photoUrl: null } as Slide,
}
;(window as any).__plays = 0
const origPlay = HTMLMediaElement.prototype.play
HTMLMediaElement.prototype.play = function () { (window as any).__plays++; return origPlay.call(this) }
const c = decodeURIComponent(location.hash.slice(1)) || 'photo-landscape'
createRoot(document.getElementById('root')!).render(<EventHighlightsPlayer slides={[cases[c], cases[c]]} durationSeconds={10} onExit={() => {}} />)
