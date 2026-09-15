/* The assertions. Run this through `run.js`, never directly: it is what
 * redirects the app's data directory somewhere disposable first.
 *
 * The parser and the ranker are pure functions over strings, so most of this
 * needs no server and no network: every case below is a release name of the
 * kind add-ons actually hand back, asserted against the fields we claim to
 * pull out of it. */

import { parseStream, parseSize, parseSeeders, parseGroup, parseVideoId, parseRuntime } from '../server/parse.js'
import { rankStreams, scoreRelease } from '../server/rank.js'
import { blocklist } from '../server/blocklist.js'
import { engine } from '../server/torrent.js'
import { checkForStalled, giveUp, stopWatchdog } from '../server/watchdog.js'
import { config } from '../server/config.js'
import { FailureTracker, BACKOFF_SECONDS } from '../server/backoff.js'
import { sanitize, qualitySuffix, planPath, importableFiles, importTorrent, linkOrCopy } from '../server/importer.js'
import fs from 'fs'
import os from 'os'
import path from 'path'

let passed = 0
let failed = 0

function ok (name, condition, extra = '') {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${name}${extra ? ` -> ${extra}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${extra ? ` -> ${extra}` : ''}`)
  }
}

const eq = (name, actual, expected) =>
  ok(name, actual === expected, actual === expected ? String(actual) : `got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`)

/* --------------------------------------------------------------- the parser */

console.log('\nParsing what add-ons actually send')
{
  // The Torrentio shape: branding in `name`, release in `title`, stats after it.
  const torrentio = parseStream({
    name: 'Torrentio\n1080p',
    title: 'Show.Name.S01E02.1080p.WEB-DL.DDP5.1.H.264-NTb\n👤 47 💾 2.31 GB ⚙️ ThePirateBay'
  })
  eq('resolution', torrentio.resolution, '1080p')
  eq('source', torrentio.source, 'web-dl')
  eq('codec from "H.264"', torrentio.codec, 'h264')
  eq('audio from "DDP5.1"', torrentio.audio, 'eac3')
  eq('channels from "DDP5.1"', torrentio.channels, '5.1')
  eq('audio glued to its channels ("AAC2.0")', parseStream({ title: 'Movie.1080p.WEB-DL.AAC2.0.H.264-GRP' }).audio, 'aac')
  eq('release group', torrentio.group, 'NTb')
  eq('tracker after the ⚙', torrentio.provider, 'ThePirateBay')
  eq('seeders from 👤', torrentio.seeders, 47)
  eq('size from 💾', torrentio.size, Math.round(2.31 * 1024 ** 3))
  eq('season', torrentio.season, 1)
  eq('episode', torrentio.episode, 2)

  const remux = parseStream({ title: 'Movie.2021.2160p.UHD.BluRay.REMUX.DV.HDR.TrueHD.7.1.Atmos-FraMeSToR' })
  eq('remux beats bluray', remux.source, 'remux')
  eq('2160p from UHD', remux.resolution, '2160p')
  eq('Dolby Vision', remux.dynamicRange, 'dv')
  eq('Atmos beats TrueHD', remux.audio, 'atmos')
  eq('channels after a dot separator', remux.channels, '7.1')

  const webrip = parseStream({ title: 'Show.S02.COMPLETE.720p.WEBRip.x265.AAC2.0-ABC' })
  eq('webrip is not web-dl', webrip.source, 'webrip')
  eq('x265 is hevc', webrip.codec, 'hevc')
  eq('season pack has no episode', webrip.episode, null)
  eq('season pack flagged', webrip.seasonPack, true)
  eq('season pack season', webrip.season, 2)

  const alternate = parseStream({ title: 'Show 3x07 HDTV XviD' })
  eq('3x07 season', alternate.season, 3)
  eq('3x07 episode', alternate.episode, 7)

  // The bug this guards: ".ts" is a container, not a telesync.
  const tsFile = parseStream({ behaviorHints: { filename: 'holiday.ts', videoSize: 900 } })
  eq('a .ts file is not a cam rip', tsFile.source, null)
  eq('.ts container', tsFile.container, 'ts')
  const realCam = parseStream({ title: 'Movie.2021.HDTS.XviD-GRP' })
  eq('an actual telesync still reads as cam', realCam.source, 'cam')

  // "x265.1080p" must not read as 5.1 channels.
  eq('digits inside a codec are not channels', parseStream({ title: 'Movie.x265.1080p' }).channels, null)

  const revision = parseStream({ title: 'Show.S01E01.PROPER.REPACK.1080p.BluRay.x264-GRP' })
  ok('proper', revision.proper)
  ok('repack', revision.repack)

  eq('videoSize hint wins over the text', parseStream({
    title: 'Show 💾 900 MB',
    behaviorHints: { videoSize: 12345 }
  }).size, 12345)

  eq('nothing parseable is null, not a guess', parseStream({ name: 'Some Add-on' }).resolution, null)
  eq('an empty stream does not throw', parseStream({}).releaseName, '')
}

