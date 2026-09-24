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
 detection_method?: string;
 status?: string;
 dismissal_reason?: string;
 cached?: boolean;
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

export interface EvidenceFinding {
 id: string;
 algorithm: string;
 key_size?: number | null;
 category: string;
 severity: SeverityLevel;
 mosca_status: MoscaStatus;
 classical_risk: string;
 quantum_relevance: string;
 location?: string;
 line_number?: number;
 evidence_context?: string;
 asset_id?: string;
}

export interface ExecutiveKPI {
 id: string;
 title: string;
 label?: string;
 value: string | number;
 change?: string;
 status: 'critical' | 'warning' | 'safe' | 'info';
 evidenceCount: number;
 evidence_items?: string[];
 evidenceFilter?: Record<string, string>;
}

export interface ExecutiveOverviewView {
 posture_score: number;
 posture_rating: string;
 pqc_readiness_pct: number;
 total_assets: number;
 total_findings: number;
 critical_findings: number;
 high_findings: number;
 medium_findings: number;
 low_findings: number;
 info_findings: number;
 quantum_risk_count: number;
 overall_cicd_pass: boolean;
 quick_wins_count: number;
 kpis: ExecutiveKPI[];
 kpi_cards?: ExecutiveKPI[];
 severity_breakdown?: Array<{
 severity: string;
 count: number;
 color: string;
 evidence_items: string[];
 }>;
}

export interface CryptoInventoryComponent {
 id: string;
 name: string;
 algorithm: string;
 key_size?: number | null;
 primitive: string;
 asset_id: string;
 location?: string;
 line_number?: number;
 severity: SeverityLevel;
 mosca_status: MoscaStatus;
 quantum_relevance: string;
 evidence_snippet?: string;
 finding_id: string;
}

export interface CryptoInventoryView {
 total_components: number;
 components: CryptoInventoryComponent[];
}

export interface ApplicationInventoryApp {
 id: string;
 name: string;
 type: string;
 sensitivity: string;
 criticality: string;
 severity: SeverityLevel;
 at_quantum_risk: boolean;
 owner: string;
 blast_radius: number;
 dependencies: number;
 crypto_findings_count: number;
 evidence_items: string[];
 asset_type?: string;
 data_sensitivity?: string;
 highest_severity?: SeverityLevel;
 business_criticality?: string;
}

export interface ApplicationInventoryView {
 total_applications: number;
 applications: ApplicationInventoryApp[];
}

export interface HeatmapCell {
 key: string;
 impact: string;
 likelihood: string;
 count: number;
 colorClass: string;
 evidence_items: string[];
 sample_evidence?: Array<{ id: string; algo: string; location?: string }>;
}

export interface RiskHeatmapView {
 total_cells: number;
 active_hotspots_count: number;
 matrix: HeatmapCell[];
}

export interface PqcTimelineItem {
 finding_id: string;
 asset_id: string;
 algorithm: string;
 x_shelf_life_years: number;
 y_migration_years: number;
 z_quantum_threat_years: number;
 margin_years: number;
 status: MoscaStatus;
 evidence_context?: string;
 location?: string;
}

export interface PqcReadinessView {
 overall_readiness_score: number;
 shor_vulnerable_count: number;
 shor_evidence: string[];
 grover_vulnerable_count: number;
 grover_evidence: string[];
 pqc_safe_count: number;
 pqc_evidence: string[];
 hybrid_adoption_count: number;
 nist_standards_alignment: Array<{
 standard: string;
 target: string;
 status: string;
 evidenceCount: number;
 }>;
 mosca_timeline: PqcTimelineItem[];
 timeline?: PqcTimelineItem[];
 mosca_summary?: {
 critical_urgent: number;
 at_risk: number;
 watch: number;
 safe: number;
 };
}

export interface CertificateItem {
 fingerprint_sha256: string;
 subject_dn: string;
 issuer_dn: string;
 validity_start: string;
 validity_end: string;
 days_remaining: number;
 algorithm: string;
 key_size: number;
 renewal_state: string;
 detected_anomalies: string[];
 evidence_link: string;
}

export interface CertificatesView {
 total_certificates: number;
 expired_count: number;
 expiring_soon_count: number;
 weak_keys_count: number;
 certificates: CertificateItem[];
}

export interface AlgorithmItem {
 name: string;
 key_size?: number | null;
 primitive: string;
 count: number;
 classical_risk: string;
 quantum_relevance: string;
 target_replacement: string;
 evidence_occurrences: Array<{
 finding_id: string;
 asset_id: string;
 location?: string;
 line_number?: number;
 evidence_context?: string;
 }>;
}

export interface AlgorithmsView {
 total_distinct_algorithms: number;
 algorithms: AlgorithmItem[];
}

export interface NetworkEndpointItem {
 id: string;
 host: string;
 port: number;
 protocol: string;
 tls_version: string;
 cipher_suites_count: number;
 weak_ciphers_detected: number;
 pfs_supported: boolean;
 hybrid_supported: boolean;
 cert_fingerprint: string;
 evidence_finding_id: string;
}

export interface NetworkEndpointsView {
 total_endpoints: number;
 endpoints: NetworkEndpointItem[];
}

export interface RuntimeObservationItem {
 id: string;
 observation_type: string;
 target: string;
 component: string;
 details: string;
 reachability_confirmed: boolean;
 timestamp: string;
 evidence_id: string;
 evidence_snippet?: string;
}

export interface RuntimeObservationsView {
 total_observations: number;
 observations: RuntimeObservationItem[];
}

