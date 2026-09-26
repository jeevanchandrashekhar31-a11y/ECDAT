const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const app = require("../../src/app");
const { db } = require("../../src/db/connection");

describe("Phase 2 — FOUR-EYES ARCHITECTURE", () => {
  let server;

  before(async () => {
    server = app.listen(0);
  });

  after(async () => {
    server.close();
  });

  it("test_eval_role_escalation_rejected: Analyst cannot mint an approver token", async () => {
    // Try to get approver token without passcode
    const res = await request(server)
      .post("/api/v1/auth/evaluation/persona")
      .send({ persona: "approver" });
    
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, "Unauthorized");
  });

  it("test_analyst_cannot_mint_approver: Analyst trying to mint approver without valid credentials fails", async () => {
    const res = await request(server)
      .post("/api/v1/auth/evaluation/persona")
      .send({ persona: "approver", passcode: "wrong" });
    
    assert.strictEqual(res.status, 401);
  });

  it("test_analyst_cannot_approve: Analyst cannot approve a remediation", async () => {
    // Get analyst token
    const analystRes = await request(server)
      .post("/api/v1/auth/evaluation/persona")
      .send({ persona: "analyst" });
    
    const analystToken = analystRes.body.accessToken;

    const res = await request(server)
      .post("/api/v1/remediation/approvals/test-approval/approve")
      .set("Authorization", `Bearer ${analystToken}`);
    
    // Should be 403 Forbidden because they are an analyst
    assert.strictEqual(res.status, 403);
  });

  it("test_approval_actor_is_server_derived: Request body role must never establish authority", async () => {
    // Even if analyst sends role=admin in body
    const analystRes = await request(server)
      .post("/api/v1/auth/evaluation/persona")
      .send({ persona: "analyst" });
    
    const analystToken = analystRes.body.accessToken;

    const res = await request(server)
      .post("/api/v1/remediation/approvals/test-approval/approve")
      .set("Authorization", `Bearer ${analystToken}`)
      .send({ role: "admin", persona: "approver" }); // Attempting to spoof
    
    assert.strictEqual(res.status, 403);
  });

  it("test_approver_must_be_independent_principal: Approver cannot approve the same proposal as its proposer", async () => {
    // We will set up a test approval where the proposer is evaluation-approver
    const approverRes = await request(server)
      .post("/api/v1/auth/evaluation/persona")
      .send({ persona: "approver", passcode: "ecdat-approver-2026" });
    
    const approverToken = approverRes.body.accessToken;
    
    await db("remediations").where({ id: "test-self-approval" }).del().catch(() => {});

    // Inject a dummy approval proposed by evaluation-approver
    await db("remediations").insert({
      id: "test-self-approval",
      state: "REVIEWED",
      tenant_id: "evaluation-tenant",
      proposer: "evaluation-approver", // Same user
      metadata: JSON.stringify({ description: "Test proposal" })
    }).catch(e => { console.error(e) });

    const res = await request(server)
      .post("/api/v1/remediation/approvals/test-self-approval/approve")
      .set("Authorization", `Bearer ${approverToken}`)
      .send({});
      
    if (res.status === 500) {
      console.log(res.body);
    }
    
    // Should be 403
    assert.strictEqual(res.status, 403);
    assert.match(res.body.message, /Four-Eyes Governance Violation/i);
    
    await db("remediations").where({ id: "test-self-approval" }).del().catch(() => {});
  });
});