console.log('\nSizes, seeders and groups on their own')
{
  eq('GB', parseSize('2.31 GB'), Math.round(2.31 * 1024 ** 3))
  eq('GiB is the same unit here', parseSize('1 GiB'), 1024 ** 3)
  eq('comma decimal', parseSize('1,5 GB'), Math.round(1.5 * 1024 ** 3))
  eq('MB', parseSize('700 MB'), 700 * 1024 ** 2)
  eq('no size', parseSize('Show S01E01'), null)

  eq('👤 count', parseSeeders('👤 47'), 47)
  eq('"Seeders: 8"', parseSeeders('Seeders: 8'), 8)
  eq('"12 seeders"', parseSeeders('12 seeders'), 12)
  eq('thousands separator', parseSeeders('👤 1,204'), 1204)
  eq('no seeder count', parseSeeders('1080p WEB-DL'), null)

  eq('trailing group', parseGroup('Movie.2021.1080p.WEB-DL-NTb'), 'NTb')
  eq('bracketed group', parseGroup('Movie 2021 1080p [YTS]'), 'YTS')
  eq('extension is not a group', parseGroup('Movie.2021.1080p.WEB-DL-NTb.mkv'), 'NTb')
  eq('a codec is not a group', parseGroup('Movie.2021.1080p-x264'), null)
  eq('stats are not a group', parseGroup('Movie.2021.1080p-NTb 👤 47 💾 2 GB'), 'NTb')
}

console.log('\nWhat was asked for: ids and runtimes')
{
  eq('series id season', parseVideoId('tt0944947:2:5').season, 2)
  eq('series id episode', parseVideoId('tt0944947:2:5').episode, 5)
  eq('a movie id has no episode', parseVideoId('tt0111161').episode, null)
  eq('a non-numeric tail is not an episode', parseVideoId('tt0944947:extra:bits').season, null)
  eq('an empty id does not throw', parseVideoId('').season, null)

  eq('"142 min"', parseRuntime('142 min'), 142)
  eq('"58min"', parseRuntime('58min'), 58)
  eq('"1h 30min"', parseRuntime('1h 30min'), 90)
  eq('"2h"', parseRuntime('2h'), 120)
  eq('a bare number is minutes', parseRuntime('45'), 45)
  eq('nothing usable', parseRuntime('feature length'), null)
  eq('undefined', parseRuntime(undefined), null)
}

/* --------------------------------------------------------------- the ranker */

const STREAMS = [
  { id: 'remux', name: 'Torrentio\n2160p', title: 'Movie.2021.2160p.BluRay.REMUX.HEVC.TrueHD.7.1.Atmos-GRP\n👤 9 💾 58 GB' },
  { id: 'web-h264', name: 'Torrentio\n1080p', title: 'Movie.2021.1080p.WEB-DL.AAC2.0.H.264-NTb.mp4\n👤 120 💾 2.4 GB' },
  { id: 'web-hevc', name: 'Torrentio\n1080p', title: 'Movie.2021.1080p.WEBRip.x265.DTS-HD.MA-XX.mkv\n👤 40 💾 4 GB' },
  { id: 'cam', name: 'Torrentio\nCAM', title: 'Movie.2021.HDTS.XviD\n👤 300 💾 900 MB' }
]

const order = settings => rankStreams(STREAMS, settings).map(stream => stream.id)

console.log('\nRanking: the profile decides what "best" means')
{
  const compatible = order({ streamProfile: 'compatible' })
  eq('compatible puts the H.264 MP4 first', compatible[0], 'web-h264')
  ok('compatible ranks the HEVC remux below it', compatible.indexOf('remux') > 0, compatible.join(' > '))

  const quality = order({ streamProfile: 'quality' })
  eq('best-picture puts the 4K remux first', quality[0], 'remux')

  const balanced = order({ streamProfile: 'balanced' })
  eq('balanced still avoids the cam', balanced.at(-1), 'cam')

  eq('an unknown profile falls back to balanced',
    order({ streamProfile: 'nonsense' }).join(), balanced.join())
}

