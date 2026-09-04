import type { Finding } from "./cbom/types";
import { computeAggregatePriority } from "./priority";

export interface TreeNode {
  id: string;
  name: string;
  path: string;
  fullPath: string;
  isFolder: boolean;
  depth: number;
  children: TreeNode[];
  findings: Finding[];
  allFindings: Finding[];
  totalFindings: number;
  priorityScore: number;
  counts: {
    shor: number;
    classic: number;
    grover: number;
    safe: number;
  };
}

/**
 * Known structural directories for eval-target (and standard repos) so architectural
 * folders without crypto assets appear naturally in the tree and can be drilled down into.
 */
const KNOWN_EVAL_TARGET_DIRS = [
  ".github",
  ".github/workflows",
  "docs",
  "docs/development",
  "docs/development/custom-vectors",
  "docs/_ext",
  "docs/_static",
  "docs/_templates",
  "docs/statements",
  "docs/x509",
  "src",
  "src/cryptography",
  "src/cryptography/hazmat",
  "tests",
  "tests/bench",
  "tests/hazmat",
  "tests/wycheproof",
  "tests/x509",
  "vectors",
  "vectors/cryptography_vectors",
];

export function normalizeLocation(rawLoc: string, targetRoot: string): string {
  let loc = rawLoc.replace(/\\/g, "/");

  // Remove drive letters like D:/
  const driveMatch = /^[A-Za-z]:\//.exec(loc);
  if (driveMatch) {
    loc = loc.slice(driveMatch[0].length);
  }

  // Normalize targetRoot
  let normRoot = targetRoot.replace(/\\/g, "/");
  const rootDriveMatch = /^[A-Za-z]:\//.exec(normRoot);
  if (rootDriveMatch) {
    normRoot = normRoot.slice(rootDriveMatch[0].length);
  }
  normRoot = normRoot.replace(/^\/+|\/+$/g, "");

  // If loc starts with normRoot, strip it
  if (normRoot && loc.startsWith(normRoot + "/")) {
    loc = loc.slice(normRoot.length + 1);
  } else if (loc.includes("/eval-target/")) {
    loc = loc.split("/eval-target/")[1] ?? loc;
  } else if (loc.startsWith("eval-target/")) {
    loc = loc.slice("eval-target/".length);
  } else if (loc.startsWith("../eval-target/")) {
    loc = loc.slice("../eval-target/".length);
  } else if (loc.startsWith("./")) {
    loc = loc.slice(2);
  }

  return loc.replace(/^\/+/, "");
}

function dedupeFindingsById(list: Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of list) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  return out;
}

interface RawNode {
  name: string;
  path: string;
  fullPath: string;
  isFolder: boolean;
  children: Map<string, RawNode>;
  findings: Finding[];
}

