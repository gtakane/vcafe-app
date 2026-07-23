import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const deployScript = readFileSync(
  new URL("../deploy-disabled-job-tokyo.sh", import.meta.url),
  "utf8",
);
const disabledEnvironment = readFileSync(
  new URL("../disabled.env.yaml", import.meta.url),
  "utf8",
);

test("disabled job is pinned to the analytics project and Tokyo", () => {
  assert.match(deployScript, /PROJECT_ID="vcafe-admin-analytics"/);
  assert.match(deployScript, /REGION="asia-northeast1"/);
  assert.doesNotMatch(deployScript, /PROJECT_ID="v-athome-cafe-app"/);
});

test("deployment cannot read production or write analytics data", () => {
  assert.match(disabledEnvironment, /CONFIRM_READ_ONLY_SYNC: DISABLED/);
  assert.match(disabledEnvironment, /DRY_RUN: "true"/);
  assert.match(disabledEnvironment, /SYNC_LOOKBACK_MINUTES: "15"/);
  assert.match(disabledEnvironment, /MAX_DOCUMENTS: "100"/);
});

test("deployment does not grant production IAM or execute the job", () => {
  assert.doesNotMatch(deployScript, /add-iam-policy-binding.*v-athome-cafe-app/s);
  assert.doesNotMatch(deployScript, /gcloud run jobs execute/);
  assert.doesNotMatch(deployScript, /gcloud scheduler/);
});

