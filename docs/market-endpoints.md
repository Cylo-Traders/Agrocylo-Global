# Market demand endpoints

Public, read-only. Shapes match `client/src/types/demand.ts`. Source: `server/src/services/marketService.ts`.

| Endpoint | Returns |
| --- | --- |
| `GET /market/demand` | `DemandData` (`volume`, `intents`, `heatMap`, 30-day `trend`) |
| `GET /market/buyer-intents` | `BuyerIntent[]` (50 most recent buyer demands) |
| `GET /market/heatmap` | `HeatMapPoint[]` — demand aggregated by region; coordinates are the mean of the buyers' saved locations, `intensity` is region volume / max region volume (0–1). Regions with no located buyer are omitted. |
| `GET /market/trend?days=30` | `DemandTrendPoint[]` — one point per day, `days` clamped to 1–365 |

Demand rows have no category, so volume is reported under `Other`. Intents whose buyer has no saved location use `[0, 0]` coordinates.

## Currencies
Supported currencies live in `server/src/constants/currencies.ts` (XLM, USDC with 7 decimals; STRK legacy, rejected on new writes). Invalid currencies return 400.
