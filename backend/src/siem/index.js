/**
 * ECDAT SIEM Integration Subsystem — Phase 18.2 Barrel Export
 */

const schema = require("./schema");
const eventBuilder = require("./event_builder");
const formatters = require("./formatters");
const dispatcher = require("./dispatcher");
const { defaultAuditService } = require("../audit/audit_service");

// Automatically bridge Phase 18.1 Audit Records to Phase 18.2 SIEM Security Events
defaultAuditService.subscribe((auditRecord) => {
  try {
    const siemEvent = eventBuilder.createSiemEventFromAudit(auditRecord);
    dispatcher.defaultSiemDispatcher.ingestEvent(siemEvent);
  } catch (err) {
    console.warn(`[SIEM Bridge] Failed to convert audit event to SIEM event: ${err.message}`);
  }
});

module.exports = {
  ...schema,
  ...eventBuilder,
  ...formatters,
  ...dispatcher,
};
