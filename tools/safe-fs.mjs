// Build tools only read and write real files inside the repository. A symlinked output
// (or any symlinked parent directory below the repo root) could redirect a write or a
// recursive delete outside the repo, so such paths are refused before touching them.
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

const isParentStep = relative => relative === ".." || relative.startsWith(`..${path.sep}`);

export function assertRepoPath(root, target, { mustExist = false } = {}) {
  const base = path.resolve(root);
  const resolved = path.resolve(base, target);
  const relative = path.relative(base, resolved);
  // Only a real parent step ("..", "../x") escapes; names such as "..cache" are ordinary children.
  if (!relative || isParentStep(relative) || path.isAbsolute(relative)) {
    throw new Error(`Refusing path outside the repository: ${target}`);
  }
  let current = base;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    let info;
    try {
      info = lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT" && !mustExist) return resolved;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error(`Refusing symlinked path: ${path.relative(base, current)}`);
  }
  const real = path.relative(realpathSync(base), realpathSync(resolved));
  if (isParentStep(real) || path.isAbsolute(real)) throw new Error(`Refusing path that resolves outside the repository: ${target}`);
  return resolved;
}
