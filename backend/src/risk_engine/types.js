/**
 * JSDoc Type Definitions and Constants for ECDAT Risk Engine
 */

const Severities = Object.freeze({
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  INFORMATIONAL: "Informational",
  UNCLASSIFIED: "Unclassified",
});

const MoscaStatus = Object.freeze({
  SAFE: "SAFE",
  WATCH: "WATCH",
  AT_RISK: "AT_RISK",
  CRITICAL_URGENT: "CRITICAL_URGENT",
});

const QuantumRelevance = Object.freeze({
  SHOR_VULNERABLE: "shor_vulnerable",
  GROVER_SENSITIVE: "grover_sensitive",
  QUANTUM_SAFE: "quantum_safe",
  NOT_APPLICABLE: "not_applicable",
});

const EvidenceConfidence = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
});

const DataSensitivity = Object.freeze({
  PUBLIC: "public",
  INTERNAL: "internal",
  CONFIDENTIAL: "confidential",
  RESTRICTED: "restricted",
});

const BusinessCriticality = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
});

const AssetType = Object.freeze({
  NETWORK_SESSION: "network_session",
  CERTIFICATE: "certificate",
  HARDCODED_PRIVATE_KEY: "hardcoded_private_key",
  STORED_ENCRYPTED_DATA: "stored_encrypted_data",
  SIGNING_KEY: "signing_key",
  LIBRARY_PRESENCE: "library_presence",
  FILE: "file",
});

module.exports = {
  Severities,
  MoscaStatus,
  QuantumRelevance,
  EvidenceConfidence,
  DataSensitivity,
  BusinessCriticality,
  AssetType,
};