export interface PolicyViolationItem {
 rule_id: string;
 rule_name: string;
 description: string;
 severity: SeverityLevel;
 threshold: string;
 affected_count: number;
 evidence_items: string[];
}

export interface PolicyViolationsView {
 active_profile: string;
 total_violations: number;
 blocking_violations_count: number;
 violations: PolicyViolationItem[];
}

export interface QuickWinItem {
 id: string;
 finding_id: string;
 asset_id: string;
 algorithm: string;
 recommended_target: string;
 complexity: string;
 category: string;
 patch_available: boolean;
 patch_diff?: string;
 rationale: string;
}

export interface ComplexMigrationItem {
 id: string;
 finding_id: string;
 asset_id: string;
 algorithm: string;
 recommended_target: string;
 complexity: string;
 category: string;
 pqc_migration: string;
 rationale: string;
}

export interface RemediationView {
 total_remediations: number;
 quick_wins_count: number;
 complex_migrations_count: number;
 quick_wins: QuickWinItem[];
 complex_migrations: ComplexMigrationItem[];
}

export interface OwnershipTeamItem {
 team_name: string;
 lead: string;
 asset_count: number;
 critical_count: number;
 high_count: number;
 total_findings: number;
 sla_compliance_pct: number;
 evidence_asset_ids: string[];
}

export interface OwnershipView {
 total_teams: number;
 unowned_assets_count: number;
 teams: OwnershipTeamItem[];
}

export interface AuditEventItem {
 id: string;
 event_type: string;
 table_name: string;
 record_id: string;
 actor: string;
 action: string;
 status: string;
 created_at: string;
 details?: Record<string, unknown>;
}

export interface AuditTrailView {
 total_events: number;
 events: AuditEventItem[];
}

export interface DashboardViewsResponse {
 scan_id: string;
 scan_name: string;
 policy_profile: string;
 scenario: string;
 created_at: string;
 views: {
 executive_overview: ExecutiveOverviewView;
 crypto_inventory: CryptoInventoryView;
 application_inventory: ApplicationInventoryView;
 risk_heatmap: RiskHeatmapView;
 pqc_readiness: PqcReadinessView;
 certificates: CertificatesView;
 algorithms: AlgorithmsView;
 network_endpoints: NetworkEndpointsView;
 runtime_observations: RuntimeObservationsView;
 policy_violations: PolicyViolationsView;
 remediation: RemediationView;
 ownership: OwnershipView;
 audit_trail: AuditTrailView;
 };
 evidence_lookup: Record<string, EvidenceFinding>;
}

export type GraphTier = 'Application' | 'Service' | 'Certificate' | 'Protocol' | 'Algorithm' | 'Data';

export interface GraphNode {
 id: string;
 tier: GraphTier;
 type: 'application' | 'service' | 'certificate' | 'protocol' | 'algorithm' | 'data';
 label: string;
 severity: SeverityLevel;
 owner: string;
 environment: string;
 exposure: string;
 pqc_readiness: MoscaStatus | string;
 algorithm: string;
 metadata?: Record<string, unknown>;
 evidence_items: string[];
}

export interface GraphEdge {
 id: string;
 source: string;
 target: string;
 relation: string;
 severity: SeverityLevel;
}

export interface GraphFilterMetadata {
 severities: string[];
 owners: string[];
 environments: string[];
 algorithms: string[];
 pqc_statuses: string[];
 exposures: string[];
}

export interface CryptoGraphResponse {
 scan_id: string;
 scan_name: string;
 graph: {
 nodes: GraphNode[];
 edges: GraphEdge[];
 total_nodes: number;
 total_edges: number;
 unfiltered_nodes_count: number;
 unfiltered_edges_count: number;
 node_types: Record<string, number>;
 };
 filter_metadata: GraphFilterMetadata;
 evidence_lookup: Record<string, EvidenceFinding>;
}

export type ApprovalState = 'PROPOSED' | 'REVIEWED' | 'APPROVED' | 'APPLIED' | 'VERIFIED' | 'REJECTED' | 'ROLLED_BACK';

export interface RemediationAuditItem {
 event_id: string;
 from_state: ApprovalState | null;
 to_state: ApprovalState;
 actor: string;
 role: string;
 timestamp: string;
 comments: string;
 hash: string;
}

export interface RemediationApprovalRecord {
 approval_id: string;
 state: ApprovalState;
 title: string;
 description: string;
 category: string;
 environment: string;
 requires_explicit_approval: boolean;
 finding_id: string | null;
 affected_asset: string | null;
 tenantId: string;
 project_id?: string | null;
 target_standard?: string | null;
 patch_diff?: string | null;
 test_plan?: string | null;
 rollback_plan?: string | null;
 proposer: {
 username: string;
 role: string;
 proposed_at: string;
 };
 reviewer?: {
 username: string;
 role: string;
 reviewed_at: string;
 comments?: string;
 } | null;
 approver?: {
 username: string;
 role: string;
 approved_at: string;
 comments?: string;
 } | null;
 deployer?: {
 username: string;
 role: string;
 applied_at: string;
 } | null;
 verifier?: {
 username: string;
 role: string;
 verified_at: string;
 verification_results?: Record<string, unknown>;
 } | null;
 audit_history: RemediationAuditItem[];
 current_state_hash: string;
}

export interface RemediationApprovalsResponse {
 success: boolean;
 total_approvals: number;
 approvals: RemediationApprovalRecord[];
}



