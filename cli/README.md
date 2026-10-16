# Tevyon CLI

Images and videos from the command line, with the price before every job. The CLI is a thin client of Tevyon's
public HTTP API: models come from `/api/catalog`, prices from `/api/quote`, so a new model needs no new release.
No runtime dependencies; Node.js 22.18+ runs the TypeScript files directly.

```bash
node bin/tevyon.ts login                 # paste an API key (Studio → account menu → API & MCP)
node bin/tevyon.ts models                # every model with its parameters (--json for scripts)
node bin/tevyon.ts price veo_3_1_lite --duration 4
node bin/tevyon.ts generate flux_3_image "a red fox in fresh snow at dawn" --yes --wait
node bin/tevyon.ts mcp                   # connect Tevyon as an MCP server in Claude Code, Cursor & co.
```

`--url` (or `TEVYON_URL`) points it at another server; the default is `http://localhost:3100`. `npm link` installs
the `tevyon` command globally. Tests: `npm test`.
