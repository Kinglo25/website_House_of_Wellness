/* Tests for the release parser and the stream ranker.
 *
 * Both are pure functions over strings, so this needs no server and no
 * network: every case below is a release name of the kind add-ons actually
 * hand back, asserted against the fields we claim to pull out of it. */

import { parseStream, parseSize, parseSeeders, parseGroup } from '../server/parse.js'
import { rankStreams, scoreRelease } from '../server/rank.js'

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

/* -------------------------------------------------------------------- done */

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
