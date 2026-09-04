import sys
import json
import argparse
from pathlib import Path

# Mosca's Theorem Defaults
MOSCA_Y = 3
MOSCA_Z = 10

def get_mosca_x(asset_type, finding):
    bom_ref = finding.get("bom-ref", "")
    if bom_ref.startswith("net:"):
        return 2
        
    if asset_type == "related-crypto-material":
        return 10
        
    # conservative default pending real data-classification input, not a measured value
    return 7

def validate_finding(finding):
    """Validates that a finding contains all required fields per the schema contract."""
    missing = []
    if "type" not in finding: missing.append("type")
    if "bom-ref" not in finding: missing.append("bom-ref")
    if "name" not in finding: missing.append("name")
    
    crypto_props = finding.get("cryptoProperties", {})
    if not crypto_props:
        missing.append("cryptoProperties")
    else:
        asset_type = crypto_props.get("assetType")
        if not asset_type:
            missing.append("cryptoProperties.assetType")
        else:
            # Check for the matching *Properties object
            prop_key = None
            if asset_type == "algorithm": prop_key = "algorithmProperties"
            elif asset_type == "certificate": prop_key = "certificateProperties"
            elif asset_type == "protocol": prop_key = "protocolProperties"
            elif asset_type == "related-crypto-material": prop_key = "relatedCryptoMaterialProperties"
            
            if prop_key and prop_key not in crypto_props:
                missing.append(f"cryptoProperties.{prop_key}")

    evidence = finding.get("evidence", {})
    occurrences = evidence.get("occurrences", [])
    if not occurrences:
        missing.append("evidence.occurrences")
    elif "location" not in occurrences[0]:
        missing.append("evidence.occurrences[0].location")

    return missing

def classify_finding(finding):
    """Applies classification rules and returns (severity, reason, recommendation)."""
    crypto_props = finding.get("cryptoProperties", {})
    asset_type = crypto_props.get("assetType")
    name = finding.get("name", "").upper()
    
    if asset_type == "related-crypto-material":
        return "Critical", "Secret exposure in source code", "Remove hardcoded keys and use a secure vault"

    if asset_type == "algorithm":
        algo_props = crypto_props.get("algorithmProperties", {})
        family = algo_props.get("algorithmFamily", "").upper()
        if not family:
            # Infer from name if missing
            if "RSA" in name: family = "RSA"
            elif "ECC" in name or "EC" in name or "DH" in name: family = "ECC/DH"
            elif "MD5" in name: family = "MD5"
            elif "SHA-1" in name or "SHA1" in name: family = "SHA1"
            elif "AES" in name: family = "AES"
            elif "SHA-256" in name: family = "SHA256"

        # MD5 / SHA-1
        if family in ["MD5", "SHA1", "SHA-1"]:
            return "Critical", "Classical security risk (collision attacks practical today)", "SHA-256 or SHA-3"
            
        # AES-256 / SHA-256
        if "AES-256" in name or "SHA-256" in name:
            return "Acceptable", "Weakened but not broken by Grover's algorithm, stays ~128-bit secure", None

        # RSA / ECC / DH
        if family in ["RSA", "EC", "ECC", "DH", "ECC/DH"]:
            size_str = algo_props.get("parameterSetIdentifier", "")
            if not size_str:
                # Try to extract size from name (e.g. RSA-2048)
                import re
                m = re.search(r'-(\d+)', name)
                if m: size_str = m.group(1)

            reason = "Broken by Shor's algorithm (nistQuantumSecurityLevel: 0)"
            
            # Check weak key size
            if size_str.isdigit():
                size = int(size_str)
                if (family == "RSA" and size < 2048) or (family in ["EC", "ECC", "ECC/DH"] and size < 256):
                    reason = f"Weak-key (size {size} is too small classically) AND broken by Shor's algorithm"
            elif "UNKNOWN" in name:
                reason = "Bit size not statically resolvable AND broken by Shor's algorithm"

            # Determine recommendation context
            primitive = algo_props.get("primitive", "").lower()
            context = ""
            for occ in finding.get("evidence", {}).get("occurrences", []):
                context += occ.get("additionalContext", "").lower() + " "
            
            is_sig = "signature" in primitive or "certificate" in context
            is_kx = "key exchange" in primitive or "negotiated" in context or "dh" in family.lower()

            if is_sig and not is_kx:
                rec = "FIPS 204 (ML-DSA)"
            elif is_kx and not is_sig:
                rec = "FIPS 203 (ML-KEM)"
            else:
                rec = "FIPS 203 (ML-KEM) or FIPS 204 (ML-DSA) depending on whether it's key exchange or signature"
                
            return "Critical", reason, rec

    if asset_type == "certificate":
        cert_props = crypto_props.get("certificateProperties", {})
        if cert_props.get("isExpired") is True:
            return "Critical", "Certificate is expired", None
        
        # If isSelfSigned is true in a leaf position
        if cert_props.get("isSelfSigned") is True and cert_props.get("chainPosition") == "leaf":
            return "Critical", "Self-signed leaf certificate — no CA vouches for this identity", None

        if cert_props.get("isExpired") is False and cert_props.get("isSelfSigned") is False:
            return "Acceptable", "Certificate is valid and properly chained", None

    if asset_type == "protocol":
        proto_props = crypto_props.get("protocolProperties", {})
        version = proto_props.get("version", "")
        if version in ["SSLv3", "TLSv1.0", "TLSv1.1"]:
            return "Critical", "Deprecated/weak TLS version", None
        if version in ["TLSv1.2", "TLSv1.3"]:
            return "Acceptable", "Modern TLS version, no protocol-level vulnerability", None

    return "Unclassified", "No specific classification rule matched", None

