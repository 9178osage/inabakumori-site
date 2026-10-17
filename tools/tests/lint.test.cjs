const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { ESLint } = require("eslint");

const root = path.resolve(__dirname, "../..");
const eslint = new ESLint({ cwd: root });
async function messages(source, filePath) {
  const [result] = await eslint.lintText(source, { filePath: path.join(root, filePath) });
  return result.messages;
}

test("undefined identifiers are checked in browser, Node, authentication source and tests", async () => {
  for (const file of ["script.js", "js/lint-fixture.js", "backend/lint-fixture.mjs", "tools/auth-src.js", "tools/tests/lint-fixture.test.cjs"]) {
    const found = await messages("void accidentalUnknownName;", file);
    assert.equal(found.length, 1, file);
    assert.equal(found[0].ruleId, "no-undef", file);
  }
});

test("variable and class use-before-definition remain errors, including deferred closures", async () => {
  for (const source of ["void later; const later = 1;", "new Later(); class Later {}", "function deferred() { return later; } const later = 1;"]) {
    const found = await messages(source, "tools/lint-fixture.mjs");
    assert.equal(found.length, 1);
    assert.equal(found[0].ruleId, "no-use-before-define");
  }
  assert.deepEqual(await messages("start(); function start() {}", "tools/lint-fixture.mjs"), []);
});

test("browser classic globals and Node globals stay in their intended environments", async () => {
  assert.deepEqual(await messages("document.title = currentLanguage; updateTagFilter(); wallStatic = false;", "js/lint-fixture.js"), []);
  assert.deepEqual(await messages("process.stdout.write(Buffer.from('ok'));", "backend/lint-fixture.mjs"), []);
  assert.equal((await messages("process.exitCode = 1;", "js/lint-fixture.js"))[0].ruleId, "no-undef");
  assert.equal((await messages("window.alert('test');", "tools/lint-fixture.mjs"))[0].ruleId, "no-undef");
});

test("generated output, installed packages and the local text copy are excluded", async () => {
  for (const file of ["js/auth.js", "dist/script.js", "node_modules/example/index.js", "backend/node_modules/example/index.js", "inabakumori-site-all-code/synthetic.js"]) {
    assert.equal(await eslint.isPathIgnored(path.join(root, file)), true, file);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts.lint, "eslint script.js js tools backend eslint.config.mjs");
  assert.match(pkg.scripts.check, /^npm run lint &&/u);
});
