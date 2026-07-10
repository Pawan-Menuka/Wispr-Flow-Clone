# Insertion Matrix

Manual test record for the §14.3 insertion chain (BLUEPRINT §22 — run quarterly + before every release). This file **is** the product's reliability moat: every failure recorded here becomes an `APP_QUIRKS` entry in `apps/desktop/src/main/services/insertion.ts`.

**How to test:** run the API + app with real keys, focus the target app's text field, hold `Ctrl+Win`, say a two-sentence phrase with a comma, release. Record:

- ✅ inserted correctly at caret
- ⚠️ inserted with quirk (describe: delay, formatting, focus)
- ❌ failed (fell back to clipboard+notification)
- Also verify: prior clipboard content restored afterward; `Ctrl+Z` undo removes the insertion.

| App | Field | Result | Undo | Clipboard restored | Notes / quirk entry |
|---|---|---|---|---|---|
| Notepad | body | | | | |
| Word (desktop) | document | | | | |
| Chrome — Gmail compose | body | | | | |
| Chrome — Google Docs | document | | | | expected hard case (canvas editor) |
| Chrome — address bar | omnibox | | | | |
| Edge — textarea (any form) | textarea | | | | |
| VS Code | editor | | | | |
| VS Code | terminal panel | | | | may need Ctrl+Shift+V quirk |
| Windows Terminal | shell | | | | quirk pre-seeded (Ctrl+Shift+V) |
| Slack (desktop) | message box | | | | |
| Discord (desktop) | message box | | | | |
| Notion (desktop) | page | | | | quirk pre-seeded (400 ms settle) |
| Obsidian | editor | | | | |
| Excel | cell | | | | destructive-replace risk — verify |
| IntelliJ / JetBrains | editor | | | | |
| Explorer — rename field | inline edit | | | | |

Last full pass: **never** — first pass due when Deepgram/Anthropic keys land.
