# StreamHouse account server

What StreamHouse devices sign in to, so the library, *Continue watching*, add-ons
and stream settings follow you from the laptop to the TV to the phone. It is a
[Cloudflare Worker](https://developers.cloudflare.com/workers/) over a
[D1](https://developers.cloudflare.com/d1/) (SQLite) database, and both fit
comfortably inside Cloudflare's free plan.

It stores those lists and nothing else — never video, and never a password. A
device stretches the password into a key itself (PBKDF2-SHA256, 300,000 rounds,
salted with the email) and sends that; the server salts and hashes the key again
before storing it. Sign-in tokens are random, and only their hashes are kept.

## Deploying your own

You need a free Cloudflare account. From this folder:

```bash
npm install
npx wrangler login                          # opens Cloudflare in the browser
npx wrangler d1 create streamhouse-account  # prints a database_id
```

Put that `database_id` into [`wrangler.toml`](wrangler.toml), then:

```bash
npm run deploy
```

That creates the tables and publishes the Worker, printing its address —
`https://streamhouse-account.<your-subdomain>.workers.dev`. StreamHouse has the
project's own server built in (`DEFAULT_SERVER` in
[`server/sync.js`](../server/sync.js)); to use yours instead, change that, or
start StreamHouse with `STREAMHOUSE_ACCOUNT_SERVER=<address>`.

Anyone who finds the address can create an account until you say otherwise. Once
everyone in the house has one, set `ALLOW_SIGNUPS = "false"` in `wrangler.toml` and
run `npm run deploy` again.

## Running it locally

```bash
npm run dev     # http://127.0.0.1:8787, with a local database under .wrangler/
```

and in `streamhouse/`:

```bash
STREAMHOUSE_ACCOUNT_SERVER=http://127.0.0.1:8787 npm start
```

## How sync works

Every synced thing is one row: a *Continue watching* entry, a library title, the
add-on list, one setting. Each carries the time it was changed on the device that
changed it, and the newest edit of each row wins.

Each row also gets a number from the server that only goes up. A device remembers
the last number it has seen, so catching up is "everything after 1834", however long
it was switched off. Deleting something keeps its row with no value, so a device
that was off still hears about the deletion.

The device side — noticing edits, merging on first sign-in, retrying when offline —
is [`server/sync.js`](../server/sync.js), and the merge rules themselves are in
[`server/merge.js`](../server/merge.js), with tests in `npm test`.

## API

All JSON. Everything but sign-up and sign-in takes `Authorization: Bearer <token>`.

| Method | Path | |
|---|---|---|
| POST | `/v1/signup` | `{email, key, device}` → `{token, user}` |
| POST | `/v1/login` | `{email, key, device}` → `{token, user}` |
| POST | `/v1/logout` | ends this device's session |
| GET | `/v1/me` | `{user}` |
| GET | `/v1/sync?since=<n>` | `{items: [{kind, key, value, updatedAt}], cursor, more}`, 500 at a time |
| POST | `/v1/sync` | `{changes: [{kind, key, value, updatedAt}]}`, at most 40; `value: null` deletes |

`kind` is one of `progress`, `library`, `addons`, `setting`.

## Limits worth knowing

- **10 ms of CPU per request** on the free plan — the reason passwords are
  stretched on the device rather than here.
- **50 database queries per request** — the reason a push carries at most 40 changes.
- **10 wrong passwords in 15 minutes** locks that email out for the rest of the window.
- 100,000 requests a day. A device makes one a minute while it is open, plus one
  per burst of edits, so a household does not come close.
