# @rendershot/mcp-server

Model Context Protocol (MCP) server for the [Rendershot](https://rendershot.com) screenshot and PDF generation API. Lets AI agents (Claude, Cursor, etc.) capture screenshots and generate PDFs directly as tool calls.

## Quick start

No installation needed — run with `npx`:

```bash
RENDERSHOT_API_KEY=your_key npx @rendershot/mcp-server
```

## Claude Desktop setup

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "rendershot": {
      "command": "npx",
      "args": ["-y", "@rendershot/mcp-server"],
      "env": {
        "RENDERSHOT_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## Cursor / VS Code setup

Add to your MCP settings:

```json
{
  "rendershot": {
    "command": "npx",
    "args": ["-y", "@rendershot/mcp-server"],
    "env": {
      "RENDERSHOT_API_KEY": "your_api_key_here"
    }
  }
}
```

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `RENDERSHOT_API_KEY` | Yes | — | Your Rendershot API key |
| `RENDERSHOT_BASE_URL` | No | `https://api.rendershot.com` | API base URL (override for self-hosting) |

## Tools

### `take_screenshot`

Capture a screenshot of a URL or HTML string. Returns a base64-encoded image.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `url` | string | — | Page URL to screenshot *(one of url/html required)* |
| `html` | string | — | Raw HTML to render *(one of url/html required)* |
| `format` | `png` \| `jpeg` | `png` | Output image format |
| `quality` | 1–100 | `85` | JPEG quality (ignored for PNG) |
| `viewport_width` | 1–3840 | `1280` | Viewport width in pixels |
| `viewport_height` | 1–2160 | `720` | Viewport height in pixels |
| `full_page` | boolean | `false` | Capture the full scrollable page |
| `wait_for` | string | `networkidle` | `load` \| `domcontentloaded` \| `networkidle` \| `commit` \| CSS selector |
| `delay_ms` | 0–10000 | `0` | Extra delay after page load (ms) |

### `generate_pdf`

Generate a PDF from a URL or HTML string. Returns the PDF as a base64-encoded string.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `url` | string | — | Page URL *(one of url/html required)* |
| `html` | string | — | Raw HTML *(one of url/html required)* |
| `format` | `A3` \| `A4` \| `Letter` \| `Legal` | `A4` | Paper size |
| `orientation` | `portrait` \| `landscape` | `portrait` | Page orientation |
| `print_background` | boolean | `true` | Print background graphics/colors |
| `wait_for` | string | `networkidle` | Same as screenshot |
| `delay_ms` | 0–10000 | `0` | Extra delay after page load (ms) |

### `bulk_render`

Submit up to 20 screenshot or PDF jobs in one call. All jobs run in parallel and results include base64 output per job.

| Parameter | Type | Description |
|---|---|---|
| `jobs` | array (1–20) | Array of job objects, each with `type: "screenshot"` or `type: "pdf"` plus the same fields as the individual tools |

Returns a JSON object with `credits_used`, `credits_remaining`, and a `results` array containing `index`, `result` (base64), and any `error` per job.

### `check_balance`

Check remaining API credits and plan details. No parameters.

## Notes

- All render calls use async mode internally and poll until the job completes (up to 5 minutes).
- Screenshots return MCP `image` content — agents can display them inline.
- PDFs return base64-encoded text; agents can save them to disk or pass them on.
- Errors from the API (rate limits, credit exhaustion, invalid URLs) surface as MCP errors with the original error code.

## Requirements

- Node.js 18+

## License

MIT
