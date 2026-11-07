import { describe, expect, it } from "vitest";
import { middleEllipsis, formatCopiedPreview } from "./clipboardSubscriber";

describe("clipboardSubscriber formatters", () => {
  it("middleEllipsis leaves strings shorter than or equal to maxLen intact", () => {
    expect(middleEllipsis("short string", 52)).toBe("short string");
    expect(middleEllipsis("exact length 16", 15).length).toBe(15);
  });

  it("middleEllipsis truncates with an ellipsis in the middle when exceeding maxLen", () => {
    const long = "1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const result = middleEllipsis(long, 52);
    expect(result.length).toBe(52);
    expect(result).toContain("…");
    expect(result.startsWith("1234567890")).toBe(true);
    expect(result.endsWith("UVWXYZ")).toBe(true);
  });

  it("formatCopiedPreview formats multi-line report summaries properly", () => {
    const summary = [
      "Hash Patch — Post-Quantum Readiness Assessment",
      "Target: my_crypto_repo",
      "Generated: Sep 22, 2026",
      "Findings: 12 (4 broken by Shor, 3 weakened by Grover)",
      "CBOM SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ].join("\n");

    const formatted = formatCopiedPreview(summary);
    expect(formatted).toContain("(+4 more lines)");
    expect(formatted.length).toBeLessThanOrEqual(53);
    expect(formatted.startsWith("Hash Patch — Post")).toBe(true);
  });

  it("formatCopiedPreview handles URLs cleanly", () => {
    const url = "https://internal.security.example.com/reports/post-quantum-readiness-assessment-2026";
    const formatted = formatCopiedPreview(url);
    expect(formatted.length).toBe(52);
    expect(formatted.startsWith("https://internal.sec")).toBe(true);
    expect(formatted.endsWith("assessment-2026")).toBe(true);
  });
});
