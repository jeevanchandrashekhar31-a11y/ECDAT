const { test } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const app = require("../../src/server");

test("Authentication & Logout Security - Analyst mode eval cookie clearing", async (t) => {
  // 1. Enter analyst mode
  let response = await request(app)
    .post("/api/v1/auth/evaluation/enter")
    .send({ persona: "analyst" });
    
  assert.strictEqual(response.status, 200, "Should successfully enter analyst mode");
  
  const cookies = response.headers["set-cookie"];
  assert.ok(cookies, "Should set cookies");
  
  // Find ecdat_eval_session
  const evalCookieStr = cookies.find(c => c.startsWith("ecdat_eval_session="));
  assert.ok(evalCookieStr, "ecdat_eval_session cookie must be set");
  
  // 2. Perform logout
  let logoutResponse = await request(app)
    .post("/api/v1/auth/logout")
    .set("Cookie", cookies);
    
  assert.strictEqual(logoutResponse.status, 200, "Should successfully logout");
  const logoutCookies = logoutResponse.headers["set-cookie"];
  assert.ok(logoutCookies, "Logout must set cookies");
  
  // 3. Verify ecdat_eval_session is cleared
  const clearEvalCookieStr = logoutCookies.find(c => c.startsWith("ecdat_eval_session="));
  assert.ok(clearEvalCookieStr, "ecdat_eval_session must be present in logout response headers");
  assert.ok(clearEvalCookieStr.includes("Max-Age=0") || clearEvalCookieStr.includes("Expires=Thu, 01 Jan 1970 00:00:00 GMT"), "ecdat_eval_session must be expired");
});
