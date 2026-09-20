#!/usr/bin/env bun

// vibe coded :) experimental

import { experimental_evaluate as evaluate } from "ai";
import { $ } from "bun";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const PROSE_SECTIONS =
  /^(summary|motivation|background|context|rationale|alternatives|open questions|non-goals)$/i;
const MAX_FILE_CHARS = 50_000;
const THRESHOLD = 0.5;
const STRONG = 0.85;
const WEAK = 0.25;
const USAGE = "usage: judge <spec-id-or-path> [--root <dir>]";
const SPINNER = ["⣾ ", "⣽ ", "⣻ ", "⢿ ", "⡿ ", "⣟ ", "⣯ ", "⣷ "];

type Requirement = { heading: string; text: string; key: string };
type Judged = {
  path: string;
  answers: Record<string, { probability: number }>;
};

async function main() {
  const { id, rootFlag } = parseArgs(Bun.argv.slice(2));
  const root = rootFlag ? resolve(rootFlag) : await findProjectRoot(process.cwd());
  await loadApiKey();

  const doc = await loadDocument(id, root);
  const requirements = extractRequirements(doc.body);
  if (!requirements.length) die(`${doc.id}: no requirement sections (## headings) to judge`);
  if (!doc.governs?.length) die(`${doc.id}: no governs globs, nothing to judge`);

  const paths = await expandGoverns(doc.governs, root);
  if (!paths.length) die(`${doc.id}: governs globs match no files under ${root}`);

  const judged = await judgeFiles(paths, root, doc, buildQuestions(doc, requirements));

  printHeader(doc, requirements.length, paths.length);
  const nonconforming = printConformance(requirements, judged);
  printUnspecified(judged);
  printSummary(requirements.length, nonconforming);

  process.exit(nonconforming ? 1 : 0);
}

function parseArgs(args: string[]) {
  let id: string | undefined;
  let rootFlag: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--root") rootFlag = args[++i];
    else if (arg === "-h" || arg === "--help") die(USAGE, 0);
    else if (arg.startsWith("-")) die(`unknown option ${arg}\n${USAGE}`);
    else if (!id) id = arg;
    else die(USAGE);
  }
  if (!id) die(USAGE);
  if (rootFlag === undefined && args.includes("--root")) die("--root needs a directory");
  return { id, rootFlag };
}

async function loadDocument(id: string, root: string) {
  const shown = await $`lazyspec show ${id} --json`.cwd(root).nothrow().quiet();
  if (shown.exitCode !== 0) die(shown.stderr.toString().trim() || `lazyspec show ${id} failed`);
  return shown.json();
}

