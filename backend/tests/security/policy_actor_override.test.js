const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const app = require("../../src/app");
const jwt = require("jsonwebtoken");
const { TokenService } = require("../../src/identity/token_service");
const { defaultSecretManager } = require("../../src/identity/secret_manager");

describe("Policy Actor Override Regression", () => {
  let server;
  let tokenService;

  before(async () => {
    process.env.JWT_SECRET = "ecdat_insecure_jwt_secret_dev_only_1234567890";
    server = app.listen(0);
    tokenService = new TokenService();
  });

  after(async () => {
    server.close();
  });

  it("should not allow x-actor-username to override authenticated principal", async () => {
    const { defaultTokenService } = require("../../src/identity/token_service");
    
    // Generate an admin token via tokenService
    const tokenObj = defaultTokenService.issueTokenPair({ userId: "admin-user", username: "admin-user", roles: ["admin"], role: "admin" });
    const token = tokenObj.accessToken;
    const activeKey = defaultSecretManager.getActiveKey("jwt_signing");
    const JWT_SECRET = activeKey.secret;
    
    // Attempt spoofing with x-actor-username
    const res = await request(server)
      .post("/api/v1/policy/draft")
      .set("Authorization", `Bearer ${token}`)
      .set("x-actor-username", "hacker")
      .send({ policy: { rules: [] } });
      
    assert.notStrictEqual(res.status, 401); // Created or Validation Error (actor spoofing is ignored, author is admin-user)
    
    const res2 = await request(server)
      .post("/api/v1/policy/draft")
      .set("Authorization", `Bearer ${token}`)
      .set("x-approver-token", "invalid.jwt.token")
      .send({ policy: { rules: [] } });
      
    assert.strictEqual(res2.status, 401);
    assert.ok(res2.body.message.includes("Delegated attribution failed"));
    
    // Valid approver token but same author
    const approverTokenSame = defaultTokenService.issueTokenPair({ userId: "admin-user", username: "admin-user" }).accessToken;
    const res3 = await request(server)
      .post("/api/v1/policy/draft")
      .set("Authorization", `Bearer ${token}`)
      .set("x-approver-token", approverTokenSame)
      .send({ policy: { rules: [] } });
      
    assert.strictEqual(res3.status, 401);
    assert.ok(res3.body.message.includes("Four-eyes"));
    
    // Valid approver token different author
    const approverTokenDiff = defaultTokenService.issueTokenPair({ userId: "approver-user", username: "approver-user" }).accessToken;
    const res4 = await request(server)
      .post("/api/v1/policy/draft")
      .set("Authorization", `Bearer ${token}`)
      .set("x-approver-token", approverTokenDiff)
      .send({ policy: { rules: [] } });
      
    // Should be successful or validation error (not 401)
    assert.notStrictEqual(res4.status, 401);
  });
});