console.log('\nRanking: rejections sink, they do not disappear')
{
  const ranked = rankStreams(STREAMS, { streamProfile: 'balanced' })
  eq('every stream is still returned', ranked.length, STREAMS.length)
  const cam = ranked.find(stream => stream.id === 'cam')
  ok('the cam rip is rejected', cam.rejections.length > 0, cam.rejections.join(', '))
  eq('a rejected stream is last', ranked.at(-1).id, 'cam')
  ok('the best stream is marked', ranked.find(stream => stream.best)?.id === 'web-h264' || ranked.find(stream => stream.best)?.id === 'remux')
  ok('nothing rejected is ever marked best', !ranked.some(stream => stream.best && stream.rejections.length))

  const capped = rankStreams(STREAMS, { streamProfile: 'quality', maxResolution: '1080p' })
  const remux = capped.find(stream => stream.id === 'remux')
  ok('2160p is rejected under a 1080p cap', remux.rejections.length > 0, remux.rejections.join(', '))
  ok('but it is still in the list', capped.some(stream => stream.id === 'remux'))
  eq('the 1080p file wins instead', capped.find(stream => stream.best)?.id, 'web-h264')

  const seeded = rankStreams(STREAMS, { streamProfile: 'quality', minSeeders: 50 })
  ok('a thin swarm is rejected', seeded.find(stream => stream.id === 'remux').rejections.length > 0)

  const sized = rankStreams(STREAMS, { streamProfile: 'quality', maxStreamSize: 10 })
  ok('an oversized file is rejected', sized.find(stream => stream.id === 'remux').rejections[0]?.includes('10 GB'))

  eq('an empty list is an empty list', rankStreams([], {}).length, 0)
}

console.log('\nRanking: the score can be explained')
{
  const { score, reasons } = scoreRelease(
    parseStream({ title: 'Movie.2021.1080p.WEB-DL.AAC2.0.H.264-NTb.mp4 👤 120' }),
    { streamProfile: 'compatible' }
  )
  ok('a good compatible release scores well', score > 1000, String(score))
  ok('every reason is labelled', reasons.every(reason => reason.label), JSON.stringify(reasons))
  ok('the reasons sum to the score', reasons.reduce((total, reason) => total + reason.delta, 0) === score)

  const sample = scoreRelease(parseStream({ title: 'Movie.2021.1080p.WEB-DL.sample.mkv' }), {})
  ok('a sample is rejected', sample.rejections.includes('sample'))

  const tiny = scoreRelease(parseStream({ title: 'Movie.2021.1080p.WEB-DL-GRP 💾 80 MB' }), {})
  ok('an 80 MB "1080p" file is penalised', tiny.reasons.some(reason => reason.delta < 0), JSON.stringify(tiny.reasons))
}

console.log('\nSize is judged against how long the thing actually is')
{
  // The band is deliberately wide (3-155 MB per minute at 1080p, following
  // Sonarr): this catches samples, trailers and mislabelled packs, it does not
  // judge how good an encode is.
  const at = (title, runtime) => scoreRelease(parseStream({ title }), {}, { runtime })
  const flagged = (result, text) => result.reasons.some(r => r.label.includes(text))

  ok('40 MB of "1080p" for a 45 min episode is flagged',
    flagged(at('Show.S01E01.1080p.WEB-DL.H.264-GRP \u{1F4BE} 40 MB', 45), 'small for 45 min'))
  ok('12 GB for that same 45 min episode is flagged the other way',
    flagged(at('Show.S01E01.1080p.WEB-DL.H.264-GRP \u{1F4BE} 12 GB', 45), 'large for 45 min'))
  ok('and a normal 2 GB episode is flagged neither way',
    !flagged(at('Show.S01E01.1080p.WEB-DL.H.264-GRP \u{1F4BE} 2 GB', 45), 'for 45 min'))

  // The point of the whole change: the same file, judged against two runtimes.
  const film = 'Movie.2021.1080p.WEB-DL.H.264-GRP \u{1F4BE} 400 MB'
  ok('400 MB is fine for a 45 min episode', !flagged(at(film, 45), 'small for'))
  ok('the same 400 MB is small for a 3 hour film', flagged(at(film, 180), 'small for 180 min'))

  // An HEVC encode at half the bitrate is a good file, not a suspicious one.
  ok('400 MB of H.264 over 180 min is flagged',
    flagged(at('Movie.2021.1080p.WEB-DL.H.264-GRP \u{1F4BE} 400 MB', 180), 'small for'))
  ok('the same size in HEVC is not',
    !flagged(at('Movie.2021.1080p.WEB-DL.x265-GRP \u{1F4BE} 400 MB', 180), 'small for'))

  // The flat floor was the whole check before runtime was available.
  ok('with no runtime it falls back to a flat floor',
    scoreRelease(parseStream({ title: 'Movie.1080p.WEB-DL-GRP \u{1F4BE} 80 MB' }), {}, {})
      .reasons.some(r => r.label === 'small for 1080p'))

  // A pack holds an unknown number of episodes, so per-minute limits say nothing.
  ok('a season pack skips the size check',
    !flagged(at('Show.S02.COMPLETE.1080p.WEB-DL-GRP \u{1F4BE} 20 GB', 45), 'for 45 min'))

  // A user-set limit rejects; a heuristic only ever nudges.
  eq('being large for the runtime is not a rejection',
    at('Movie.2021.1080p.WEB-DL-GRP \u{1F4BE} 40 GB', 90).rejections.length, 0)
}

