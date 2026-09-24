const fs = require('fs');
const file = 'c:/Users/Jeevan c/Documents/ECDAT/backend/tests/remediation/approval_workflow.test.js';
let content = fs.readFileSync(file, 'utf8');

// Add async to all test callbacks that use engine.*Remediation (which is all but the first)
content = content.replace(/test\(\"Approval Workflow - Lifecycle(.*?)\"\, \(\) => \{/g, 'test("Approval Workflow - Lifecycle$1", async () => {');
content = content.replace(/test\(\"Approval Workflow - Four-Eyes Principle(.*?)\"\, \(\) => \{/g, 'test("Approval Workflow - Four-Eyes Principle$1", async () => {');
content = content.replace(/test\(\"Approval Workflow - Enforces RBAC approver(.*?)\"\, \(\) => \{/g, 'test("Approval Workflow - Enforces RBAC approver$1", async () => {');
content = content.replace(/test\(\"Approval Workflow - Sensitive category(.*?)\"\, \(\) => \{/g, 'test("Approval Workflow - Sensitive category$1", async () => {');
content = content.replace(/test\(\"Approval Workflow - Supports ROLLED_BACK(.*?)\"\, \(\) => \{/g, 'test("Approval Workflow - Supports ROLLED_BACK$1", async () => {');

// Add await to proposeRemediation
content = content.replace(/const req = engine\.proposeRemediation/g, 'const req = await engine.proposeRemediation');
content = content.replace(/const req1 = engine\.proposeRemediation/g, 'const req1 = await engine.proposeRemediation');
content = content.replace(/const req2 = engine\.proposeRemediation/g, 'const req2 = await engine.proposeRemediation');

// Add await to all other engine calls
content = content.replace(/const reviewed = engine\.reviewRemediation/g, 'const reviewed = await engine.reviewRemediation');
content = content.replace(/const approved = engine\.approveRemediation/g, 'const approved = await engine.approveRemediation');
content = content.replace(/const applied = engine\.applyRemediation/g, 'const applied = await engine.applyRemediation');
content = content.replace(/const verified = engine\.verifyRemediation/g, 'const verified = await engine.verifyRemediation');
content = content.replace(/const rolledBack = engine\.rollbackRemediation/g, 'const rolledBack = await engine.rollbackRemediation');
content = content.replace(/const failed = engine\.failRemediation/g, 'const failed = await engine.failRemediation');

content = content.replace(/engine\.reviewRemediation\(/g, 'await engine.reviewRemediation(');
content = content.replace(/engine\.approveRemediation\(/g, 'await engine.approveRemediation(');
content = content.replace(/engine\.applyRemediation\(/g, 'await engine.applyRemediation(');

content = content.replace(/assert\.throws\(/g, 'await assert.rejects(');
content = content.replace(/const chain = engine\.verifyStateChain/g, 'const chain = await engine.verifyStateChain');

content = content.replace(/\(\) => \{\n      await engine\.approveRemediation/g, 'async () => {\n      await engine.approveRemediation');
content = content.replace(/\(\) => \{\n      await engine\.applyRemediation/g, 'async () => {\n      await engine.applyRemediation');

// Fix the ID extraction since the model stores the DB record with .id, not .approval_id
// We must be careful not to overwrite something that is already .id
content = content.replace(/req\.approval_id/g, '(req.approval_id || req.id)');
content = content.replace(/req1\.approval_id/g, '(req1.approval_id || req1.id)');
content = content.replace(/req2\.approval_id/g, '(req2.approval_id || req2.id)');

// Fix `req.requires_explicit_approval` which is now nested inside JSON metadata in the returned DB row
content = content.replace(/req\.requires_explicit_approval/g, '(req.metadata?.requires_explicit_approval || (typeof req.metadata === "string" ? JSON.parse(req.metadata).requires_explicit_approval : false))');

fs.writeFileSync(file, content);
console.log('Done!');
