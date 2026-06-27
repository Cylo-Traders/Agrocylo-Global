# Request Logging & Monitoring Guide

This document describes the request logging and monitoring capabilities of the Agrocylo backend.

## Request Logging

Every HTTP request is automatically logged with detailed information for debugging and monitoring.

### Log Format

#### Development Format
```
2026-06-27 10:30:45:123 info: HTTP request rid=12a3b456-c789-d012-e345-f67890abcdef
```

#### Production Format (JSON)
```json
{
  "level": "info",
  "message": "HTTP request",
  "timestamp": "2026-06-27T10:30:45.123Z",
  "requestId": "12a3b456-c789-d012-e345-f67890abcdef",
  "method": "GET",
  "path": "/api/products",
  "status": 200,
  "durationMs": 45.23,
  "userId": "user-12345",
  "contentLength": 2048
}
```

### Logged Fields

- **requestId**: Unique identifier for request tracing (generated or from `x-request-id` header)
- **method**: HTTP method (GET, POST, PUT, DELETE, PATCH, etc.)
- **path**: Request path with query string
- **status**: HTTP response status code
- **durationMs**: Request processing time in milliseconds
- **userId**: User ID if authenticated (optional)
- **contentLength**: Response content length (optional)
- **error**: Error message if request failed
- **stack**: Error stack trace if available

### Request ID Tracing

Each request gets a unique request ID for tracing across services:

**Automatic Generation:**
- Generated as UUID if not provided
- Included in all logs for that request

**Using Existing Request ID:**
```bash
curl -H "x-request-id: my-trace-id" http://localhost:5000/api/products
```

The server includes the request ID in the response:
```bash
x-request-id: my-trace-id
```

Use this to correlate logs across services.

## Error Logging

Errors are logged with full context for debugging:

```json
{
  "level": "error",
  "message": "HTTP request error",
  "timestamp": "2026-06-27T10:30:45.123Z",
  "requestId": "12a3b456-c789-d012-e345-f67890abcdef",
  "method": "POST",
  "path": "/api/orders",
  "status": 500,
  "durationMs": 125.45,
  "userId": "user-12345",
  "error": "Database connection failed",
  "stack": "Error: Database connection failed\n    at Object.<anonymous> (/app/src/db/connection.ts:45:23)\n..."
}
```

## Log Levels

The application supports the following log levels (in order of severity):

| Level | Environment Default | Description |
|-------|-------------------|-------------|
| error | always | Errors that require attention |
| warn | production | Warnings about potential issues |
| info | all | General informational messages |
| http | all | HTTP request details |
| debug | development | Detailed debugging information |

### Configure Log Level

In development, logs default to `debug`. In production, logs default to `warn`.

Override with environment variable:
```bash
LOG_LEVEL=debug  # Show all logs
LOG_LEVEL=error  # Show only errors
```

## Performance Metrics

The `/metrics` endpoint provides performance metrics:

```bash
curl http://localhost:5000/metrics
```

Response:
```json
{
  "totalRequests": 1523,
  "successfulRequests": 1498,
  "failedRequests": 25,
  "requestErrorRate": 1.64
}
```

### Protect Metrics Endpoint

Protect the metrics endpoint in production with an API key:

```bash
METRICS_API_KEY="your-secret-key"
```

Access with Bearer token:
```bash
curl -H "Authorization: Bearer your-secret-key" http://localhost:5000/metrics
```

Or with x-metrics-api-key header:
```bash
curl -H "x-metrics-api-key: your-secret-key" http://localhost:5000/metrics
```

## Health Checks

The `/health` endpoint reports service health:

```bash
curl http://localhost:5000/health
```

Response:
```json
{
  "status": "UP",
  "timestamp": "2026-06-27T10:30:45.123Z",
  "service": "Agrocylo-Backend",
  "env": "development",
  "database": "UP",
  "supabase": "UP"
}
```

### Health Check in Docker

