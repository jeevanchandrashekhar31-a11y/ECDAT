import React from 'react';
import { Page, Text, View, Document, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
 page: {
 padding: 35,
 fontFamily: 'Helvetica',
 backgroundColor: '#ffffff',
 },
 header: {
 marginBottom: 25,
 borderBottomWidth: 2,
 borderBottomColor: '#0f172a',
 paddingBottom: 15,
 },
 title: {
 fontSize: 22,
 color: '#0f172a',
 fontFamily: 'Helvetica-Bold',
 marginBottom: 6,
 },
 subtitle: {
 fontSize: 10,
 color: '#64748b',
 lineHeight: 1.4,
 },
 noticeBox: {
 backgroundColor: '#f8fafc',
 borderLeftWidth: 4,
 borderLeftColor: '#3b82f6',
 padding: 12,
 marginBottom: 25,
 },
 noticeTitle: {
 fontSize: 9,
 fontFamily: 'Helvetica-Bold',
 color: '#1e3a8a',
 marginBottom: 4,
 textTransform: 'uppercase',
 },
 noticeText: {
 fontSize: 9,
 color: '#334155',
 lineHeight: 1.5,
 },
 sectionTitle: {
 fontSize: 12,
 fontFamily: 'Helvetica-Bold',
 color: '#0f172a',
 marginBottom: 12,
 marginTop: 15,
 textTransform: 'uppercase',
 },
 stepContainer: {
 marginBottom: 10,
 padding: 10,
 borderWidth: 1,
 borderColor: '#cbd5e1',
 borderRadius: 4,
 backgroundColor: '#ffffff',
 },
 stepHeader: {
 flexDirection: 'row',
 justifyContent: 'space-between',
 alignItems: 'center',
 marginBottom: 6,
 },
 stepTitle: {
 fontSize: 11,
 fontFamily: 'Helvetica-Bold',
 color: '#0f172a',
 },
 stepPhase: {
 fontSize: 8,
 color: '#0f172a',
 backgroundColor: '#f1f5f9',
 paddingVertical: 3,
 paddingHorizontal: 6,
 borderRadius: 3,
 },
 stepDescription: {
 fontSize: 9,
 color: '#0f172a',
 lineHeight: 1.4,
 },
 recCard: {
 marginBottom: 15,
 padding: 12,
 borderWidth: 1,
 borderColor: '#cbd5e1',
 borderRadius: 4,
 },
 recHeader: {
 flexDirection: 'row',
 justifyContent: 'space-between',
 alignItems: 'center',
 borderBottomWidth: 1,
 borderBottomColor: '#e2e8f0',
 paddingBottom: 8,
 marginBottom: 8,
 },
 recTarget: {
 fontSize: 11,
 fontFamily: 'Courier-Bold',
 color: '#0f172a',
 flex: 1,
 marginRight: 10,
 },
 badgeCritical: {
 fontSize: 7,
 backgroundColor: '#fee2e2',
 color: '#991b1b',
 paddingVertical: 3,
 paddingHorizontal: 6,
 borderRadius: 3,
 fontFamily: 'Helvetica-Bold',
 textTransform: 'uppercase',
 },
 badgeHigh: {
 fontSize: 7,
 backgroundColor: '#ffedd5',
 color: '#9a3412',
 paddingVertical: 3,
 paddingHorizontal: 6,
 borderRadius: 3,
 fontFamily: 'Helvetica-Bold',
 textTransform: 'uppercase',
 },
 badgeMedium: {
 fontSize: 7,
 backgroundColor: '#f3e8ff',
 color: '#5b21b6',
 paddingVertical: 3,
 paddingHorizontal: 6,
 borderRadius: 3,
 fontFamily: 'Helvetica-Bold',
 textTransform: 'uppercase',
 },
 badgeLow: {
 fontSize: 7,
 backgroundColor: '#e0f2fe',
 color: '#0369a1',
 paddingVertical: 3,
 paddingHorizontal: 6,
 borderRadius: 3,
 fontFamily: 'Helvetica-Bold',
 textTransform: 'uppercase',
 },
 badgeStep: {
 fontSize: 7,
 backgroundColor: '#f1f5f9',
 color: '#0f172a',
 paddingVertical: 3,
 paddingHorizontal: 6,
 borderRadius: 3,
 fontFamily: 'Helvetica-Bold',
 textTransform: 'uppercase',
 marginLeft: 5,
 },
 badgeHybrid: {
 fontSize: 7,
 backgroundColor: '#cffafe',
 color: '#0891b2',
 paddingVertical: 3,
 paddingHorizontal: 6,
 borderRadius: 3,
 fontFamily: 'Helvetica-Bold',
 textTransform: 'uppercase',
 marginLeft: 5,
 },
 recGrid: {
 flexDirection: 'row',
 justifyContent: 'space-between',
 marginBottom: 10,
 },
 recGridCol: {
 width: '32%',
 padding: 8,
 backgroundColor: '#f8fafc',
 borderWidth: 1,
 borderColor: '#e2e8f0',
 borderRadius: 3,
 },
 recGridTitle: {
 fontSize: 7,
 fontFamily: 'Helvetica-Bold',
 color: '#0f172a',
 textTransform: 'uppercase',
 marginBottom: 4,
 },
 recGridText: {
 fontSize: 8,
 color: '#0f172a',
 lineHeight: 1.4,
 },
 techDetailsRow: {
 flexDirection: 'row',
 borderTopWidth: 1,
 borderTopColor: '#e2e8f0',
 paddingTop: 8,
 marginTop: 4,
 },
 techMetric: {
 width: '25%',
 },
 techMetricTitle: {
 fontSize: 6,
 fontFamily: 'Helvetica-Bold',
 color: '#0f172a',
 textTransform: 'uppercase',
 },
 techMetricValue: {
 fontSize: 8,
 fontFamily: 'Helvetica-Bold',
 color: '#0f172a',
 marginTop: 2,
 },
 rationaleBox: {
 marginTop: 8,
 },
 rationaleTitle: {
 fontSize: 8,
 fontFamily: 'Courier-Bold',
 color: '#0f172a',
 marginBottom: 3,
 },
 rationaleText: {
 fontSize: 8,
 color: '#0f172a',
 lineHeight: 1.4,
 },
 footer: {
 position: 'absolute',
 bottom: 30,
 left: 35,
 right: 35,
 flexDirection: 'row',
 justifyContent: 'space-between',
 borderTopWidth: 1,
 borderTopColor: '#cbd5e1',
 paddingTop: 8,
 },
 footerText: {
 fontSize: 8,
 color: '#475569',
 }
});

