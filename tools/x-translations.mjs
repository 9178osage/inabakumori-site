// Reader-facing gists of X posts (zh + en), kept apart from the original-text archive so the
// daily import never has to know about them. A post without an entry simply shows no line.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { assertRepoPath } from "./safe-fs.mjs";

export const X_TRANSLATION_SHARD_BYTES = 120_000;
const FILE = /^batch-\d{3}\.json$/u;
// No control characters, bidi overrides or isolates in a gist.
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

function gist(value, label) {
  assert.ok(typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 1000, `${label} must be a trimmed 1–1000 character string`);
  assert.ok(!FORBIDDEN.test(value), `${label} contains a control or bidi character`);
  return value;
}

export function normalizeXTranslations(files) {
  const map = new Map();
  for (const [name, data] of files) {
    assert.ok(data && data.version === 1 && data.items && typeof data.items === "object" && !Array.isArray(data.items), `Invalid X translation file ${name}`);
    for (const [id, entry] of Object.entries(data.items)) {
      assert.match(id, /^[1-9]\d{0,19}$/u, `Invalid X translation id in ${name}`);
      assert.ok(!map.has(id), `Duplicate X translation for ${id}`);
      assert.ok(entry && typeof entry === "object" && Object.keys(entry).sort().join() === "en,zh", `X translation ${id} needs exactly zh and en`);
      map.set(id, Object.freeze({ zh: gist(entry.zh, `X translation ${id} zh`), en: gist(entry.en, `X translation ${id} en`) }));
    }
  }
  return map;
}

export async function readXTranslations(root, archive) {
  const folder = assertRepoPath(root, "data/x-translations", { mustExist: false });
  let names = [];
  try { names = (await readdir(folder, { withFileTypes: true })).filter(entry => entry.isFile() && FILE.test(entry.name)).map(entry => entry.name).sort(); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const files = [];
  for (const name of names) {
    const file = assertRepoPath(root, `data/x-translations/${name}`, { mustExist: true });
    const raw = await readFile(file, "utf8");
    assert.ok(Buffer.byteLength(raw) <= X_TRANSLATION_SHARD_BYTES, `X translation file ${name} exceeds ${X_TRANSLATION_SHARD_BYTES} bytes`);
    files.push([name, JSON.parse(raw)]);
  }
  const map = normalizeXTranslations(files);
  if (archive) {
    const ids = new Set(archive.items.map(item => item.id));
    for (const id of map.keys()) assert.ok(ids.has(id), `X translation for unknown post ${id}`);
  }
  return map;
}
