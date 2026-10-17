const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const workflow = fs.readFileSync(path.join(__dirname, "../../.github/workflows/check.yml"), "utf8");
const steps = workflow.split(/(?=^      - )/mu).filter(block => block.startsWith("      - "));
const online = steps.find(block => /^      - name: Check deployment record table against GitHub Actions\s*$/mu.test(block));

test("the actual online changelog step runs only for pushes to main", () => {
  assert.ok(online, "the named online verification step exists");
  const guard = /^        if:\s*(.+)$/mu.exec(online);
  assert.ok(guard, "online verification must have its own event/ref condition");
  const raw = guard[1].trim();
  const expression = raw.startsWith("${{") && raw.endsWith("}}") ? raw.slice(3, -2).trim() : raw;
  // This evaluates this workflow's JS-compatible comparisons/boolean subset only;
  // it is not a replacement for the full GitHub Actions expression engine.
  assert.match(expression, /^[\w\s.'"\/=!&|()-]+$/u);
  for (const [event_name, ref, expected] of [
    ["push", "refs/heads/main", true],
    ["push", "refs/heads/feature", false],
    ["push", "refs/heads/main-other", false],
    ["push", "refs/tags/main", false],
    ["pull_request", "refs/pull/1/merge", false],
    ["pull_request", "refs/heads/main", false],
    ["workflow_dispatch", "refs/heads/main", false],
    ["workflow_dispatch", "refs/heads/feature", false],
    ["workflow_run", "refs/heads/main", false]
  ]) {
    const result = vm.runInNewContext(expression, { github: { event_name, ref } }, { timeout: 100 });
    assert.equal(result, expected, `${event_name} ${ref}`);
  }
  assert.doesNotMatch(online, /^        continue-on-error:/mu, "an online failure must still fail main/push CI");
});

test("offline checks, integration and authentication drift verification remain unconditional", () => {
  const firstStep = workflow.indexOf("      - ");
  assert.ok(firstStep > 0);
  assert.doesNotMatch(workflow.slice(0, firstStep), /^    (?:if|continue-on-error):/mu,
    "the check job itself must not be skipped or allowed to fail");
  for (const command of ["npm run check", "npm run test:integration", "git diff --exit-code -- js/auth.js"]) {
    const step = steps.find(block => {
      const run = /^(?:      -|       ) run:\s*(.+)$/mu.exec(block);
      return run?.[1].trim() === command;
    });
    assert.ok(step, `${command} remains in the actual workflow`);
    assert.doesNotMatch(step, /^        (?:if|continue-on-error):/mu, `${command} must run for PR/feature/manual checks too`);
  }
  assert.match(workflow, /^  pull_request:\s*$/mu);
  assert.match(workflow, /^  workflow_dispatch:\s*$/mu);
});
