# Contributing to the Agro Client

Thanks for helping improve the marketplace client. This guide covers the
internationalization (i18n) setup and how to contribute translations.

## Getting started

1. Fork the repository and create a branch from `main`.
2. Install dependencies with `npm install` inside `agro-production/client`.
3. Run the dev server with `npm run dev` and the tests with `npm test`.
4. Open a pull request describing the change and linking the related issue.

## Internationalization (i18n)

### Supported locales

We ship a small, reviewed set of locales. English (`en`) is the source of
truth and the fallback for any missing translation.

| Locale | Language |
| ------ | -------- |
| `en`   | English (default / fallback) |
| `es`   | Spanish |
| `fr`   | French |
| `sw`   | Swahili |

Adding a new locale requires a maintainer review before it is merged.

### Message resources

Translations live in `src/i18n/messages/<locale>.json` as flat key/value
pairs. Keys are namespaced with dots, for example:

```json
{
  "marketplace.title": "Marketplace",
  "marketplace.price": "Price",
  "marketplace.unit.xlm": "XLM",
  "marketplace.unit.usdc": "USDC"
}
```

Rules for keys:

- Use lowercase dot-separated namespaces (`feature.element`).
- Never translate currency unit labels (`XLM`, `USDC`) — they must stay
  explicit and unambiguous.
- Do not embed numbers or dates in message strings; format them with the
  locale-aware helpers instead.

### Missing translations

If a key is absent from a locale file, the client falls back to the English
message automatically. Do not leave empty strings — omit the key instead so
the fallback applies.

### Number and date formatting

Use the shared formatting helpers (backed by `Intl.NumberFormat` and
`Intl.DateTimeFormat`) with the user's selected locale. Prices are always
displayed in their settlement currency (XLM or USDC) with the unit label
kept explicit — never convert or relabel the underlying currency.

### Locale preference

The user's selected locale is persisted in `localStorage` under the
`agro.locale` key and restored on load. Unsupported values fall back to
English.

## Contributing a translation

1. Copy `src/i18n/messages/en.json` to `src/i18n/messages/<locale>.json`.
2. Translate the values only — keep the keys unchanged.
3. Leave currency unit labels (`XLM`, `USDC`) untranslated.
4. Run `npm test` to confirm the i18n tests pass.
5. Open a pull request titled `i18n: add <locale> translations` and tag a
   maintainer for review.

Partial translations are welcome; untranslated keys fall back to English.
