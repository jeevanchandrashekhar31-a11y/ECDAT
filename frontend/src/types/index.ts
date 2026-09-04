export type SeverityLevel = 'Critical' | 'High' | 'Medium' | 'Low' | 'Informational';
export type MoscaStatus = 'SAFE' | 'WATCH' | 'AT_RISK' | 'CRITICAL_URGENT';

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  informational: number;
}

export interface MoscaStatusCounts {
  SAFE: number;
  WATCH: number;
  AT_RISK: number;
  CRITICAL_URGENT: number;
}

export interface Metrics {
  total_assets: number;
  total_findings: number;
  critical_findings?: number;
  assets_at_quantum_risk: number;
  assets_at_risk?: number;
  assets_critical_urgent?: number;
  unknown_posture_percentage?: number;
  severity_counts: SeverityCounts;
  mosca_status_counts: MoscaStatusCounts;
  overall_cicd_pass: boolean;
}

export interface RiskyAlgorithmCount {
  algorithm: string;
  count: number;
}

export interface AffectedServiceItem {
  name: string;
  severity: string;
  type: string;
}

export interface RiskTrendPoint {
  scan_id: string;
  scan_name: string;
  date: string;
  critical: number;
  high: number;
  quantum_risk: number;
  total_findings: number;
}

export interface FindingsBySource {
  network: number;
  static: number;
  'binary-container': number;
  [key: string]: number;
}

export interface TopRiskyAsset {
  asset_id: string;
  primary_identifier: string;
  asset_type: string;
  data_sensitivity?: string;
  business_criticality?: string;
  severity: SeverityLevel;
  at_quantum_risk: boolean;
  cicd_pass: boolean;
  mosca_status: MoscaStatus;
  mosca_margin_years: number;
  findings_count?: number;
}

export interface MoscaTableRow {
  asset_id: string;
  algorithm: string;
  X_shelf_life_years: number;
  Y_migration_years: number;
  Z_quantum_threat_years: number;
  mosca_sum_years: number;
  mosca_margin_years: number;
  mosca_status: MoscaStatus;
}

export interface Recommendation {
  priority: 'critical' | 'high' | 'medium' | 'low';
  current_state: string;
  recommended_target: string;
  classical_remediation?: string;
  pqc_migration?: string;
  hybrid_transition_recommended?: boolean;
  migration_complexity?: string;
  latency_impact?: string;
  bandwidth_impact?: string;
  cost_category?: string;
  rationale?: string;
  references?: string[];
  assumptions?: string[];
}

export interface DashboardSummary {
  scan_id: string | null;
  scan_name?: string;
  policy_profile?: string;
  scenario?: string;
  rule_version?: string;
  created_at?: string;
  status?: string;
  message?: string;
  metrics: Metrics;
  findings_by_source?: FindingsBySource;
  most_common_risky_algorithms?: RiskyAlgorithmCount[];
  top_affected_services?: AffectedServiceItem[];
  risk_trend?: RiskTrendPoint[];
  top_risky_assets: TopRiskyAsset[];
  recommendations: Recommendation[];
  mosca_analysis_table: MoscaTableRow[];
  assumptions?: string[];
}

export interface AssetSummaryItem {
  asset_id: string;
  scan_id: string;
  primary_identifier: string;
  asset_type: string;
  data_sensitivity: string;
  business_criticality: string;
  highest_severity: SeverityLevel;
  at_quantum_risk: boolean;
  cicd_pass: boolean;
  source?: string;
  policy_profile?: string;
  mosca_status: MoscaStatus;
  findings_count?: number;
  created_at?: string;
}

export interface AssetsResponse {
  scan_id: string | null;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  assets: AssetSummaryItem[];
}

export interface AssetEvidence {
  finding_id: string;
  component_id: string;
  algorithm: string;
  key_size?: number | null;
  category?: string;
  confidence?: string;
  location?: string;
  line_number?: number;
}

export interface AssetRiskAssessment {
  severity: SeverityLevel;
  classical_risk: string;
  quantum_relevance: string;
  applied_rules?: string[];
  policy_violations?: string[];
  explanation: string;
}

export interface AssetMoscaData {
  status: MoscaStatus;
  margin_years: number;
  shelf_life_X: number;
  migration_time_Y: number;
  quantum_threat_Z: number;
  explanation: string;
}

export interface AssetDetail {
  asset_id: string;
  scan_id: string;
  target_name?: string;
  primary_identifier: string;
  asset_type: string;
  data_sensitivity: string;
  business_criticality: string;
  highest_severity: SeverityLevel;
  at_quantum_risk: boolean;
  cicd_pass: boolean;
  policy_profile?: string;
  evidence: AssetEvidence[];
  risks: AssetRiskAssessment[];
  mosca: AssetMoscaData;
  recommendations: Recommendation[];
}

export interface FindingItem {
  id: string;
  scan_id: string;
  component_id: string;
  asset_id: string;
  algorithm: string;
  key_size?: number | null;
  category?: string;
  finding_type?: string;
  location?: string;
  line_number?: number;
  confidence?: string;
  severity: SeverityLevel;
  classical_risk: string;
  quantum_relevance: string;
  mosca_status: MoscaStatus;
  mosca_margin_years: number;
  cicd_pass: boolean;
  explanation: string;
  recommendation_target?: string;
  pqc_migration?: string;
  recommendation_priority?: string;
  source?: string;
  policy_profile?: string;
  asset_type?: string;
  data_sensitivity?: string;
  business_criticality?: string;
}

export interface FindingsResponse {
  scan_id: string | null;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  findings: FindingItem[];
}

export interface ScanItem {
  id: string;
  name: string;
  project_id?: string;
  scanner_type?: string;
  policy_profile?: string;
  scenario?: string;
  status: string;
  created_at: string;
  metrics?: Partial<Metrics>;
}