The Docker health check runs this endpoint every 30 seconds:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', (res) => { if (res.statusCode !== 200) throw new Error(res.statusCode) })"
```

## Viewing Logs

### Development

Logs appear in the console:
```bash
npm run dev
```

Example output:
```
2026-06-27 10:30:45:123 info: HTTP request rid=12a3b456-c789-d012-e345-f67890abcdef
2026-06-27 10:30:45:145 info: Health check endpoint hit rid=12a3b456-c789-d012-e345-f67890abcdef
```

### Docker

View logs with docker-compose:
```bash
docker-compose logs -f backend
```

### Production

Logs are output as JSON:
```json
{"level":"info","message":"HTTP request","timestamp":"2026-06-27T10:30:45.123Z","requestId":"..."}
```

Parse with standard tools:
```bash
# Using jq to filter errors
docker logs app | jq 'select(.level=="error")'

# Using grep
docker logs app | grep "error"

# Save to file
docker logs app > logs.txt
```

## Monitoring Setup

### ELK Stack (Elasticsearch, Logstash, Kibana)

Parse JSON logs:
```json
{
  "input": {
    "type": "tcp",
    "port": 5000
  },
  "filter": {
    "json": {
      "source": "message"
    }
  },
  "output": {
    "elasticsearch": {
      "hosts": ["elasticsearch:9200"]
    }
  }
}
```

### Datadog

Send logs to Datadog:
```bash
DD_AGENT_HOST=localhost
DD_TRACE_ENABLED=true
```

### CloudWatch

Send logs to AWS CloudWatch:
```bash
npm install aws-sdk winston-cloudwatch
```

Add transport to logger:
```typescript
import WinstonCloudWatch from "winston-cloudwatch";

transports.push(new WinstonCloudWatch({
  logGroupName: "agrocylo-backend",
  logStreamName: "backend-logs",
  awsRegion: "us-east-1",
}));
```

### Sentry

For error tracking and monitoring:
```bash
npm install @sentry/node
```

Initialize in app:
```typescript
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});
```

## Common Log Patterns

### Successful Request
```json
{
  "level": "info",
  "message": "HTTP request",
  "status": 200,
  "durationMs": 45.23
}
```

### Request Timeout
```json
{
  "level": "warn",
  "message": "HTTP request",
  "status": 504,
  "durationMs": 30000.0
}
```

### Database Error
```json
{
  "level": "error",
  "message": "HTTP request error",
  "status": 500,
  "error": "Database connection failed"
}
```

### Unauthorized Access
```json
{
  "level": "warn",
  "message": "HTTP request",
  "status": 401,
  "error": "Missing authentication token"
}
```

### CORS Rejection
```json
{
  "level": "warn",
  "message": "HTTP request",
  "status": 403,
  "error": "Not allowed by CORS"
}
```

## Troubleshooting

### Missing Request IDs in Logs

If request IDs aren't appearing, check:
1. Ensure `requestContext` middleware is enabled (should be first middleware)
2. Verify logger configuration includes `injectContext()`
3. Check that `logContext` is properly initialized

### Too Many Logs

Reduce log volume:
```bash
LOG_LEVEL=warn  # In production
```

### Logs Not Persisting

For production logging to files:
```typescript
transports.push(new winston.transports.File({
  filename: "logs/error.log",
  level: "error",
}));
transports.push(new winston.transports.File({
  filename: "logs/combined.log",
}));
```

### Docker Logs Growing Too Large

Limit log size:
```bash
docker run --log-opt max-size=10m --log-opt max-file=3 agrocylo-backend
```

## Performance Monitoring

Monitor request duration percentiles:

```bash
# Using a monitoring tool, track p50, p95, p99 of durationMs field
curl http://localhost:5000/metrics | jq .totalRequests
```

Investigate slow requests:
```bash
# Filter logs where durationMs > 1000ms
docker logs app | jq 'select(.durationMs > 1000)'
```

## See Also

- [SETUP.md](./SETUP.md) - Local development setup
- [ENVIRONMENT.md](./ENVIRONMENT.md) - Configuration reference
- [DOCKER.md](./DOCKER.md) - Docker deployment
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
