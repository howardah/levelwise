# Loudcheck

Loudcheck is a streaming loudness analyzer built with Vue, Tauri, and Rust. It is inspited by the [Loudness Penalty](https://www.loudnesspenalty.com/) but built as a (fast) local desktop application. Audio is decoded and measured on-device using EBU R128 / ITU-R BS.1770.

## Development

Install dependencies and start the Tauri application:

```sh
bun install
bun run tauri dev
```

Useful checks:

```sh
bun run typecheck       # Vue and TypeScript
bun run test            # Frontend unit tests
bun run fmt             # Format Vue/TypeScript and Rust
bun run fmt:check       # Check formatting without changing files
bun run lint            # Run Oxlint and Clippy
bun run typecheck:rust  # Rust compiler checks
bun run test:rust       # Rust unit tests
bun run check           # All non-mutating checks
```

## Project structure

- `src/components` contains the Vue presentation components.
- `src/composables` owns analysis and audio-preview state.
- `src/lib` contains domain utilities and the Tauri frontend boundary.
- `src-tauri/src/analysis.rs` contains decoding and loudness measurement.
- `src-tauri/src/commands.rs` exposes backend operations to Tauri.
