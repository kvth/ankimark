# AnkiMark

Chrome extension that highlights Japanese words on any web page that you already
have notes for in Anki. Talks to Anki through
[AnkiConnect](https://ankiweb.net/shared/info/2055492159).

What gets highlighted, and in which colour, is up to you: you define **rules**, each
an Anki search plus a colour. Hover a word to see which rule it matched.
**Alt+click** opens the note in Anki's browser.

## Setup

1. Install AnkiConnect in Anki (add-on code `2055492159`) and keep Anki running.
2. Open `chrome://extensions`, turn on *Developer mode*, click *Load unpacked*, and
   pick this folder.
3. Click the AnkiMark icon. The first time, Anki shows an AnkiConnect permission
   dialog. Click *Yes* to allow the extension.
4. Click **Rules & settings…**:
   - set the **base filter**, usually your deck (`"deck:kaishi"`); the field suggests your decks
   - adjust the rules if you like
   - click **Load fields** and tick the field(s) holding the word (e.g. `Word`).
     If you tick none, each note's first field is used.
5. Click **Sync now**. Open tabs update right away.

The word list is synced again every hour and when the browser starts, as long as Anki is running.

## Rules

Each rule's search is combined with the base filter: `(base filter) (rule search)`.
Rules are checked top to bottom, and a word gets the colour of the **first** enabled rule
that one of its notes matches. Notes that match no rule aren't highlighted. Card searches
match a note if *any* of its cards match.

Default rules:

| Rule     | Search           | Colour |
|----------|------------------|--------|
| Leech    | `prop:lapses>=4` | red (off by default) |
| Mature   | `prop:ivl>=21`   | green  |
| Learning | `-is:new`        | orange |
| New      | `is:new`         | blue   |

More ideas (some are one-click examples in the settings): `is:due`, `rated:7:1`
(pressed Again in the last 7 days), `is:suspended`, `tag:something`, `prop:r<0.8`
(FSRS recall chance), or an empty search as a catch-all "everything else" at the bottom.

Enabling, disabling, reordering and recolouring rules applies immediately. Changing a
search, the base filter or the fields needs a sync; the popup and settings page show
when that's the case. **Check searches** shows how many notes each rule matches and
reports invalid searches.

## Backup

The settings page can **export** your rules and settings to a JSON file and **import**
them again (e.g. on another computer). Importing replaces the settings found in the file
and leaves the rest alone. The API key is never exported. After an import, sync once.

## How matching works

- Field values are cleaned: HTML, `<ruby>` readings, Anki furigana (`日本[にほん]`),
  cloze markers, `[sound:]` tags and parentheses (`勉強（する）` → `勉強`) are stripped.
  Lists like `食べる、喰べる` are split into separate words.
- On the page, the longest known word at each position wins (`日本語` beats `日本`).
- *Match conjugated forms* (on by default) is a simple rule, not a real deinflector.
  A verb or i-adjective whose stem contains kanji also matches its stem when hiragana
  follows: `食べる` matches `食べ|た`, `書く` matches `書|いて`, `高い` matches `高|かった`.
  Only the stem is highlighted.
- Kana-only words shorter than 2 characters are ignored by default (so `は`, `に` and
  similar particle-like notes don't flood the page). You can change this in the settings.
- Text inside inputs, textareas, `code`/`pre` and editable areas is never changed.

## Files

- `manifest.json`: MV3 manifest
- `background.js`: AnkiConnect calls, sync, hourly resync
- `config.js`: default rules and settings, search helpers (shared by all scripts)
- `japanese.js`: field cleaning and the word matcher (shared by all scripts)
- `content.js` / `content.css`: highlighting in pages, including content added later
- `popup.*`: rule toggles, sync button, per-site switch
- `options.*`: rules, base filter, fields and display settings
- `test/harness.html` + `test/chrome-stub.js`: runs the content script with a stubbed
  `chrome` API (`python3 -m http.server` in this folder, then open `/test/harness.html`)

## License

MIT, see [LICENSE](LICENSE).