console.log('\nIs it the episode we asked for?')
{
  const want = { season: 2, episode: 5 }
  const scoreFor = title => scoreRelease(parseStream({ title }), {}, want)

  const right = scoreFor('Show.S02E05.1080p.WEB-DL-GRP')
  eq('the right episode is not rejected', right.rejections.length, 0)
  ok('and is credited for being verifiable', right.reasons.some(r => r.label === 'confirmed S2E5'), JSON.stringify(right.reasons))

  const wrongEpisode = scoreFor('Show.S02E06.1080p.WEB-DL-GRP')
  ok('a different episode is rejected', wrongEpisode.rejections[0]?.includes('S2E6'), wrongEpisode.rejections.join())
  const wrongSeason = scoreFor('Show.S01E05.1080p.WEB-DL-GRP')
  ok('a different season is rejected', wrongSeason.rejections.length > 0, wrongSeason.rejections.join())

  const rightPack = scoreFor('Show.S02.COMPLETE.1080p.WEB-DL-GRP')
  eq('the right season pack is kept', rightPack.rejections.length, 0)
  ok('but nudged down, since the episode is one file inside it', rightPack.reasons.some(r => r.label === 'season pack'))
  const wrongPack = scoreFor('Show.S04.COMPLETE.1080p.WEB-DL-GRP')
  ok('a pack of the wrong season is rejected', wrongPack.rejections.length > 0, wrongPack.rejections.join())

  // Plenty of add-ons return a bare hash with no name. Silence is not a mismatch.
  const silent = scoreFor('Some Unnamed Release 1080p')
  eq('a release that states no episode is left alone', silent.rejections.length, 0)

  // A movie has nothing to check against.
  const movie = scoreRelease(parseStream({ title: 'Movie.2021.1080p.WEB-DL-GRP' }), {}, { season: null, episode: null })
  eq('a movie is never episode-checked', movie.rejections.length, 0)

  // And the whole check only runs when the caller says what it wants.
  const noContext = scoreRelease(parseStream({ title: 'Show.S02E06.1080p.WEB-DL-GRP' }), {}, {})
  eq('no context means no episode check', noContext.rejections.length, 0)
}

console.log('\nRanking end to end with context')
{
  const episodeStreams = [
    { id: 'wrong', title: 'Show.S02E06.1080p.WEB-DL.H.264-GRP\n\u{1F464} 400' },
    { id: 'right', title: 'Show.S02E05.720p.WEB-DL.H.264-GRP\n\u{1F464} 12' }
  ]
  const ranked = rankStreams(episodeStreams, { streamProfile: 'balanced' }, { season: 2, episode: 5, runtime: 45 })
  eq('the right episode wins even against a better-seeded wrong one', ranked[0].id, 'right')
  eq('and it is the marked pick', ranked.find(stream => stream.best)?.id, 'right')
  ok('the wrong episode is still listed, with the reason', ranked.at(-1).rejections[0]?.includes('not the S2E5'))
}

/* ------------------------------------------------------- blocklist + retry */

console.log('\nThe blocklist')
{
  blocklist.clear()
  blocklist.add({ infoHash: 'A'.repeat(40), name: 'Dead.Release', reason: 'No data for 10 minutes' })
  ok('a blocked hash is remembered', blocklist.has('a'.repeat(40)))
  eq('case does not matter', blocklist.has('A'.repeat(40)), true)
  eq('an unknown hash is not blocked', blocklist.has('b'.repeat(40)), false)
  eq('an empty hash is not blocked', blocklist.has(''), false)

  blocklist.add({ infoHash: 'a'.repeat(40), reason: 'a different reason' })
  eq('blocking twice does not duplicate', blocklist.list().length, 1)
  eq('and keeps the first reason', blocklist.list()[0].reason, 'No data for 10 minutes')

  ok('removing works', blocklist.remove('a'.repeat(40)))
  eq('and it is gone', blocklist.list().length, 0)

  // A swarm that was empty in March may be busy in June.
  blocklist.add({ infoHash: 'c'.repeat(40) })
  blocklist.list()[0].at = Date.now() - 40 * 24 * 60 * 60 * 1000
  eq('old entries are pruned', blocklist.prune(30), 1)
  eq('recent ones are not', blocklist.prune(30), 0)
  blocklist.clear()
}