function extractRequirements(body: string): Requirement[] {
  return body
    .split(/^## /m)
    .slice(1)
    .map((section) => {
      const [heading, ...rest] = section.split("\n");
      return { heading: heading!.trim(), text: rest.join("\n").trim() };
    })
    .filter((r) => r.text && !PROSE_SECTIONS.test(r.heading))
    .map(({ heading, text }, i) => ({
      heading,
      text,
      key: `${heading
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")}_${i}`,
    }));
}

async function expandGoverns(globs: string[], root: string) {
  const paths = new Set<string>();
  for (const glob of globs) {
    for await (const p of new Bun.Glob(glob).scan({ cwd: root })) paths.add(p);
  }
  return [...paths].toSorted();
}

type Questions = Record<string, { type: "boolean"; instructions: string }>;

function buildQuestions(
  doc: { id: string; title: string },
  requirements: Requirement[],
): Questions {
  return Object.fromEntries([
    ...requirements.map(({ heading, text, key }) => [
      key,
      {
        type: "boolean" as const,
        instructions: `Does this file implement the following requirement of specification ${doc.id}, including the details it fixes (names, flags, output formats, error cases)? A file that has no business implementing this requirement is a "no".\n\n## ${heading}\n${text}`,
      },
    ]),
    [
      "unspecified",
      {
        type: "boolean" as const,
        instructions: `Does this file contain behaviour within the scope of specification "${doc.id}: ${doc.title}" that none of its requirements describe or sanction? Ignore style, tests, and anything the specification does not speak to.`,
      },
    ],
  ]);
}

async function judgeFiles(
  paths: string[],
  root: string,
  doc: { id: string; title: string },
  questions: Questions,
): Promise<Judged[]> {
  let done = 0;
  const stop = startSpinner(() => `judging ${paths.length} files  ${done}/${paths.length}`);
  try {
    return await Promise.all(
      paths.map(async (path) => {
        const source = (await Bun.file(join(root, path)).text()).slice(0, MAX_FILE_CHARS);
        const { answers } = await evaluate({
          model: "typesafe-ai/jev",
          state: `File \`${path}\`, one of the source files that specification "${doc.id}: ${doc.title}" claims to govern.\n\n${source}`,
          questions,
        });
        done++;
        return { path, answers };
      }),
    );
  } finally {
    stop();
  }
}

function startSpinner(label: () => string) {
  if (!process.stderr.isTTY) return () => {};
  let frame = 0;
  const draw = () => process.stderr.write(`\r\x1b[K${SPINNER[frame++ % SPINNER.length]}${label()}`);
  draw();
  const timer = setInterval(draw, 80);
  return () => {
    clearInterval(timer);
    process.stderr.write("\r\x1b[K");
  };
}

const colour = (code: string) => (text: string) =>
  Bun.enableANSIColors && !process.env.NO_COLOR ? `\x1b[${code}m${text}\x1b[0m` : text;
const green = colour("32");
const yellow = colour("33");
const orange = colour("38;5;208");
const red = colour("31");
const bold = colour("1");
const dim = colour("2");

function metColour(p: number) {
  if (p >= STRONG) return green;
  if (p >= THRESHOLD) return yellow;
  if (p >= WEAK) return orange;
  return red;
}

function riskColour(p: number) {
  if (p >= STRONG) return red;
  if (p >= (STRONG + THRESHOLD) / 2) return orange;
  return yellow;
}

function pct(p: number) {
  return `${(p * 100).toFixed(0)}%`.padStart(4);
}

function printHeader(doc: { id: string; title: string }, requirements: number, files: number) {
  console.log(`\n${bold(`${doc.id}  ${doc.title}`)}`);
  console.log(dim(`${requirements} requirements against ${files} governed files\n`));
}

function printConformance(requirements: Requirement[], judged: Judged[]) {
  console.log(bold("CONFORMANCE"));
  let nonconforming = 0;
  for (const { heading, key } of requirements) {
    const best = judged.reduce((a, b) =>
      b.answers[key]!.probability > a.answers[key]!.probability ? b : a,
    );
    const p = best.answers[key]!.probability;
    const conforms = p >= THRESHOLD;
    if (!conforms) nonconforming++;
    const paint = metColour(p);
    console.log(`  ${paint(conforms ? "✓" : "✗")} ${paint(pct(p))}  ${heading}`);
    console.log(
      dim(
        `         ${conforms ? `conforms in ${best.path}` : "no governed file conforms to this"}`,
      ),
    );
  }
  return nonconforming;
}

function printUnspecified(judged: Judged[]) {
  const rogue = judged
    .filter((f) => f.answers.unspecified!.probability >= THRESHOLD)
    .toSorted((a, b) => b.answers.unspecified!.probability - a.answers.unspecified!.probability);
  if (!rogue.length) {
    console.log(`\n${bold("UNSPECIFIED BEHAVIOUR")}`);
    console.log(`  ${green("✓")} ${dim("no governed file exceeds the threshold")}`);
    return;
  }
  console.log(
    `\n${bold("UNSPECIFIED BEHAVIOUR")}  ${dim("(behaviour in scope that no requirement sanctions)")}`,
  );
  for (const f of rogue) {
    const p = f.answers.unspecified!.probability;
    const paint = riskColour(p);
    console.log(`  ${paint("!")} ${paint(pct(p))}  ${f.path}`);
  }
}

function printSummary(total: number, nonconforming: number) {
  const conforming = total - nonconforming;
  const paint = nonconforming === 0 ? green : nonconforming === total ? red : orange;
  console.log(`\n${paint(bold(`${conforming}/${total} requirements conform`))}\n`);
}

function die(message: string, code = 2): never {
  (code ? console.error : console.log)(message);
  process.exit(code);
}

async function findProjectRoot(from: string) {
  let dir = resolve(from);
  while (true) {
    if (await Bun.file(join(dir, ".lazyspec.toml")).exists()) return dir;
    const parent = dirname(dir);
    if (parent === dir) die(`no .lazyspec.toml in ${from} or any parent directory`);
    dir = parent;
  }
}

async function loadApiKey() {
  const config = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  for (const path of [join(config, "spec-judge", "env"), join(import.meta.dir, ".env.local")]) {
    if (process.env.AI_GATEWAY_API_KEY) return;
    const file = Bun.file(path);
    if (!(await file.exists())) continue;
    for (const line of (await file.text()).split("\n")) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (match && !process.env[match[1]!]) {
        process.env[match[1]!] = match[2]!.trim().replace(/^(['"])(.*)\1$/, "$2");
      }
    }
  }
  if (!process.env.AI_GATEWAY_API_KEY) {
    die(
      `AI_GATEWAY_API_KEY is not set; export it or put it in ${join(config, "spec-judge", "env")}`,
    );
  }
}

await main();
