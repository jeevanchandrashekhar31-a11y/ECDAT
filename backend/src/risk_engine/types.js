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

const RiskConfidence = Object.freeze({
  CONFIRMED: "CONFIRMED",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
  HEURISTIC: "HEURISTIC",
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

const RemediationEffort = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  COMPLEX: "COMPLEX",
});

const AgilityDimensions = Object.freeze({
  CENTRALIZED_ALGORITHM_CONFIGURATION: "centralized_algorithm_configuration",
  REPLACEABILITY: "replaceability",
  KEY_LIFECYCLE_MANAGEMENT: "key_lifecycle_management",
  PROTOCOL_AGILITY: "protocol_agility",
  CERTIFICATE_AUTOMATION: "certificate_automation",
  PROVIDER_ABSTRACTION: "provider_abstraction",
  DEPENDENCY_COUPLING: "dependency_coupling",
  TEST_COVERAGE: "test_coverage",
  PQC_HYBRID_READINESS: "pqc_hybrid_readiness",
  ROLLBACK_CAPABILITY: "rollback_capability",
});

const AgilityMaturityTiers = Object.freeze({
  OPTIMAL: "OPTIMAL",
  HIGH: "HIGH",
  MODERATE: "MODERATE",
  LOW: "LOW",
  RIGID: "RIGID",
});

module.exports = {
  Severities,
  MoscaStatus,
  QuantumRelevance,
  EvidenceConfidence,
  RiskConfidence,
  DataSensitivity,
  BusinessCriticality,
  AssetType,
  RemediationEffort,
  AgilityDimensions,
  AgilityMaturityTiers,
};
