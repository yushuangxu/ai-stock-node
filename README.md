# Getting Started with [Fastify-CLI](https://www.npmjs.com/package/fastify-cli)
This project was bootstrapped with Fastify-CLI.

## Available Scripts

In the project directory, you can run:

### `npm run dev`

To start the app in dev mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

### `npm start`

For production mode

### `npm run test`

Run the test cases.

## Learn More

To learn Fastify, check out the [Fastify documentation](https://fastify.dev/docs/latest/).

## Trading Agent MVP API

- Endpoint: `POST /agent/analyze`
- Purpose: first version flow for market/stock technical analysis and decision output

Example request:

```json
{
  "sessionId": "demo-001",
  "query": "分析下宁德时代，给出短中线建议和风控",
  "task": "full_analysis",
  "history": []
}
```

Example response fields:

- `data.analysis`: full analyst report text
- `data.decision`: structured action (`buy|hold|sell|watch`) with confidence, reasons and risk controls

Stream endpoint:

- `POST /agent/analyze/stream`
- SSE events: `start` / `tool_start` / `tool_end` / `token` / `done` / `error`
- stage events: `context_ready` / `analysis_ready` / `decision_ready` / `rule_checked`
- `done` event now carries structured payload: `data.decision` + `data.meta.rule_meta`

Ops endpoints:

- `GET /ops/healthz`: service readiness
- `GET /ops/metrics`: runtime counters
- `GET /ops/metrics/prometheus`: prometheus text format metrics

Decision hard rules (v3):

- low confidence (<55) forces `watch`
- missing stop-loss auto fills conservative stop-loss rule
- max position cap: `full_analysis <= 50%`, `quick_check <= 30%`

Production env options:

- `AGENT_API_TOKEN`: optional Bearer auth token for `/agent` and `/journal`
- `RATE_LIMIT_WINDOW_MS`: in-memory rate limit window (default `60000`)
- `RATE_LIMIT_MAX`: max requests per ip+scope in window (default `40`)
- `AUDIT_LOG_FILE`: audit ndjson path (default `./data/audit-log.ndjson`)
- `REDIS_URL`: optional redis url for distributed rate limiting
- `REDIS_PREFIX`: redis key prefix (default `ai-stock-node`)

Observability:

- Grafana dashboard template: `ops/grafana-dashboard.json`
