# Agro Production Server

This backend service provides APIs for campaign management, investment tracking, and price analytics.

## Endpoints

### Campaigns
- `GET /api/campaigns`: List all campaigns (paginated).
- `GET /api/campaigns/:id`: Get campaign details.
- `GET /api/campaigns/farmer/:address`: Get campaigns by farmer.

### Investments
- `GET /api/investments/:address`: Get investments by investor address.
- `GET /api/campaigns/:id/investors`: Get investors for a specific campaign.

### Analytics
- `GET /api/analytics/price-history?product=tomato`: Get price aggregation and history.

## Development
- `npm install`: Install dependencies.
- `npm run dev`: Start development server.
- `npm test`: Run tests.
