const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const app = require("../../src/app");
const { ingestSbom } = require("../../src/services/sbom_ingestion");
const { validateSbomStructure } = require("../../src/services/sbom_validation");

const validCycloneDx = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  serialNumber: "urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79",
  version: 1,
  components: [
    {
      "bom-ref": "pkg:npm/express@4.18.2",
      type: "library",
      name: "express",
      version: "4.18.2",
      purl: "pkg:npm/express@4.18.2",
      licenses: [{ license: { id: "MIT" } }],
    },
    {
      "bom-ref": "pkg:npm/body-parser@1.20.1",
      type: "library",
      name: "body-parser",
      version: "1.20.1",
      purl: "pkg:npm/body-parser@1.20.1",
      licenses: [{ expression: "Apache-2.0" }],
    },
  ],
  dependencies: [
    {
      ref: "pkg:npm/express@4.18.2",
      dependsOn: ["pkg:npm/body-parser@1.20.1"],
    },
  ],
};

const validSpdx = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: "ECDAT-SPDX-Test",
  packages: [
    {
      name: "openssl",
      SPDXID: "SPDXRef-Package-OpenSSL",
      versionInfo: "3.0.8",
      licenseConcluded: "Apache-2.0",
      licenseDeclared: "Apache-2.0",
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: "pkg:generic/openssl@3.0.8",
        },
      ],
    },
    {
      name: "zlib",
      SPDXID: "SPDXRef-Package-Zlib",
      versionInfo: "1.2.13",
      licenseConcluded: "Zlib",
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: "pkg:generic/zlib@1.2.13",
        },
      ],
    },
  ],
  relationships: [
    {
      spdxElementId: "SPDXRef-Package-OpenSSL",
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: "SPDXRef-Package-Zlib",
    },
  ],
};

test("SBOM Ingestion - Normalizes CycloneDX document components, purl, license, and dependencies", () => {
  const result = ingestSbom(validCycloneDx);

  assert.equal(result.status, "SUCCESS");
  assert.equal(result.format, "CycloneDX");
  assert.equal(result.spec_version, "1.6");
  assert.equal(result.component_count, 2);
  assert.equal(result.relationship_count, 1);

  const expressComp = result.components.find((c) => c.name === "express");
  assert.ok(expressComp);
  assert.equal(expressComp.version, "4.18.2");
  assert.equal(expressComp.purl, "pkg:npm/express@4.18.2");
  assert.deepEqual(expressComp.licenses, ["MIT"]);

  const dep = result.dependency_relationships[0];
  assert.equal(dep.from, "pkg:npm/express@4.18.2");
  assert.equal(dep.to, "pkg:npm/body-parser@1.20.1");
  assert.equal(dep.relationship_type, "DEPENDS_ON");
});

test("SBOM Ingestion - Normalizes SPDX document packages, purl from externalRefs, licenses, and relationships", () => {
  const result = ingestSbom(validSpdx);

  assert.equal(result.status, "SUCCESS");
  assert.equal(result.format, "SPDX");
  assert.equal(result.spec_version, "SPDX-2.3");
  assert.equal(result.component_count, 2);
  assert.equal(result.relationship_count, 1);

  const opensslPkg = result.components.find((c) => c.name === "openssl");
  assert.ok(opensslPkg);
  assert.equal(opensslPkg.version, "3.0.8");
  assert.equal(opensslPkg.purl, "pkg:generic/openssl@3.0.8");
  assert.deepEqual(opensslPkg.licenses, ["Apache-2.0"]);

  const rel = result.dependency_relationships[0];
  assert.equal(rel.from, "SPDXRef-Package-OpenSSL");
  assert.equal(rel.to, "SPDXRef-Package-Zlib");
  assert.equal(rel.relationship_type, "DEPENDS_ON");
});

test("SBOM Validation - Rejects malformed documents and unsupported formats", () => {
  // 1. Non-object payload
  const nonObj = validateSbomStructure("not-a-json-object");
  assert.equal(nonObj.valid, false);

  // 2. Unsupported format
  const unknownFormat = validateSbomStructure({ unknownSchema: "foo" });
  assert.equal(unknownFormat.valid, false);
  assert.ok(unknownFormat.errors.some((e) => e.includes("Unrecognized SBOM schema")));

  // 3. CycloneDX missing components
  const badCdx = validateSbomStructure({ bomFormat: "CycloneDX", specVersion: "1.6" });
  assert.equal(badCdx.valid, false);
  assert.ok(badCdx.errors.some((e) => e.includes("components")));

  // 4. Unsupported version
  const badVersion = validateSbomStructure({
    bomFormat: "CycloneDX",
    specVersion: "0.9",
    components: [],
  });
  assert.equal(badVersion.valid, false);
  assert.ok(badVersion.errors.some((e) => e.includes("specVersion")));
});

test("SBOM Validation - Rejects dangerous prototype pollution and excessive nesting", () => {
  const polluted = JSON.parse('{"bomFormat":"CycloneDX","specVersion":"1.6","components":[],"__proto__":{"polluted":true}}');
  const res = validateSbomStructure(polluted);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes("Dangerous property")));
});

test("SBOM Validation - Rejects excessively large component counts", () => {
  const hugeComponents = Array.from({ length: 50001 }, (_, i) => ({
    name: `pkg-${i}`,
    version: "1.0.0",
  }));
  const hugeSbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    components: hugeComponents,
  };
  const res = validateSbomStructure(hugeSbom);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes("exceeds the maximum safety bound")));
});

const config = require("../../src/config");

test("SBOM HTTP API - POST /api/v1/sbom/ingest and /validate endpoints", async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const authHeaders = {
    "Content-Type": "application/json",
    "X-API-Key": config.ECDAT_API_KEY,
  };

  try {
    // 1. Ingest CycloneDX
    const res1 = await fetch(`${baseUrl}/api/v1/sbom/ingest`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(validCycloneDx),
    });
    assert.equal(res1.status, 200);
    const body1 = await res1.json();
    assert.equal(body1.format, "CycloneDX");
    assert.equal(body1.component_count, 2);

    // 2. Ingest SPDX
    const res2 = await fetch(`${baseUrl}/api/v1/sbom/ingest`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(validSpdx),
    });
    assert.equal(res2.status, 200);
    const body2 = await res2.json();
    assert.equal(body2.format, "SPDX");
    assert.equal(body2.component_count, 2);

    // 3. Validate Endpoint
    const valRes = await fetch(`${baseUrl}/api/v1/sbom/validate`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(validCycloneDx),
    });
    assert.equal(valRes.status, 200);
    const valBody = await valRes.json();
    assert.equal(valBody.valid, true);

    // 4. Reject Bad Format
    const badRes = await fetch(`${baseUrl}/api/v1/sbom/ingest`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ invalid: "schema" }),
    });
    assert.equal(badRes.status, 415); // UnsupportedFormatError maps to 415
  } finally {
    server.close();
  }

});
