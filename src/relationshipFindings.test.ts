import { describe, expect, it } from "vitest";
import type { Finding } from "./cbom/types";
import { hasNoRelationships, relationshipFindings } from "./relationshipFindings";

function finding(id: string, findingType: Finding["findingType"]): Finding {
  return { id, findingType } as Finding;
}

describe("relationshipFindings", () => {
  it("excludes CRYPTO_REFERENCE, CERTIFICATE, and CERTIFICATE_UNPARSEABLE findings", () => {
    expect(hasNoRelationships(finding("a", "CRYPTO_REFERENCE"))).toBe(true);
    expect(hasNoRelationships(finding("b", "CERTIFICATE"))).toBe(true);
    expect(hasNoRelationships(finding("c", "CERTIFICATE_UNPARSEABLE"))).toBe(true);
  });

  it("keeps real operations and other finding types", () => {
    expect(hasNoRelationships(finding("d", "OPERATION"))).toBe(false);
    expect(hasNoRelationships(finding("e", "CLOUD_KEY_OPERATION"))).toBe(false);
    expect(hasNoRelationships(finding("f", "COMPILED_CRYPTO_ARTEFACT"))).toBe(false);
    expect(hasNoRelationships(finding("g", undefined))).toBe(false);
  });

  it("never lets a reference/certificate finding become a Relationships graph node", () => {
    // Regression guard for the entangled-corpus bug: 9 real operations + 5
    // CRYPTO_REFERENCE findings from config/crypto_names.py must never
    // render as 14 graph nodes -- references have no reachability and no
    // call-graph membership, and several reuse real operations' algorithm
    // names (SHA-1, SHA-256, ...), which looked like duplicate findings in
    // the "unconnected" list.
    const findings = [
      finding("op-md5", "OPERATION"),
      finding("op-sha1", "OPERATION"),
      finding("op-aes", "OPERATION"),
      finding("op-hmac256", "OPERATION"),
      finding("op-hmac384", "OPERATION"),
      finding("op-sha256", "OPERATION"),
      finding("op-sha384", "OPERATION"),
      finding("op-sha512", "OPERATION"),
      finding("op-des", "OPERATION"),
      finding("ref-md5", "CRYPTO_REFERENCE"),
      finding("ref-sha1", "CRYPTO_REFERENCE"),
      finding("ref-sha256", "CRYPTO_REFERENCE"),
      finding("ref-sha384", "CRYPTO_REFERENCE"),
      finding("ref-sha512", "CRYPTO_REFERENCE"),
    ];

    const result = relationshipFindings(findings);

    expect(result).toHaveLength(9);
    expect(result.every((f) => f.findingType === "OPERATION")).toBe(true);
    expect(result.some((f) => f.id.startsWith("ref-"))).toBe(false);
  });
});
