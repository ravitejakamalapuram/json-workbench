// Fails when an item branch touches a path its item does not own.
//
//   node scripts/check-ownership.mjs <item-id> <base-sha>
//
// "Touches" means anything that differs from the merge base of <base-sha> and
// HEAD: committed, staged, unstaged and untracked files, with renames split
// into both paths so a move out of an item's directory is caught too. The
// owners are in docs/architecture/ownership.json (TARGET.md section 4).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function findViolations(files, prefixes) {
  return files.filter((file) => !prefixes.some((p) => file.startsWith(p)));
}

export function findOverlaps(ownership) {
  const entries = Object.entries(ownership).flatMap(([id, prefixes]) =>
    prefixes.map((prefix) => ({ id, prefix })),
  );
  return entries.flatMap((inner) =>
    entries
      .filter((outer) => outer.id !== inner.id)
      .filter((outer) => inner.prefix.startsWith(outer.prefix))
      .map(
        (outer) =>
          `${inner.id}: ${inner.prefix} is inside ${outer.id}: ${outer.prefix}`,
      ),
  );
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function changedFiles(base) {
  const [mergeBase] = git("merge-base", base, "HEAD");
  const tracked = git("diff", "--name-only", "--no-renames", mergeBase);
  const untracked = git("ls-files", "--others", "--exclude-standard");
  return [...new Set([...tracked, ...untracked])].sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [id, base] = process.argv.slice(2);
  const ownership = JSON.parse(
    readFileSync(
      new URL("../docs/architecture/ownership.json", import.meta.url),
      "utf8",
    ),
  );
  if (!id || !base || !ownership[id]) {
    console.error(
      `Usage: node scripts/check-ownership.mjs <${Object.keys(ownership).join("|")}> <base-sha>`,
    );
    process.exit(2);
  }
  const violations = findViolations(changedFiles(base), ownership[id]);
  if (violations.length) {
    console.error(`Item "${id}" changed paths it does not own:`);
    for (const file of violations) console.error(`  ${file}`);
    process.exit(1);
  }
  console.log(`Ownership check passed for "${id}".`);
}
