#!/usr/bin/env node
/**
 * Exports the frontend's TypeScript content modules to JSON for the backend.
 *
 * `frontend/src/content/` is the single source of truth for everything the site
 * says about Sahil. The voice agent must answer from exactly that data, so we
 * export it rather than maintaining a second copy that could drift.
 *
 * Relies on Node's built-in type stripping (unflagged since v22.18).
 *
 *   node scripts/export_content.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = resolve(here, "../../../frontend/src/content");
const outFile = resolve(here, "../content/portfolio.json");

const load = async (name) =>
  import(pathToFileURL(resolve(contentDir, `${name}.ts`)).href);

const [{ profile }, { skillGroups }, { experience }, { projects }, { socials }] =
  await Promise.all(
    ["profile", "skills", "experience", "projects", "socials"].map(load),
  );

const payload = {
  // Stamped by the caller, not Date.now(), so repeated runs are reproducible
  // and the file only changes when the content actually changes.
  profile,
  skillGroups,
  experience,
  projects,
  socials,
};

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(payload, null, 2) + "\n", "utf8");

const counts = [
  `${skillGroups.length} skill groups`,
  `${experience.length} jobs`,
  `${projects.length} projects`,
  `${socials.length} socials`,
].join(", ");
console.log(`Wrote ${outFile}\n  ${profile.name} — ${counts}`);
