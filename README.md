# Робочі дні (Obsidian plugin)

A calendar of days worked for Obsidian, on desktop and Android. It is mobile-first and is built to sit inside [Фінанси Марка](https://github.com/marktomchik/Marks-Finance) as a tab. Without that plugin it opens in its own view (ribbon icon or the command «Відкрити робочі дні»).

## What it does

- **Calendar:** a Monday–Sunday grid.
  - Tap a day to mark it as worked at the selected workplace; tap again to unmark it.
  - Long-press a day, or switch on «Деталі», to change the workplace, the extra pay for that day, or add a note.
  - Each worked day shows its pay. The extra pay is shown separately (for example `+20`).
- **Workplaces:** for example, several pharmacies. Each has:
  - a colour;
  - a **history of daily rates**: a new rate applies from its start date, and earlier days keep the old rate;
  - a **default extra per day** (tips), which you can override for a single day.
- **Totals for the month:** days worked, rates, extras and the total, split by workplace. There is also a year card with every month.
- **Settling up with the boss:** for each workplace you see how much to ask for. Enter what the boss actually paid, and it shows the difference (±).
- **«Затвердити місяць»** (approve the month) adds the expected income for each workplace into «План» in Фінанси Марка.
  - Once a month is approved, later changes to its days update the plan entry right away.
  - When you enter what the boss paid, the entry becomes «підтверджено» (confirmed).
- **Import from the old HTML calendar** (Settings → Робочі дні):
  1. Open the old `kalendarz-finanse.html` in the same browser, press F12 → Console and run `copy(localStorage.getItem('kalendarz_finanse_data'))`.
  2. Paste the result into the import field, choose the workplace and press «Імпортувати».

  The format is `{"YYYY-MM-DD": true}`. Days that already exist are not changed.

## Data

Everything is stored in one vault file, `Фінанси/workdays.json` (configurable). It does not use browser `localStorage`, so the data syncs with the vault and does not get lost.

Disabling the plugin hides the tab only:
- the file stays;
- plan entries already added to Фінанси stay in «План».

The plugin never replaces existing plan entries with an empty list unless you remove the last approval yourself. This protects the history when the file has not synced yet.

```json
{
  "version": 1,
  "places": [{ "id": "pl1", "name": "Аптека", "bonus": 20, "color": "#4e79a7", "rates": [{ "from": "2026-01-01", "rate": 240 }] }],
  "days": { "2026-11-03": { "place": "pl1" }, "2026-11-04": { "place": "pl1", "extra": 35, "note": "нічна" } },
  "boss": { "2026-11": { "pl1": 520 } },
  "approved": { "2026-11": true }
}
```

## Integration with Фінанси Марка

The plugin uses the Фінанси Extensions API, version 1 ([EXTENSIONS.md](https://github.com/marktomchik/Marks-Finance/blob/main/EXTENSIONS.md)):
- `registerTab` adds the «Робочі дні» tab. The month follows the Фінанси header.
- `setPlanEntries("mark-workdays", …)` writes one income line per workplace for each approved month.

Фінанси Марка 1.3.0 or newer is required for the tab.

## Install

- **BRAT:** «Add a beta plugin» → `marktomchik/Marks-workdays`.
- **Manually:** copy `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/mark-workdays/`, then enable «Робочі дні».

Build from source:

```bash
npm install
npm run build
VAULT_PLUGIN_DIR="<vault>/.obsidian/plugins/mark-workdays" npm run install-vault
```

## License

MIT