def add_property(finding, name, value):
    if "properties" not in finding:
        finding["properties"] = []
    finding["properties"].append({"name": name, "value": str(value)})

def main():
    parser = argparse.ArgumentParser(description="Merge and classify ECDAT CBOM findings.")
    parser.add_argument("network_cbom", help="Path to network scanner JSON output")
    parser.add_argument("static_cbom", help="Path to static scanner JSON output")
    parser.add_argument("--out-json", default="merged_cbom.json", help="Output merged JSON file")
    parser.add_argument("--out-html", default="summary.html", help="Output HTML summary file")
    args = parser.parse_args()

    # Load network findings
    net_path = Path(args.network_cbom)
    net_text = net_path.read_text(encoding="utf-8").strip()
    net_data = json.loads(net_text) if net_text else []
    net_findings = []
    if isinstance(net_data, list):
        for target_res in net_data:
            if isinstance(target_res, dict):
                net_findings.extend(target_res.get("findings", []))
    
    if net_text and not net_findings:
        print(f"================================================================================\n"
              f"!!! WARNING: Network CBOM '{args.network_cbom}' yielded 0 findings.\n"
              f"!!! The file is not empty, but the shape may be malformed or missing keys.\n"
              f"================================================================================", file=sys.stderr)

    # Load static findings
    static_path = Path(args.static_cbom)
    static_text = static_path.read_text(encoding="utf-8").strip()
    static_data = json.loads(static_text) if static_text else {}
    static_findings = []
    if isinstance(static_data, dict):
        static_findings = static_data.get("components", [])
        
    if static_text and not static_findings:
        print(f"================================================================================\n"
              f"!!! WARNING: Static CBOM '{args.static_cbom}' yielded 0 findings.\n"
              f"!!! The file is not empty, but the shape may be malformed or missing keys.\n"
              f"================================================================================", file=sys.stderr)

    merged = {}
    
    print("--- Merging and Validating Findings ---")
    for f in net_findings + static_findings:
        missing = validate_finding(f)
        bom_ref = f.get("bom-ref", "UNKNOWN_BOM_REF")
        
        if missing:
            print(f"WARNING: Skipping finding '{bom_ref}' due to missing required fields: {', '.join(missing)}", file=sys.stderr)
            continue
            
        if bom_ref in merged:
            print(f"BUG: Collision detected for bom-ref '{bom_ref}'. Skipping duplicate.", file=sys.stderr)
            continue
            
        merged[bom_ref] = f

    print("\n--- Classifying and Computing Mosca's Theorem ---")
    categorized = {"Critical": [], "Acceptable": [], "Unclassified": []}
    
    for ref, f in merged.items():
        severity, reason, rec = classify_finding(f)
        
        # Enrich finding properties
        add_property(f, "ecdat:severity", severity)
        add_property(f, "ecdat:reason", reason)
        if rec:
            add_property(f, "ecdat:recommendation", rec)
            
        # Mosca's Theorem
        mosca_gap = None
        asset_type = f.get("cryptoProperties", {}).get("assetType")
        
        if asset_type in ["algorithm", "certificate", "related-crypto-material"]:
            mosca_x = get_mosca_x(asset_type, f)
            add_property(f, "mosca:X", mosca_x)
            add_property(f, "mosca:Y", MOSCA_Y)
            add_property(f, "mosca:Z", MOSCA_Z)
            
            if (mosca_x + MOSCA_Y) > MOSCA_Z:
                mosca_gap = (mosca_x + MOSCA_Y) - MOSCA_Z
                add_property(f, "mosca:exceeds_Z", "true")
                add_property(f, "mosca:gap_years", mosca_gap)
            else:
                add_property(f, "mosca:exceeds_Z", "false")
                
        categorized[severity].append({
            "finding": f,
            "reason": reason,
            "rec": rec,
            "mosca_gap": mosca_gap
        })

    # Output JSON
    final_cbom = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "components": list(merged.values())
    }
    Path(args.out_json).write_text(json.dumps(final_cbom, indent=2), encoding="utf-8")
    
    # Output HTML
    html_lines = [
        "<!DOCTYPE html>",
        "<html>",
        "<head>",
        "<meta charset='utf-8'>",
        "<title>ECDAT Scan Summary</title>",
        "<style>",
        "body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #121212; color: #e0e0e0; max-width: 900px; margin: 40px auto; padding: 0 20px; line-height: 1.6; }",
        "h1, h2 { color: #ffffff; border-bottom: 1px solid #333; padding-bottom: 10px; }",
        ".finding { background: #1e1e1e; padding: 15px; margin-bottom: 15px; border-radius: 8px; border-left: 4px solid #4caf50; }",
        ".Critical .finding { border-left-color: #f44336; }",
        ".Unclassified .finding { border-left-color: #ffeb3b; }",
        ".Acceptable .finding { border-left-color: #4caf50; }",
        ".name { font-weight: bold; font-size: 1.1em; color: #90caf9; }",
        ".loc { font-family: monospace; color: #a5d6a7; font-size: 0.9em; background: #2c2c2c; padding: 2px 5px; border-radius: 4px; margin-left: 8px; }",
        ".detail { margin: 5px 0 0 10px; font-size: 0.95em; }",
        ".label { font-weight: bold; color: #b0bec5; }",
        "</style>",
        "</head>",
        "<body>",
        "<h1>ECDAT Scan Summary</h1>"
    ]
    
    for sev in ["Critical", "Acceptable", "Unclassified"]:
        items = categorized[sev]
        if not items: continue
        
        html_lines.append(f"<div class='{sev}'>")
        html_lines.append(f"<h2>{sev} Findings ({len(items)})</h2>")
        for item in items:
            f = item["finding"]
            loc = f["evidence"]["occurrences"][0].get("location", "Unknown")
            name = f["name"]
            
            html_lines.append("<div class='finding'>")
            html_lines.append(f"<div class='name'>{name} <span class='loc'>{loc}</span></div>")
            html_lines.append(f"<div class='detail'><span class='label'>Reason:</span> {item['reason']}</div>")
            if item['rec']:
                html_lines.append(f"<div class='detail'><span class='label'>Recommendation:</span> {item['rec']}</div>")
            if item['mosca_gap'] is not None:
                html_lines.append(f"<div class='detail'><span class='label'>Mosca Gap:</span> X+Y exceeds Z by <strong>{item['mosca_gap']} years</strong></div>")
            html_lines.append("</div>")
        html_lines.append("</div>")
        
    html_lines.append("</body></html>")
    
    Path(args.out_html).write_text("\n".join(html_lines), encoding="utf-8")
    
    print(f"\nDone. Processed {len(merged)} valid findings.")
    print(f"Results written to {args.out_json} and {args.out_html}")

if __name__ == "__main__":
    main()