console.log('\nA blocked release is rejected everywhere it could come back')
{
  const streams = [
    { id: 'blocked', infoHash: 'a'.repeat(40), title: 'Movie.2021.1080p.WEB-DL.H.264-GRP\n\u{1F464} 900' },
    { id: 'fine', infoHash: 'b'.repeat(40), title: 'Movie.2021.1080p.WEB-DL.H.264-NTb\n\u{1F464} 50' }
  ]
  const ranked = rankStreams(streams, {}, { blocked: ['A'.repeat(40)] })
  eq('the blocked one loses despite more seeders', ranked[0].id, 'fine')
  ok('and says why', ranked.at(-1).rejections[0]?.includes('blocked'), ranked.at(-1).rejections.join())
  eq('it is still listed', ranked.length, 2)
  eq('nothing is blocked when nothing is passed', rankStreams(streams, {}, {}).filter(s => s.rejections.length).length, 0)
}

console.log('\nThe watchdog: when has a grab actually given up?')
{
  // The engine is stubbed: this is about the state machine, not BitTorrent.
  // Nothing here touches the network or starts a client.
  const MINUTE = 60 * 1000
  let queue = []
  engine.list = () => queue
  config.update({ stallMinutes: 10 })

  const torrent = (over = {}) => ({
    infoHash: 'a'.repeat(40), status: 'downloading', progress: 0.2, downloaded: 1000, meta: {}, ...over
  })
  const names = list => list.map(t => t.infoHash.slice(0, 4))

  let t0 = 1_000_000_000

  // Bytes still arriving: never stalled, however long it takes.
  queue = [torrent({ downloaded: 1000 })]
  eq('first sight is never a stall', checkForStalled(t0).length, 0)
  queue = [torrent({ downloaded: 2000 })]
  eq('progress resets the clock', checkForStalled(t0 + 20 * MINUTE).length, 0)
  queue = [torrent({ downloaded: 3000 })]
  eq('still moving, still fine', checkForStalled(t0 + 40 * MINUTE).length, 0)

  // Frozen, but not for long enough yet.
  queue = [torrent({ downloaded: 3000 })]
  eq('frozen for 5 minutes is not a stall', checkForStalled(t0 + 45 * MINUTE).length, 0)
  eq('frozen for 9 minutes is not a stall', checkForStalled(t0 + 49 * MINUTE).length, 0)
  eq('frozen past the limit is', checkForStalled(t0 + 51 * MINUTE).length, 1)

  // Things the watchdog has no opinion about.
  stopWatchdog()
  for (const status of ['paused', 'done', 'seeding', 'stalled']) {
    queue = [torrent({ status })]
    checkForStalled(t0)
    queue = [torrent({ status })]
    eq(`a ${status} torrent is never stalled`, checkForStalled(t0 + 60 * MINUTE).length, 0)
  }
  stopWatchdog()
  queue = [torrent({ progress: 1 })]
  checkForStalled(t0)
  queue = [torrent({ progress: 1 })]
  eq('a finished torrent is never stalled', checkForStalled(t0 + 60 * MINUTE).length, 0)

  // Resuming by hand has to give it a fresh chance, not re-stall instantly.
  stopWatchdog()
  queue = [torrent({ downloaded: 500 })]
  checkForStalled(t0)
  queue = [torrent({ downloaded: 500 })]
  eq('it stalls once', checkForStalled(t0 + 11 * MINUTE).length, 1)
  queue = [torrent({ downloaded: 500, status: 'stalled' })]
  eq('and is not reported twice', checkForStalled(t0 + 12 * MINUTE).length, 0)
  queue = [torrent({ downloaded: 500, status: 'downloading' })]
  eq('resuming it does not stall it again immediately', checkForStalled(t0 + 13 * MINUTE).length, 0)
  queue = [torrent({ downloaded: 500, status: 'downloading' })]
  eq('it gets the full window over again', checkForStalled(t0 + 22 * MINUTE).length, 0)
  queue = [torrent({ downloaded: 500, status: 'downloading' })]
  eq('and only then stalls', checkForStalled(t0 + 24 * MINUTE).length, 1)

  // A torrent that is deleted must not leave its clock behind for the next
  // one that happens to reuse the hash.
  stopWatchdog()
  queue = [torrent({ downloaded: 700 })]
  checkForStalled(t0)
  queue = []
  checkForStalled(t0 + 30 * MINUTE)
  queue = [torrent({ downloaded: 700 })]
  eq('a deleted torrent leaves no clock behind', checkForStalled(t0 + 31 * MINUTE).length, 0)

  // Two at once, only one frozen.
  stopWatchdog()
  const other = 'b'.repeat(40)
  queue = [torrent({ downloaded: 100 }), torrent({ infoHash: other, downloaded: 100 })]
  checkForStalled(t0)
  queue = [torrent({ downloaded: 100 }), torrent({ infoHash: other, downloaded: 999 })]
  const both = checkForStalled(t0 + 11 * MINUTE)
  eq('only the frozen one is reported', names(both).join(), 'aaaa')

  stopWatchdog()
}

