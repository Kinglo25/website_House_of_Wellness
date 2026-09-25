/* Tests for the release parser, the stream ranker and the VLC hand-off.
 *
 * All pure functions, so this needs no server, no network and no VLC: most
 * cases below are release names of the kind add-ons actually hand back,
 * asserted against the fields we claim to pull out of them. */

import { parseStream, parseSize, parseSeeders, parseGroup } from '../server/parse.js'
import { rankStreams, scoreRelease } from '../server/rank.js'
import { candidatePaths, playableUrl, isLoopback, vlcArgs, positionFrom } from '../server/vlc.js'
import { fingerprint, localChanges, remoteWins } from '../server/merge.js'
import { byteRange } from '../server/mime.js'

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

console.log('\nByte ranges, as a player asks for them')
{
  const range = header => JSON.stringify(byteRange(header, 1000))
  eq('a plain range', range('bytes=100-199'), '{"start":100,"end":199}')
  eq('open-ended runs to the end', range('bytes=900-'), '{"start":900,"end":999}')
  eq('a suffix is the last bytes, not the first', range('bytes=-100'), '{"start":900,"end":999}')
  eq('a suffix longer than the file is all of it', range('bytes=-5000'), '{"start":0,"end":999}')
  eq('an end past the file stops at the file', range('bytes=100-5000'), '{"start":100,"end":999}')
  eq('a start past the file is unsatisfiable', range('bytes=1000-'), 'null')
  eq('an empty suffix is unsatisfiable', range('bytes=-0'), 'null')
  eq('no range at all is the whole file', range(undefined), '{"start":0,"end":999}')
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
  eq('DTS-HD audio is not a group', parseGroup('Movie.2021.2160p.BluRay.HEVC.DTS-HD.mkv'), null)
  eq('nor what follows WEB-DL', parseGroup('Movie.2021.1080p.WEB-DL.x264.AAC.mkv'), null)
  eq('nor DTS-HD.MA', parseGroup('Movie.2021.2160p.BluRay.DTS-HD.MA.5.1'), null)
  eq('a group after DTS-HD.MA still is', parseGroup('Movie.2021.2160p.BluRay.REMUX.HEVC.DTS-HD.MA.7.1-FGT'), 'FGT')
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

/* ------------------------------------------------------------ VLC hand-off */

console.log('\nVLC: finding it, starting it, reading it back')
{
  const windows = candidatePaths({
    platform: 'win32',
    env: { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', PATH: 'C:\\tools' }
  })
  eq('64-bit install first', windows[0], 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe')
  eq('then the 32-bit one', windows[1], 'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe')
  ok('then PATH', windows.includes('C:\\tools\\vlc.exe'), windows.join(' ; '))
  eq('VLC_PATH overrides everything', candidatePaths({ platform: 'win32', env: { VLC_PATH: 'D:\\vlc\\vlc.exe', ProgramFiles: 'C:\\x' } }).join(), 'D:\\vlc\\vlc.exe')
  eq('macOS app bundle', candidatePaths({ platform: 'darwin', env: {} })[0], '/Applications/VLC.app/Contents/MacOS/VLC')
  eq('Linux looks on PATH', candidatePaths({ platform: 'linux', env: { PATH: '/usr/bin:/snap/bin' } }).join(), '/usr/bin/vlc,/snap/bin/vlc')

  eq('a stream URL is accepted', playableUrl('http://127.0.0.1:11471/api/stream/abc/0'), 'http://127.0.0.1:11471/api/stream/abc/0')
  eq('a local file is refused', playableUrl('file:///C:/Windows/win.ini'), null)
  eq('a VLC option is refused', playableUrl('--extraintf=telnet'), null)
  eq('nothing is refused', playableUrl(undefined), null)

  ok('127.0.0.1 is this computer', isLoopback('127.0.0.1'))
  ok('::1 is this computer', isLoopback('::1'))
  ok('IPv4-mapped loopback is this computer', isLoopback('::ffff:127.0.0.1'))
  ok('a phone is not', !isLoopback('192.168.1.40'))
  ok('::1 is not a prefix match', !isLoopback('::10'))

  const args = vlcArgs({ url: 'http://127.0.0.1:11471/api/stream/abc/0', title: 'Movie', start: 754.6, httpPort: 50123, httpPassword: 'secret' })
  eq('the stream is the last argument', args.at(-1), 'http://127.0.0.1:11471/api/stream/abc/0')
  ok('resumes at the saved second', args.includes('--start-time=754'), args.join(' '))
  ok('web interface on loopback only', args.includes('--http-host=127.0.0.1'))
  ok('its own window, whatever VLC preferences say', args.includes('--no-one-instance'))
  ok('no start time from the beginning', !vlcArgs({ url: 'http://x/', httpPort: 1, httpPassword: 'p' }).some(arg => arg.startsWith('--start-time')))

  eq('position read back', JSON.stringify(positionFrom({ time: 120, length: 5400, state: 'playing' })), '{"time":120,"duration":5400}')
  eq('an unknown length is kept as 0', positionFrom({ time: 60, length: -1 })?.duration, 0)
  eq('0 seconds is not a position — a resume seek has not landed', positionFrom({ time: 0, length: 5400 }), null)
  eq('no answer is not a position', positionFrom(null), null)
}

/* ------------------------------------------------------------- account sync */

console.log('\nAccount sync: what gets pushed')
{
  const entry = { id: 'tt1', time: 300, duration: 5400, updatedAt: 1000 }
  const stamp = value => value?.updatedAt || 0

  const fresh = localChanges({ kind: 'progress', current: { tt1: entry }, stamp, now: 9999 })
  eq('a never-synced item is pushed', fresh.length, 1)
  eq('with its own date', fresh[0].updatedAt, 1000)

  eq('an item unchanged since the last sync is not',
    localChanges({ kind: 'progress', current: { tt1: entry }, agreed: { tt1: fingerprint(entry) }, stamp }).length, 0)

  const moved = localChanges({ kind: 'progress', current: { tt1: { ...entry, time: 600, updatedAt: 2000 } }, agreed: { tt1: fingerprint(entry) }, stamp })
  eq('an item edited since is', moved[0]?.updatedAt, 2000)

  const gone = localChanges({ kind: 'progress', current: {}, agreed: { tt1: fingerprint(entry) }, stamp, changedAt: 3000 })
  eq('a deleted item is pushed as a deletion', gone[0]?.value, null)
  eq('dated when this device last edited that kind', gone[0]?.updatedAt, 3000)
  eq('an item already agreed deleted is not pushed again',
    localChanges({ kind: 'progress', current: {}, agreed: { tt1: null }, stamp }).length, 0)

  eq('settings are never pushed as deletions',
    localChanges({ kind: 'setting', current: {}, agreed: { theme: fingerprint('midnight') }, deletable: false }).length, 0)
  eq('a dateless item falls back to now', localChanges({ kind: 'setting', current: { theme: 'day' }, now: 4242 })[0]?.updatedAt, 4242)
}

console.log('\nAccount sync: who wins')
{
  const stamp = value => value?.updatedAt || 0
  const mine = { id: 'tt1', time: 600, updatedAt: 2000 }
  const older = { kind: 'progress', key: 'tt1', value: { id: 'tt1', time: 300, updatedAt: 1000 }, updatedAt: 1000 }
  const newer = { kind: 'progress', key: 'tt1', value: { id: 'tt1', time: 900, updatedAt: 3000 }, updatedAt: 3000 }

  ok('untouched here: the server copy wins', remoteWins({ remote: newer, local: older.value, agreed: fingerprint(older.value), stamp }))
  ok('edited here, server older: this device wins', !remoteWins({ remote: older, local: mine, agreed: fingerprint({ id: 'tt1', time: 0 }), stamp }))
  ok('edited here, server newer: the server wins', remoteWins({ remote: newer, local: mine, agreed: fingerprint({ id: 'tt1', time: 0 }), stamp }))
  ok('first sync, both have it: newest wins (here)', !remoteWins({ remote: older, local: mine, agreed: undefined, stamp }))
  ok('first sync, both have it: newest wins (server)', remoteWins({ remote: newer, local: mine, agreed: undefined, stamp }))
  ok('nothing here yet: the server copy wins', remoteWins({ remote: older, local: null, agreed: undefined, stamp }))

  const accountTheme = { kind: 'setting', key: 'theme', value: 'day', updatedAt: 500 }
  ok('a new device takes the account\'s settings', remoteWins({ remote: accountTheme, local: 'midnight', agreed: undefined }))
  ok('unless it changed them itself since', !remoteWins({ remote: accountTheme, local: 'midnight', agreed: undefined, changedAt: 900 }))

  const removed = { kind: 'progress', key: 'tt1', value: null, updatedAt: 2500 }
  ok('a deletion from elsewhere removes an untouched item', remoteWins({ remote: removed, local: older.value, agreed: fingerprint(older.value), stamp }))
  ok('but not one this device has watched further since', !remoteWins({ remote: removed, local: newer.value, agreed: fingerprint(older.value), stamp }))
}

/* -------------------------------------------------------------------- done */

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
