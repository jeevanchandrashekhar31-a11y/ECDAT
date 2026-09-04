# CI/CD gates

ECDAT writes its evidence artifacts before it returns a non-zero gate status.
This lets a pull request retain the CBOM, SARIF, and executive summary that
explain a failed decision.

The supported values for `--fail-on` are:

| Value | Non-zero exit condition |
| --- | --- |
| `none` | Never (report-only) |
| `critical` | At least one Critical finding |
| `high` | At least one High or Critical finding |
| `mosca-risk` | At least one `AT_RISK` or `CRITICAL_URGENT` Mosca result |

The static scanner can enforce deterministic Critical and High rule findings:

```bash
python -m scanners.static.main . --output artifacts/static_cbom.json \
  --output-sarif artifacts/static.sarif --fail-on high \
  --policy-profile regulated_bfsi
```

Mosca status is calculated by the backend risk engine. Use the importer for the
final policy-aware gate and to write a machine-readable summary:

```bash
node backend/src/scripts/import_cbom.js artifacts/static_cbom.json \
  --policy-profile regulated_bfsi --fail-on mosca-risk \
  --summary-out artifacts/summary.json --annotated-out artifacts/annotated_cbom.json
```

`.github/workflows/ecdat-scan.yml` runs a report-only repository scan, validates
the generated CBOM through the importer, runs test suites, and uploads all scan
artifacts. It also verifies that the committed vulnerable fixture returns a
non-zero Critical-gate result without making the normal workflow fail merely
because that demonstration fixture exists. The workflow has read-only GitHub
permissions and does not provide LLM or application secrets.
