# Local session analysis through MCP

MDViewer exposes seven read-only analysis tools from its running desktop process. The stdio bridge connects to the app’s private Unix socket; it never opens SQLite, scans transcripts or launches a second app. macOS and Linux are supported. Windows local transport is not implemented.

## Connect

1. Open **MDViewer Sessions Preview**, then **Sessions → Agent access**.
2. Choose the selected session, directory or all indexed sessions. Detailed transcript sharing is off by default. Enable access and confirm the native dialog.
3. Copy the executable command shown in the panel into your MCP client’s local stdio configuration. The command is the app executable; the argument is `--mcp`.

For clients using the common JSON server configuration, substitute the exact executable shown by the app:

```json
{
  "mcpServers": {
    "mdviewer-analysis": {
      "command": "/absolute/path/MDViewer Sessions Preview.app/Contents/MacOS/mdviewer",
      "args": ["--mcp"]
    }
  }
}
```

Clients with a different configuration format need the same command and argument. The bridge implements MCP initialization, tool discovery, structured results with text compatibility, ping and stdio shutdown. It supports protocol versions 2024-11-05, 2025-03-26, 2025-06-18 and 2025-11-25. See the MCP [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) and [tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) specifications.

Keep MDViewer open. Access lasts only for this app process. Revoking agent access closes client sockets; revoking session access also clears the index. Closing a bridge does not close the app. All programs running as the same OS user can reach an enabled socket; this is a local-user trust boundary, not individual-client authentication.

The socket directory is private (0700), with a 0600 socket. Scope is enforced on every tool call. Directory sharing admits only sessions whose entire recorded directory history is inside that directory. This avoids exposing the rest of a session that moved elsewhere. Hierarchy queries cannot expand beyond the shared scope.

## Tools and examples

| Tool | Result |
| --- | --- |
| `analysis_status` | Index generation, freshness, parser coverage, pending files, service errors and shared scope. |
| `find_sessions` | Filtered, paginated metadata including hierarchy, recorded usage, skill observations and ticket mentions. |
| `get_session` | Session details, visible children and paginated evidence IDs. |
| `analyze_tools` | Distinct call counts, correlated results, explicit failures/non-errors, unknown outcomes, repeated input candidates and elapsed percentiles. |
| `analyze_skills` | Explicit skill invocations, direct definition requests/reads and wrapper references; associated session usage with overlapping attribution. |
| `compare_cohorts` | Two explicitly filtered cohorts, tool measures, model/role composition, usage, overlap and unknown task outcomes. |
| `get_evidence` | Bounded source excerpts and their recorded metadata. Requires detailed evidence sharing. |

Session identifiers are `provider:id`, for example `codex:THREAD_ID`. Common cohort fields are `provider`, `model`, `role`, `directory`, `ticket`, `skill`, `skillObservation`, `session`, `descendants`, `activeSince` and `inactiveSince`.

```json
{"name":"analyze_tools","arguments":{"cohort":{"session":"codex:THREAD_ID","descendants":true}}}
```

```json
{"name":"find_sessions","arguments":{"cohort":{"provider":"claude","skill":"delivery","skillObservation":"explicit_invocation"},"limit":50}}
```

```json
{"name":"compare_cohorts","arguments":{"left":{"directory":"/work/project","model":"model-a"},"right":{"directory":"/work/project","model":"model-b"}}}
```

`skillObservation` in a cohort selects recorded call observations (`explicit_invocation`, `definition_requested`, `reference`). `analyze_skills` additionally derives `definition_read` when a matching result explicitly records no error. Missing error flags stay unknown. Skill identities are exact recorded names or paths; aliases are not silently merged.

Session date filters select **last recorded activity**, with lifetime usage retained. `eventSince`/`eventUntil` on analysis tools select invocation timestamps; matching results may occur outside that interval. Dates must include a timezone (RFC3339). These event filters do not turn lifetime usage into interval usage.

Pagination cursors bind the query, permission scope, page size and persistent index generation. If ingestion changes the generation, restart the query rather than mixing pages. Evidence IDs include a content fingerprint; changed or replaced evidence is rejected. Paste an ID into **Agent access → Evidence ID**, resolve it, then open the event in the session view.

## Measurement limits

- Maximum 100 entries per page, 20 evidence excerpts per request, 200 sessions and 20,000 events per analytical query. Responses report truncation; narrow the cohort when a limit is reached. The structured response is capped at 2 MiB.
- Parser version 3 preserves call IDs, result IDs, byte-end source offsets, recorded model/turn information, SHA-256 content fingerprints, original byte counts and explicit error/exit evidence. Old checkpoints backfill incrementally; pending/legacy coverage stays visible. Checkpoints and events commit atomically.
- Duplicate call IDs are removed within each session. Fork-copied history still has unresolved cross-session ownership and is reported; do not treat overlapping fork totals as newly executed work.
- Call-to-first-result elapsed time includes scheduling and transport. It is not pure execution time. Overlapping calls cannot be summed into wall-clock time.
- Repeated inputs are candidates for investigation, not established retries or waste. Tool names in `exec` source are references, not proven inner executions.
- Tokens remain recorded response/session usage. Skill-associated session usage overlaps across skills and is not a cost caused by the skill. There is no per-tool token estimate or fabricated monetary charge.
- Captured result hashes identify the recorded tool output. They do not establish a canonical skill-file version. Historical definition versions and current-file equivalence remain unknown. Skill availability from catalogs, claimed adherence and verified task completion are not automatically inferred.
- Cohort comparisons are descriptive. Automatic task matching, task complexity, canonical prospective skill-file snapshots and verified task/rework outcomes remain future work. No causal skill-effectiveness score is produced.
- Jira ticket mentions and TEOB tool references are exposed as transcript associations. Live Jira/TEOB reads remain available through desktop Connections; MCP does not fetch remote context or export connection credentials.

## Validation

The validation host uses the production SQLite parser, query layer, protocol dispatcher, socket handler and stdio bridge. It substitutes an anonymous Unix socket pair for the GUI listener so it can run in environments that prohibit binding named sockets. It accepts only explicitly supplied transcript-home/cache paths and is a development example, not a background daemon.

```bash
cargo test --offline --manifest-path src-tauri/Cargo.toml --bin mdviewer
cargo clippy --offline --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm test
cargo build --offline --manifest-path src-tauri/Cargo.toml --example analysis_host
```

Install the official `@modelcontextprotocol/sdk` in a separate temporary validation directory. Supply a small fixture home containing copied `.codex/sessions` and/or `.claude/projects` JSONL files, then run:

```bash
node scripts/validate-session-mcp.mjs \
  "$PWD/src-tauri/target/debug/examples/analysis_host" \
  /tmp/fixture-home /tmp/fixture-cache/index.sqlite \
  /tmp/mcp-client/node_modules/@modelcontextprotocol/sdk
```

The SDK client discovers all seven tools, validates structured responses, traverses pagination, resolves evidence, compares tool counts against an independent transcript reader, checks invalid evidence and repeats after restart. The warm pass must read zero transcript bytes and preserve generation/counts.

The implementation run validated seven copied real sessions (Codex and Claude), 126 tool calls and four skill observations. The warm pass read zero transcript bytes. A named-socket GUI connection is still a separate acceptance check: the coding sandbox rejected `UnixListener::bind` with `Operation not permitted`. This restriction is not a passed desktop smoke test.
