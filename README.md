<h1 align="center">
  🧑‍⚖️
  <br>spec-judge
</h1>
<p align="center">
    Grades specs with jev via Vercel AI SDK. Experiment.
</p>

```
judge <spec-id-or-path> [--root <dir>]
```

## Description

`judge` scores the source files a lazyspec document governs against the requirements that document states. It uses `jev` through the Vercel AI SDK to score.

## Options

| Option         | Effect                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------- |
| `--root <dir>` | Uses `<dir>` as the project root instead of searching upward from the current directory. |
| `-h`, `--help` | Prints the synopsis.                                                                     |

## Exit status

| Code | Meaning                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | Every requirement conforms.                                                                                                          |
| 1    | One or more requirements do not conform.                                                                                             |
| 2    | Usage error, no project root, no API key, unknown document, no requirement sections, no `governs` globs, or globs matching no files. |

## Files

| Path                              | Contents                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `.lazyspec.toml`                  | Marks the project root.                                                                            |
| `$XDG_CONFIG_HOME/spec-judge/env` | `KEY=value` lines read when `AI_GATEWAY_API_KEY` is unset. Defaults to `~/.config/spec-judge/env`. |

## Environment

| Variable             | Effect                                                      |
| -------------------- | ----------------------------------------------------------- |
| `AI_GATEWAY_API_KEY` | Authenticates the gateway.                                  |
| `NO_COLOR`           | Suppresses colour in the output.                            |
| `XDG_CONFIG_HOME`    | Locates the `spec-judge/env` file. Defaults to `~/.config`. |

## Examples

```bash
judge SPEC-010
judge docs/specs/SPEC-010.md
judge SPEC-010 --root ~/thezone/lazyspec
```

## Install

```bash
bun install
bun link
```

```bash
mkdir -p ~/.config/spec-judge
echo 'AI_GATEWAY_API_KEY=...' > ~/.config/spec-judge/env
```

## Development

```bash
bun index.ts SPEC-010 --root <dir>
bun run lint        # oxlint
bun run fmt         # oxfmt, writes in place
bun run fmt:check   # oxfmt, reports without writing
```
