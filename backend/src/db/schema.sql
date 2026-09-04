CREATE TABLE IF NOT EXISTS scans (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    source VARCHAR(255) NOT NULL,
    raw_cbom JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS findings (
    id SERIAL PRIMARY KEY,
    scan_id INTEGER REFERENCES scans(id) ON DELETE CASCADE,
    bom_ref VARCHAR(255) NOT NULL,
    asset_type VARCHAR(100),
    finding_name VARCHAR(255),
    severity VARCHAR(50),
    quantum_risk_gap INTEGER,
    details JSONB
);