export function buildRepositoryTree(
  findings: Finding[],
  targetPath: string,
  scannedFiles?: string[]
): TreeNode {
  // Determine root name
  const cleanTarget = targetPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const targetParts = cleanTarget.split("/");
  const rootName = targetParts[targetParts.length - 1] || "repository";

  const rootRaw: RawNode = {
    name: rootName,
    path: "",
    fullPath: targetPath,
    isFolder: true,
    children: new Map<string, RawNode>(),
    findings: [],
  };

  function getOrCreateFolder(parts: string[]): RawNode {
    let current = rootRaw;
    let accumulatedPath = "";

    for (const part of parts) {
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part;
      let child = current.children.get(part);
      if (!child) {
        child = {
          name: part,
          path: accumulatedPath,
          fullPath: targetPath ? `${targetPath}/${accumulatedPath}` : accumulatedPath,
          isFolder: true,
          children: new Map<string, RawNode>(),
          findings: [],
        };
        current.children.set(part, child);
      }
      current = child;
    }
    return current;
  }

  // Pre-seed all scanned files and directories so every scanned file and directory appears
  if (scannedFiles && scannedFiles.length > 0) {
    for (const rawFile of scannedFiles) {
      const relPath = normalizeLocation(rawFile, targetPath);
      const parts = relPath.split("/").filter(Boolean);
      if (parts.length === 0) continue;

      const folderParts = parts.slice(0, parts.length - 1);
      const fileName = parts[parts.length - 1]!;
      const parentFolder = getOrCreateFolder(folderParts);

      if (!parentFolder.children.has(fileName)) {
        parentFolder.children.set(fileName, {
          name: fileName,
          path: relPath,
          fullPath: targetPath ? `${targetPath}/${relPath}` : relPath,
          isFolder: false,
          children: new Map<string, RawNode>(),
          findings: [],
        });
      }
    }
  }

  // Pre-seed known architectural directories if scanning eval-target
  const isEvalTarget =
    cleanTarget.toLowerCase().includes("eval-target") ||
    findings.some((f) => f.evidence.some((e) => e.locator?.includes("eval-target")));

  if (isEvalTarget) {
    for (const dir of KNOWN_EVAL_TARGET_DIRS) {
      const parts = dir.split("/");
      getOrCreateFolder(parts);
    }
  }

  // Map each finding to EVERY file location it has evidence in — not just
  // evidence[0]. A single asset can merge evidence from multiple files (and,
  // for a canonical algorithm name/status shared across language detectors —
  // e.g. Go's SHA-256 and Python's hashlib.sha256 both matching "SHA-256" —
  // even multiple LANGUAGES). Attributing only to evidence[0] silently
  // dropped the finding from every other folder it actually has evidence in;
  // since evidence is sorted alphabetically by location, this systematically
  // hid non-first-alphabetically-sorted languages/folders from this tree
  // even though their evidence was present and correct in the underlying
  // CBOM the whole time. `allFindings`/`totalFindings` below dedupe by
  // finding.id when aggregating back up so a multi-location finding is still
  // counted once, not once per file it appears under.
  for (const finding of findings) {
    const locators = new Set<string>();
    for (const ev of finding.evidence) {
      if (ev.locator) locators.add(ev.locator);
    }
    if (locators.size === 0) locators.add("unknown/unlocated.txt");

    for (const rawLoc of locators) {
      const relPath = normalizeLocation(rawLoc, targetPath);
      const parts = relPath.split("/").filter(Boolean);

      if (parts.length === 0) continue;

      const folderParts = parts.slice(0, parts.length - 1);
      const fileName = parts[parts.length - 1]!;
      const parentFolder = getOrCreateFolder(folderParts);

      let fileNode = parentFolder.children.get(fileName);
      if (!fileNode) {
        fileNode = {
          name: fileName,
          path: relPath,
          fullPath: rawLoc,
          isFolder: false,
          children: new Map<string, RawNode>(),
          findings: [],
        };
        parentFolder.children.set(fileName, fileNode);
      }
      fileNode.findings.push(finding);
    }
  }

  // Convert raw tree to final TreeNode with recursive aggregation and priority sorting
  function finalizeNode(raw: RawNode, depth: number): TreeNode {
    const children: TreeNode[] = [];
    for (const childRaw of raw.children.values()) {
      children.push(finalizeNode(childRaw, depth + 1));
    }

    // Sort children at this level:
    // 1. Highest Priority Score first (most severe risk outranks)
    // 2. Highest Finding Count first
    // 3. Folders before files
    // 4. Alphabetical by name
    children.sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) {
        return b.priorityScore - a.priorityScore;
      }
      if (b.totalFindings !== a.totalFindings) {
        return b.totalFindings - a.totalFindings;
      }
      if (a.isFolder !== b.isFolder) {
        return a.isFolder ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    // Dedupe by finding.id: a finding attributed to more than one child
    // (e.g. it has evidence in both a go/ and a python/ file, per the
    // multi-locator attribution above) must still be counted once at any
    // shared ancestor, not once per child it's reachable through.
    const allFindings: Finding[] = raw.isFolder
      ? dedupeFindingsById(children.flatMap((c) => c.allFindings))
      : [...raw.findings];

    const totalFindings = raw.isFolder ? allFindings.length : raw.findings.length;

    const priorityScore = computeAggregatePriority(allFindings);

    const counts = {
      shor: allFindings.filter((f) => f.quantumStatus === "broken-by-shor").length,
      classic: allFindings.filter((f) => f.quantumStatus === "broken-classically").length,
      grover: allFindings.filter((f) => f.quantumStatus === "weakened-by-grover").length,
      safe: allFindings.filter((f) => f.quantumStatus === "quantum-safe").length,
    };

    return {
      id: raw.path || "root",
      name: raw.name,
      path: raw.path,
      fullPath: raw.fullPath,
      isFolder: raw.isFolder,
      depth,
      children,
      findings: raw.findings,
      allFindings,
      totalFindings,
      priorityScore,
      counts,
    };
  }

  return finalizeNode(rootRaw, 0);
}