// We define our props types
interface RoadmapPDFProps {
 summary: any;
 sequenceSteps: any[];
 enrichedRecommendations: any[];
}

export const RoadmapPDFDocument: React.FC<RoadmapPDFProps> = ({ summary, sequenceSteps, enrichedRecommendations }) => {
 const getBadgeStyle = (priority?: string) => {
 switch ((priority || '').toLowerCase()) {
 case 'critical': return styles.badgeCritical;
 case 'high': return styles.badgeHigh;
 case 'medium': return styles.badgeMedium;
 default: return styles.badgeLow;
 }
 };

 return (
 <Document title={`ECDAT_PQC_Migration_Roadmap_${summary?.scan_id || 'Active'}`}>
 <Page size="A4" style={styles.page}>
 
 {/* Header */}
 <View style={styles.header}>
 <Text style={styles.title}>PQC Migration Roadmap & Execution View</Text>
 <Text style={styles.subtitle}>
 Actionable, prioritized post-quantum transition plan rooted in cryptographic discovery and Mosca Theorem risk calculus.
 </Text>
 <Text style={[styles.subtitle, { marginTop: 4, fontFamily: 'Courier', fontSize: 8 }]}>
 Scan ID: {summary?.scan_id || 'N/A'} | Generated: {new Date().toLocaleDateString()}
 </Text>
 </View>

 {/* Notice Box */}
 <View style={styles.noticeBox}>
 <Text style={styles.noticeTitle}>Pragmatic Engineering Notice — Standards-Aligned Hybrid Transition</Text>
 <Text style={styles.noticeText}>
 This roadmap enforces a dual-track transition strategy designed specifically to avoid overpromising unsupported standalone PQC deployment. Phase 1 prioritizes mandatory classical cryptographic hygiene (e.g. eradicating MD5, DES, and hardcoded private keys). Phase 2 deploys standards-compliant hybrid key exchange (e.g. X25519MLKEM768) where classical and post-quantum mechanisms operate in tandem. Direct standalone PQC cutover is deferred until ecosystem trust chains, client operating systems, and HSM firmware reach verified commercial maturity.
 </Text>
 </View>

 {/* Sequence Steps */}
 <Text style={styles.sectionTitle}>Execution Sequence (5 Strategic Phases)</Text>
 {sequenceSteps.map((step) => (
 <View style={styles.stepContainer} key={step.id} wrap={false}>
 <View style={styles.stepHeader}>
 <Text style={styles.stepTitle}>{step.title}</Text>
 <Text style={styles.stepPhase}>{step.recommendedPhase}</Text>
 </View>
 <Text style={styles.stepDescription}>{step.description}</Text>
 </View>
 ))}

 {/* Page numbers */}
 <Text style={styles.footerText} render={({ pageNumber, totalPages }) => (
 `Page ${pageNumber} of ${totalPages} - ECDAT Enterprise Cryptographic Discovery`
 )} fixed />

 </Page>

 {/* Recommendations Queue */}
 <Page size="A4" style={styles.page}>
 <Text style={styles.sectionTitle}>Prioritized Action Queue</Text>
 
 {enrichedRecommendations.map((rec) => (
 <View style={styles.recCard} key={rec.id} wrap={false}>
 
 {/* Header */}
 <View style={styles.recHeader}>
 <Text style={styles.recTarget}>{rec.recommended_target || 'General Recommendation'}</Text>
 <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
 <Text style={getBadgeStyle(rec.priority)}>{rec.priority || 'Standard'} Priority</Text>
 <Text style={styles.badgeStep}>Step {rec.sequenceStep || 5}</Text>
 {rec.hybrid_transition_recommended ? (
 <Text style={styles.badgeHybrid}>Hybrid Rec.</Text>
 ) : null}
 </View>
 </View>

 {/* Grid for Current/Phase 1/Phase 2 */}
 <View style={styles.recGrid}>
 <View style={styles.recGridCol}>
 <Text style={styles.recGridTitle}>Current State</Text>
 <Text style={styles.recGridText}>{rec.current_state || 'Not specified'}</Text>
 </View>
 <View style={styles.recGridCol}>
 <Text style={[styles.recGridTitle, { color: '#9a3412' }]}>Phase 1: Classical</Text>
 <Text style={styles.recGridText}>{rec.classical_remediation || 'Maintain standard baseline.'}</Text>
 </View>
 <View style={styles.recGridCol}>
 <Text style={[styles.recGridTitle, { color: '#0369a1' }]}>Phase 2: PQC Migration</Text>
 <Text style={styles.recGridText}>{rec.pqc_migration || 'Evaluate NIST FIPS 203 standard.'}</Text>
 </View>
 </View>

 {/* Technical Details */}
 <View style={styles.techDetailsRow}>
 <View style={styles.techMetric}>
 <Text style={styles.techMetricTitle}>Complexity</Text>
 <Text style={styles.techMetricValue}>{rec.migration_complexity || 'Medium'}</Text>
 </View>
 <View style={styles.techMetric}>
 <Text style={styles.techMetricTitle}>Latency</Text>
 <Text style={styles.techMetricValue}>{rec.latency_impact || 'Low (<5ms)'}</Text>
 </View>
 <View style={styles.techMetric}>
 <Text style={styles.techMetricTitle}>Bandwidth</Text>
 <Text style={styles.techMetricValue}>{rec.bandwidth_impact || 'Moderate'}</Text>
 </View>
 <View style={styles.techMetric}>
 <Text style={styles.techMetricTitle}>Cost</Text>
 <Text style={styles.techMetricValue}>{rec.cost_category || 'Operational'}</Text>
 </View>
 </View>

 {/* Rationale */}
 {rec.rationale ? (
 <View style={styles.rationaleBox}>
 <Text style={styles.rationaleTitle}>Architectural Rationale:</Text>
 <Text style={styles.rationaleText}>{rec.rationale}</Text>
 </View>
 ) : null}

 {rec.references && rec.references.length > 0 ? (
 <View style={[styles.rationaleBox, { marginTop: 4 }]}>
 <Text style={styles.rationaleTitle}>Standards References:</Text>
 <Text style={styles.rationaleText}>
 {Array.isArray(rec.references) ? rec.references.join(', ') : rec.references}
 </Text>
 </View>
 ) : null}
 
 </View>
 ))}

 <Text style={styles.footerText} render={({ pageNumber, totalPages }) => (
 `Page ${pageNumber} of ${totalPages} - ECDAT Enterprise Cryptographic Discovery`
 )} fixed />

 </Page>
 </Document>
 );
};
