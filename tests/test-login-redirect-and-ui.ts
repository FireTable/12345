import assert from "node:assert/strict";
import { resolvePostLoginTarget } from "../lib/security/login-redirect";
import { isGenericSubject } from "../lib/civic-missing";

function run() {
  // 1. Admin logging in with /submit redirect target should land on "/"
  assert.equal(resolvePostLoginTarget("admin", "/submit"), "/");
  assert.equal(resolvePostLoginTarget("admin", "/submit?region=gz_tianhe"), "/");
  assert.equal(resolvePostLoginTarget("admin", "/submit/extra"), "/");

  // 2. Citizen logging in with /submit should stay on "/submit"
  assert.equal(resolvePostLoginTarget("user", "/submit"), "/submit");
  assert.equal(
    resolvePostLoginTarget("user", "/submit?region=gz_tianhe"),
    "/submit?region=gz_tianhe"
  );

  // 3. Admin logging in with other safe targets like /tickets should preserve target
  assert.equal(resolvePostLoginTarget("admin", "/tickets"), "/tickets");
  assert.equal(resolvePostLoginTarget("admin", "/tickets?status=PENDING"), "/tickets?status=PENDING");

  // 4. Generic subject filtering
  assert.equal(isGenericSubject("涉事方"), true);
  assert.equal(isGenericSubject("相关主体"), true);
  assert.equal(isGenericSubject("  "), true);
  assert.equal(isGenericSubject(null), true);
  assert.equal(isGenericSubject("老广烧烤档"), false);

  console.log("PASS: all login-redirect & generic-subject assertions passed");
}

run();