console.log('\nThe watchdog: giving up keeps your files')
{
  blocklist.clear()
  const hash = 'd'.repeat(40)
  const record = { id: hash, name: 'Dead.Release.1080p', status: 'downloading', error: null }
  let paused = null
  engine.record = id => (id === hash ? record : null)
  engine.pause = id => { paused = id; record.status = 'paused'; return record }

  const result = giveUp({ infoHash: hash, name: record.name, meta: { videoId: 'tt1:2:5' } }, { minutes: 10 })

  eq('it is paused, not deleted', paused, hash)
  eq('and labelled stalled rather than paused', result.status, 'stalled')
  ok('the reason says how long it waited', result.error.includes('10 minutes'), result.error)
  ok('and that the files are still there', result.error.includes('untouched'), result.error)
  ok('the release is blocked', blocklist.has(hash))
  eq('with the reason recorded', blocklist.list()[0].reason, 'No data for 10 minutes')
  eq('and what it was for', blocklist.list()[0].videoId, 'tt1:2:5')

  eq('giving up on something already gone is a no-op', giveUp({ infoHash: 'e'.repeat(40) }, { minutes: 10 }), null)

  // "No data for 1 minutes" reads like a bug report about the app itself.
  record.status = 'downloading'
  blocklist.clear()
  ok('one minute is singular', giveUp({ infoHash: hash, name: record.name }, { minutes: 1 }).error.startsWith('No data for 1 minute.'),
    giveUp({ infoHash: hash, name: record.name }, { minutes: 1 }).error)
  blocklist.clear()
}

console.log('\nStanding back from an add-on that keeps failing')
{
  const SECOND = 1000
  const tracker = new FailureTracker()
  const id = 'https://example.com/manifest.json'
  const t0 = 5_000_000

  eq('something that has never failed is available', tracker.isAvailable(id, t0), true)
  eq('and has no status to report', tracker.status(id, t0), null)

  // One blip costs nothing: the first period is zero on purpose.
  tracker.recordFailure(id, 'ETIMEDOUT', t0)
  eq('one failure does not skip it', tracker.isAvailable(id, t0), true)
  eq('but it is now on the record', tracker.status(id, t0).failures, 1)

  tracker.recordFailure(id, 'ETIMEDOUT', t0)
  eq('a second failure stands back a minute', tracker.isAvailable(id, t0), false)
  eq('and it is available again after that minute', tracker.isAvailable(id, t0 + 61 * SECOND), true)

  tracker.recordFailure(id, 'ETIMEDOUT', t0)
  eq('a third stands back five minutes', tracker.isAvailable(id, t0 + 4 * 60 * SECOND), false)
  eq('then it is back', tracker.isAvailable(id, t0 + 6 * 60 * SECOND), true)

  // Success wipes the slate, so a recovered add-on is not punished for history.
  tracker.recordSuccess(id)
  eq('success clears the backoff', tracker.status(id, t0), null)
  tracker.recordFailure(id, 'ETIMEDOUT', t0)
  eq('and the ladder starts from the bottom again', tracker.isAvailable(id, t0), true)

  // It must not escalate past the end of the ladder.
  const far = new FailureTracker()
  for (let i = 0; i < BACKOFF_SECONDS.length + 5; i += 1) far.recordFailure('x', 'nope', t0)
  const capped = far.status('x', t0)
  eq('the wait is capped at the longest period', Math.round(capped.retryInMs / 1000), BACKOFF_SECONDS.at(-1))
  eq('though the failure count keeps climbing', capped.failures, BACKOFF_SECONDS.length + 5)

  // What the UI reads.
  const reporting = new FailureTracker()
  reporting.recordFailure(id, 'HTTP 502', t0)
  reporting.recordFailure(id, 'HTTP 502', t0 + 30 * 60 * SECOND)
  // Half a minute into the one-minute backoff the second failure bought.
  const status = reporting.status(id, t0 + 30 * 60 * SECOND + 30 * SECOND)
  eq('it reports how long it has been failing', Math.round(status.failingForMs / 60000), 31)
  eq('and the last thing that went wrong', status.lastError, 'HTTP 502')
  ok('and that it is currently being skipped', status.skipped)

  eq('an empty id is ignored', tracker.recordFailure('', 'x'), null)
  eq('and always counts as available', tracker.isAvailable(''), true)
}

