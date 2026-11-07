import { describe, expect, it } from "vitest";
import { parseCbomDocument } from "./cbom/cbomToFindings";

describe("parseCbomDocument contradictions", () => {
  it("surfaces cross-layer TLS contradictions as findings", () => {
    const rawCbom = {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      components: [],
      metadata: {
        properties: [
          {
            name: "hash_patch:contradiction.contradiction-48d6f036872ff923",
            value: JSON.stringify({
              id: "contradiction-48d6f036872ff923",
              severity: "medium",
              description:
                "Source code at testdata/contradictions/scenario1_conflict/app.py:6 configures TLSv1.3 minimum, but deployed configuration at testdata/contradictions/scenario1_conflict/nginx.conf:4 (nginx) permits TLSv1.0 (TLS 1.0 (deprecated RFC 8996, lacks AEAD)), TLSv1.1 (TLS 1.1 (deprecated RFC 8996, lacks AEAD)) — the deployed configuration does not enforce the code's stated policy.",
              sourceIntent: {
                format: "source-code-intent",
                value: "TLSv1.3",
                locator: "testdata/contradictions/scenario1_conflict/app.py",
                line: 6,
              },
              deployedConfig: {
                format: "nginx",
                value: "TLSv1 TLSv1.1 TLSv1.2 TLSv1.3",
                legacyReasons: [
                  "TLSv1.0 (TLS 1.0 (deprecated RFC 8996, lacks AEAD))",
                  "TLSv1.1 (TLS 1.1 (deprecated RFC 8996, lacks AEAD))",
                ],
                locator: "testdata/contradictions/scenario1_conflict/nginx.conf",
                line: 4,
              },
            }),
          },
        ],
      },
    };

    const parsed = parseCbomDocument(rawCbom);
    expect(parsed.contradictions).toHaveLength(1);
    expect(parsed.findings).toHaveLength(1);

    const finding = parsed.findings[0];
    expect(finding.id).toBe("contradiction-48d6f036872ff923");
    expect(finding.name).toContain("TLS Policy Contradiction");
    expect(finding.name).toContain("TLSv1.3");
    expect(finding.evidence).toHaveLength(2);
    expect(finding.evidence[0].locator).toBe("testdata/contradictions/scenario1_conflict/app.py");
    expect(finding.evidence[0].line).toBe(6);
    expect(finding.evidence[1].locator).toBe("testdata/contradictions/scenario1_conflict/nginx.conf");
    expect(finding.evidence[1].line).toBe(4);
    expect(finding.evidenceChain).toContain("configures TLSv1.3 minimum");
  });
});
