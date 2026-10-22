# AnkiMark

Chrome and Firefox (desktop and Android) extension that highlights Japanese words on any web page that you already
have notes for in Anki. Talks to Anki through
[AnkiConnect](https://ankiweb.net/shared/info/2055492159).

What gets highlighted, and in which colour, is up to you: you define **rules**, each
an Anki search plus a colour. Hover a word to see which rule it matched.
**Alt+click** opens the note in Anki's browser.

## Setup

1. Install AnkiConnect in Anki (add-on code `2055492159`) and keep Anki running.
2. Load the extension:
   - **Chrome**: open `chrome://extensions`, turn on *Developer mode*, click
     *Load unpacked*, and pick this folder.
   - **Firefox** (140+): open `about:debugging#/runtime/this-firefox`, click
     *Load Temporary Add-on…*, and pick `manifest.json` in this folder. Temporary
     add-ons are removed when Firefox restarts; see [Firefox](#firefox) for a
     permanent install.
3. Click the AnkiMark icon. The first time, Anki shows an AnkiConnect permission
   dialog. Click *Yes* to allow the extension.
4. Click **Rules & settings…**:
   - set the **base filter**, usually your deck (`"deck:kaishi"`); or pick it under *Use a deck*
   - adjust the rules if you like
   - click **Load fields** and tick the field(s) holding the word (e.g. `Word`).
     If you tick none, each note's first field is used.
5. Click **Sync now**. Open tabs update right away.

After that it syncs every 5 minutes (adjustable under *Rules & settings*, or off), when the
browser starts, and when you open the popup and the last sync is over a minute old. A sync
only reads notes that are new or edited since the last one (via `notesModTime`; AnkiConnect
Android lacks it, so there only new notes are read, plus everything once a day). The rule searches run every time, since cards change state with every review.

## Page coverage

The popup shows how much of the visible Japanese text on the current page is marked,
counted in characters, as a percentage with a bar in the rule colours, and each rule's
share next to it. Only enabled rules count, and hidden text (closed menus etc.) is left out.

## Anki on another computer

AnkiConnect's address defaults to `http://localhost:8765`: Anki on the same computer, or
AnkiConnect Android on the same phone. To reach Anki on another machine (e.g. the phone
using your desktop's Anki over Wi-Fi), enter that machine's address under *Rules &
settings → AnkiConnect*, e.g. `http://192.168.0.20:8765`, and on that machine set
`"webBindAddress": "0.0.0.0"` in AnkiConnect's config and restart Anki. Anyone on the network
can then reach your Anki, so also set an `apiKey` there and enter it in AnkiMark.

## Firefox

The same code runs in both browsers. The manifest lists the background script both
ways (`service_worker` for Chrome, `scripts` for Firefox; each browser ignores the
other), and the scripts use `browser.*` when it exists, else `chrome.*`.

- **Site access.** Firefox may not grant an extension's site access at install. If
  the popup says so, click **Grant access** (or allow it under the add-on's
  *Permissions* tab in `about:addons`).
- **AnkiConnect permission.** Each Firefox install has its own random
  `moz-extension://…` origin, so Anki asks once per install.
- **Permanent install.** Firefox only keeps signed add-ons. Package with
  `npx web-ext build` and sign it on [addons.mozilla.org](https://addons.mozilla.org/developers/)
  ("On your own" keeps it unlisted), or with `npx web-ext sign --channel=unlisted`
  and an AMO API key. Check the package first with `npx web-ext lint`.

## Firefox for Android

AnkiMark runs in Firefox for Android (142+), with Anki on the phone:

1. Install [AnkiDroid](https://github.com/ankidroid/Anki-Android) and
   [AnkiConnect Android](https://github.com/KamWithK/AnkiconnectAndroid), open
   AnkiConnect Android and tap *Start service*. It serves the same API on
   `127.0.0.1:8765`. Turn battery optimisation off for both apps so the service keeps
   running.
2. Install a **signed** AnkiMark `.xpi` (see [Firefox](#firefox): `npx web-ext sign
   --channel=unlisted`), copy it to the phone, then in Firefox: *Settings → About
   Firefox*, tap the logo five times to enable the debug menu, go back to *Settings*
   and use *Install extension from file*. If your Firefox doesn't offer that entry,
   use Firefox Nightly, which does.
3. Open AnkiMark from the Firefox menu (*Extensions → AnkiMark*), grant access if
   asked, set the base filter and sync as on desktop.

Differences on Android:

- AnkiConnect Android has no `requestPermission`; AnkiMark then just checks that
  `deckNames` answers. It does support `deckNames`, `findNotes` and `notesInfo`, all
  AnkiMark needs to sync.
- A sync reads notes in batches (*Rules & settings → AnkiConnect → Notes per request*, default
  100). If AnkiConnect Android stops during a sync, lower it.
- Searches run through AnkiDroid and are slower than on desktop. Quoted searches such
  as `"deck:My Deck"` need AnkiDroid's new (Rust) backend, which current versions use.
- There is no hover or Alt+click on a touch screen, so the tooltip and "open in Anki"
  are desktop-only.
- For development, `npx web-ext run -t firefox-android` installs an unsigned copy
  over USB (adb, with *Remote debugging via USB* on in Firefox's settings).

## Rules

Each rule's search is combined with the base filter: `(base filter) (rule search)`.
Rules are checked top to bottom, and a word gets the colour of the **first** enabled rule
that one of its notes matches. Notes that match no rule aren't highlighted. Card searches
match a note if *any* of its cards match.

Default rules:

| Rule     | Search           | Colour |
|----------|------------------|--------|
| Leech    | `prop:lapses>=8` | red (off by default) |
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
and leaves the rest alone. The Anki address and API key are never exported. After an import, sync once.

## How matching works

- Field values are cleaned: HTML, `<ruby>` readings, Anki furigana (`日本[にほん]`),
  cloze markers, `[sound:]` tags and parentheses (`勉強（する）` → `勉強`) are stripped.
  Lists like `食べる、喰べる` are split into separate words.
- On the page, the longest known word at each position wins (`日本語` beats `日本`).
- *Match conjugated forms* (on by default, can be turned off in the settings) undoes verb
  and adjective endings step by step with a table of rules: 食べさせられなかった →
  食べさせられない → 食べさせられる → 食べさせる → 食べる. It covers past, negative, polite,
  て-form, たい, passive, causative, potential, volitional, ば, ている / ておく / てしまう /
  ちゃう, i-adjectives, する and 来る, and chains of them. The whole inflected word is
  highlighted, and `勉強した` also matches a note for the noun `勉強`. A form only counts
  when the result is a word in your notes, and a few checks keep ordinary kana from being
  read as verbs. The rules are written for AnkiMark (not copied from Yomitan).
- Kana-only words shorter than 2 characters are ignored by default (so `は`, `に` and
  similar particle-like notes don't flood the page). You can change this in the settings.
- Text inside inputs, textareas, `code`/`pre` and editable areas is never changed.

## Files

- `manifest.json`: MV3 manifest
- `background.js`: AnkiConnect calls, incremental sync, auto-sync
- `config.js`: default rules and settings, search helpers (shared by all scripts)
- `japanese.js`: field cleaning, conjugation rules and the word matcher (shared by all scripts)
- `content.js` / `content.css`: highlighting in pages, including content added later
- `popup.*`: page coverage, rule toggles, sync button, per-site switch
- `options.*`: rules, base filter, fields and display settings
- `test/japanese.test.mjs`: matcher and conjugation tests (`node --test test/*.test.mjs`)
- `test/harness.html` + `test/chrome-stub.js`: runs the content script with a stubbed
  `chrome` API (`python3 -m http.server` in this folder, then open `/test/harness.html`)

## License

MIT, see [LICENSE](LICENSE).