console.log('\nFiling a finished download where a media server can read it')
{
  eq('a colon becomes a dash, not nothing', sanitize('Alien: Covenant'), 'Alien - Covenant')
  eq('slashes are removed', sanitize('AC/DC: Live'), 'ACDC - Live')
  eq('so are the other characters Windows forbids', sanitize('What? "Now" <here>|'), 'What Now here')
  eq('no trailing dot, which Windows also dislikes', sanitize('Dr. Strangelove.'), 'Dr. Strangelove')
  eq('an empty name stays empty', sanitize(''), '')

  eq('quality suffix', qualitySuffix({ resolution: '1080p', source: 'web-dl' }), ' [1080p WEB-DL]')
  eq('resolution alone is enough', qualitySuffix({ resolution: '720p' }), ' [720p]')
  eq('nothing known, nothing claimed', qualitySuffix({}), '')

  const episode = planPath({
    meta: { type: 'series', seriesTitle: 'Breaking Bad', season: 2, episode: 5, episodeTitle: 'Breakage' },
    quality: { resolution: '1080p', source: 'web-dl' },
    fileName: 'breaking.bad.s02e05.1080p.web-dl.x264.mkv'
  })
  eq('an episode is filed where a scanner looks for it',
    episode, path.join('Series', 'Breaking Bad', 'Season 02', 'Breaking Bad - S02E05 - Breakage [1080p WEB-DL].mkv'))

  eq('season zero is Specials', planPath({
    meta: { type: 'series', seriesTitle: 'Doctor Who', season: 0, episode: 1 },
    quality: {},
    fileName: 'x.mkv'
  }), path.join('Series', 'Doctor Who', 'Specials', 'Doctor Who - S00E01.mkv'))

  eq('a movie gets its year', planPath({
    meta: { type: 'movie', seriesTitle: 'Arrival', year: '2016' },
    quality: { resolution: '2160p', source: 'bluray' },
    fileName: 'arrival.2016.2160p.bluray.mkv'
  }), path.join('Movies', 'Arrival (2016)', 'Arrival (2016) [2160p BluRay].mkv'))

  // What the user clicked is a fact; what the release name claims is not.
  eq('the clicked episode beats the parsed one', planPath({
    meta: { type: 'series', seriesTitle: 'Show', season: 2, episode: 5 },
    quality: { season: 9, episode: 9 },
    fileName: 'x.mkv'
  }), path.join('Series', 'Show', 'Season 02', 'Show - S02E05.mkv'))

  // Old queue entries only carry the combined "Show S1E2" title.
  eq('the episode suffix is stripped off an old title', planPath({
    meta: { type: 'series', title: 'The Wire S03E07', season: 3, episode: 7 },
    quality: {},
    fileName: 'x.mkv'
  }), path.join('Series', 'The Wire', 'Season 03', 'The Wire - S03E07.mkv'))

  // Rather than scatter mystery folders through someone's library.
  eq('an episode with no season is not filed', planPath({
    meta: { type: 'series', seriesTitle: 'Show' }, quality: {}, fileName: 'x.mkv'
  }), null)
  eq('a title with no name is not filed', planPath({ meta: { type: 'movie' }, quality: {}, fileName: 'x.mkv' }), null)
  eq('a non-video file is never filed', planPath({
    meta: { type: 'movie', seriesTitle: 'Arrival' }, quality: {}, fileName: 'readme.nfo'
  }), null)

  eq('samples are skipped', importableFiles([
    { name: 'movie-sample.mkv', length: 50 }, { name: 'movie.mkv', length: 5000 }
  ]).map(f => f.name).join(), 'movie.mkv')
  eq('so is anything that is not video', importableFiles([
    { name: 'movie.nfo', length: 9 }, { name: 'movie.mkv', length: 5000 }
  ]).map(f => f.name).join(), 'movie.mkv')
  eq('and deselected files', importableFiles([
    { name: 'a.mkv', length: 9000, selected: false }, { name: 'b.mkv', length: 10 }
  ]).map(f => f.name).join(), 'b.mkv')
  eq('biggest first', importableFiles([
    { name: 'small.mkv', length: 10 }, { name: 'big.mkv', length: 900 }
  ]).map(f => f.name).join(), 'big.mkv,small.mkv')
}

console.log('\nFiling it for real, on disk')
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-import-'))
  const downloads = path.join(root, 'downloads')
  const libraryDir = path.join(root, 'library')
  fs.mkdirSync(downloads, { recursive: true })

  const release = 'Breaking.Bad.S02E05.1080p.WEB-DL.x264-GRP'
  fs.mkdirSync(path.join(downloads, release), { recursive: true })
  const sourceFile = path.join(downloads, release, `${release}.mkv`)
  fs.writeFileSync(sourceFile, 'not really a video')

  const record = {
    id: 'a'.repeat(40),
    name: release,
    savePath: downloads,
    meta: { type: 'series', seriesTitle: 'Breaking Bad', season: 2, episode: 5, episodeTitle: 'Breakage' }
  }
  const files = [{ name: `${release}.mkv`, path: path.join(release, `${release}.mkv`), length: 18, selected: true }]

  config.update({ importFinished: false, libraryDir })
  eq('nothing happens while filing is turned off', importTorrent(record, { files, torrentName: release }), null)

  config.update({ importFinished: true, libraryDir })
  const imported = importTorrent(record, { files, torrentName: release })
  const expected = path.join(libraryDir, 'Series', 'Breaking Bad', 'Season 02', 'Breaking Bad - S02E05 - Breakage [1080p WEB-DL].mkv')
  eq('it lands under the name a scanner expects', imported.path, expected)
  eq('by hardlink, so it costs no extra disk', imported.mode, 'hardlink')
  ok('the file is really there', fs.existsSync(expected))
  eq('and it is the same bytes', fs.readFileSync(expected, 'utf8'), 'not really a video')
  eq('the same inode, in fact', fs.statSync(expected).ino, fs.statSync(sourceFile).ino)

  // The torrent must keep seeding from exactly what it had.
  ok('the download is left untouched', fs.existsSync(sourceFile))

  const again = importTorrent(record, { files, torrentName: release })
  eq('filing it twice does not overwrite', again.mode, 'already there')
  eq('and does not duplicate', fs.readdirSync(path.dirname(expected)).length, 1)

  // A file that vanished between finishing and filing. Has to be a different
  // episode: the one above already has a destination, and an existing
  // destination is answered before the source is ever looked at.
  const ghostRecord = { ...record, meta: { ...record.meta, episode: 6, episodeTitle: 'Peekaboo' } }
  const ghost = [{ name: 'gone.mkv', path: 'gone.mkv', length: 10, selected: true }]
  eq('a missing source file is not an error', importTorrent(ghostRecord, { files: ghost, torrentName: release }), null)
  eq('and leaves no empty folder behind', fs.readdirSync(path.dirname(expected)).length, 1)

  // Copy is the fallback when a hardlink cannot cross a filesystem.
  const copied = path.join(root, 'copy.mkv')
  eq('linkOrCopy hardlinks when it can', linkOrCopy(sourceFile, copied), 'hardlink')

  config.update({ importFinished: false })
  fs.rmSync(root, { recursive: true, force: true })
}

console.log('\nHanding a finished download to whoever is interested')
{
  // The engine tells the app a download finished; the app decides what that
  // means. This is that handover, which is all the engine knows about it.
  const record = { id: 'f'.repeat(40), name: 'Release.Name', meta: {} }
  engine.stats = () => ({ files: [{ name: 'a.mkv' }] })

  let got = null
  engine.onComplete = (rec, details) => { got = { rec, details } }
  engine._announceComplete(record, { name: 'Actual.Torrent.Name' })
  eq('the record is handed over', got.rec.id, record.id)
  eq('with its files', got.details.files.length, 1)
  eq('and the real release name, not the display title', got.details.torrentName, 'Actual.Torrent.Name')

  const survives = () => {
    try {
      engine._announceComplete(record, { name: 'x' })
      return true
    } catch {
      return false
    }
  }

  engine.onComplete = null
  ok('no handler at all is fine', survives())

  // A download finishing must never be able to crash the engine, whatever the
  // app does with the news.
  engine.onComplete = () => { throw new Error('importer exploded') }
  ok('and a handler that throws does not take the engine down', survives())
  engine.onComplete = null
}

/* -------------------------------------------------------------------- done */

console.log(`\n${passed} passed, ${failed} failed\n`)

export { passed, failed }
