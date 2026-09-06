import type { Finding } from "./cbom/types";

export interface PqcRecommendation {
  originalName: string;
  recommendedAlgorithm: string;
  standard: string;
  vulnerabilityReason: string;
  replacementCode: string;
  deltaReference: {
    keySizeDelta: string;
    outputSizeDelta: string;
    latencyEst: string;
  };
  migrationNote: string;
}

/**
 * Returns proposed PQC or hybrid replacement guidance for a given finding.
 * Standard names strictly use official NIST terminology (FIPS 203 ML-KEM,
 * FIPS 204 ML-DSA, FIPS 205 SLH-DSA).
 *
 * All size and performance figures are explicitly documented as reference
 * numbers, not measured on this host system.
 */
export function getRecommendationForFinding(
  finding: Finding,
  sourceLineText?: string,
): PqcRecommendation {
  const name = (finding.name ?? "").toUpperCase();
  const primitive = (finding.primitive ?? "").toLowerCase();
  const rawLine = sourceLineText !== undefined ? sourceLineText : `// Detected: ${finding.name}`;

  // 1. Hash Algorithms (MD5, SHA-1, SHA-256, SHA3-256, SHA-384, SHA-512, etc.)
  if (
    name.includes("SHA") ||
    name.includes("MD5") ||
    name.includes("MD4") ||
    name.includes("MD2") ||
    name.includes("RIPEMD") ||
    name.includes("WHIRLPOOL") ||
    name.includes("BLAKE") ||
    primitive === "hash"
  ) {
    // Hashes that already meet maximum CNSA 2.0 / NIST post-quantum standard (>= 384-bit)
    const isAlreadyMaxPqc =
      name.includes("SHA-384") ||
      name.includes("SHA384") ||
      name.includes("SHA-512") ||
      name.includes("SHA512") ||
      name.includes("SHA3-384") ||
      name.includes("SHA3_384") ||
      name.includes("SHA3-512") ||
      name.includes("SHA3_512") ||
      name.includes("SHAKE256");

    if (isAlreadyMaxPqc) {
      return {
        originalName: finding.name,
        recommendedAlgorithm: finding.name,
        standard: "FIPS 180-4 (Secure Hash Standard) / FIPS 202 (SHA-3)",
        vulnerabilityReason:
          "Meets CNSA 2.0 post-quantum hash requirements (>= 384-bit state provides >= 192-bit collision resistance against Grover search).",
        replacementCode: rawLine,
        deltaReference: {
          keySizeDelta: "Digest: Meets CNSA 2.0 requirements",
          outputSizeDelta: "Standard digest buffer",
          latencyEst: "Ref delta: Hardware-accelerated on target CPU",
        },
        migrationNote:
          "Algorithm is fully compliant with CNSA 2.0 post-quantum hash standards. No migration required.",
      };
    }

    // SHA-3 family 256-bit hash (SHA3-256)
    if (name.includes("SHA3-256") || name.includes("SHA3_256")) {
      return {
        originalName: finding.name,
        recommendedAlgorithm: "SHA3-384",
        standard: "FIPS 202 (SHA-3 Standard) / CNSA 2.0",
        vulnerabilityReason:
          "Weakened by Grover's algorithm — 256-bit hash provides 128-bit collision resistance under quantum search. CNSA 2.0 mandates 384-bit hashes for post-quantum resistance.",
        replacementCode: generateReplacementCode(rawLine, "SHA3-384", "hash", finding.name),
        deltaReference: {
          keySizeDelta: "Digest: 256 bits → 384 bits (48 B)",
          outputSizeDelta: "Digest buffer: 32 B → 48 B (+16 B)",
          latencyEst: "Ref delta: Negligible overhead on modern 64-bit CPUs",
        },
        migrationNote:
          "Upgrades hash output from 256 bits to 384 bits, restoring full 192-bit quantum security margin under Grover search per CNSA 2.0.",
      };
    }

    // SHA-2 family 256-bit hash (SHA-256, SHA256)
    if (name.includes("SHA-256") || name.includes("SHA256")) {
      return {
        originalName: finding.name,
        recommendedAlgorithm: "SHA-384",
        standard: "FIPS 180-4 (Secure Hash Standard) / CNSA 2.0",
        vulnerabilityReason:
          "Weakened by Grover's algorithm — 256-bit hash provides 128-bit collision resistance under quantum search. CNSA 2.0 mandates SHA-384 or SHA-512 for post-quantum resistance.",
        replacementCode: generateReplacementCode(rawLine, "SHA-384", "hash", finding.name),
        deltaReference: {
          keySizeDelta: "Digest: 256 bits → 384 bits (48 B)",
          outputSizeDelta: "Digest buffer: 32 B → 48 B (+16 B)",
          latencyEst: "Ref delta: Negligible overhead on modern 64-bit CPUs",
        },
        migrationNote:
          "Upgrades hash output from 256 bits to 384 bits, restoring full 192-bit quantum security margin under Grover search per CNSA 2.0.",
      };
    }

    // Classically broken hashes (SHA-1, MD5, MD4, MD2, RIPEMD, SHA-224, etc.)
    return {
      originalName: finding.name,
      recommendedAlgorithm: "SHA-384",
      standard: "FIPS 180-4 (Secure Hash Standard) / CNSA 2.0",
      vulnerabilityReason:
        name.includes("SHA1") || name.includes("SHA-1") || name.includes("SHA_1") || name.includes("MD5")
          ? "Broken classically — practical collision attacks exist today. Quantum Grover further weakens pre-image security."
          : "CNSA 2.0 post-quantum suite requires SHA-384 or SHA-512 for quantum-safe collision resistance.",
      replacementCode: generateReplacementCode(rawLine, "SHA-384", "hash", finding.name),
      deltaReference: {
        keySizeDelta: "Digest: 128/160 bits → 384 bits (48 B)",
        outputSizeDelta: "Digest buffer: 16/20 B → 48 B (+28 B)",
        latencyEst: "Ref delta: Negligible overhead on modern 64-bit CPUs",
      },
      migrationNote:
        "Update database hash storage columns (e.g. VARCHAR(32/40) → VARCHAR(96)). Verify integrity checksum length expectations.",
    };
  }

  // 2. Classical Digital Signatures (ECDSA, DSA, RSA, Ed25519, Ed448, SECP, etc.)
  if (
    name.includes("ECDSA") ||
    name.includes("DSA") ||
    name.includes("SECP256") ||
    name.includes("SECP384") ||
    name.includes("SECP521") ||
    name.includes("ED25519") ||
    name.includes("ED448") ||
    name.includes("PRIME256") ||
    (name.includes("RSA") && !name.includes("OAEP") && primitive !== "kem") ||
    name.includes("PSS") ||
    name.includes("PKCS1") ||
    primitive === "signature"
  ) {
    return {
      originalName: finding.name,
      recommendedAlgorithm: "ML-DSA-65",
      standard: "FIPS 204 (Module-Lattice-Based Digital Signature Standard)",
      vulnerabilityReason:
        "Broken by Shor's algorithm — discrete logarithm / integer factorization solvable in polynomial time, enabling full private key recovery.",
      replacementCode: generateReplacementCode(rawLine, "ML-DSA-65", "signature", finding.name),
      deltaReference: {
        keySizeDelta: "Public key: ~64–256 B → 1,952 B (+1,696–1,888 B)",
        outputSizeDelta: "Signature: ~64–256 B → 3,309 B (+3,053–3,245 B)",
        latencyEst: "Ref delta: ~1.2x verify, ~0.8x sign vs classical primitives",
      },
      migrationNote:
        "Signatures and public keys are substantially larger than classical EC/RSA points (~3.3 KB). Verify database column widths, API schemas, and buffer sizes — see Migration view for blast radius on this file.",
    };
  }

  // 3. Classical Key Exchange / Key Encapsulation (DH, ECDH, X25519, X448, ElGamal, RSA-OAEP)
  if (
    name.includes("RSA-OAEP") ||
    (name.includes("RSA") && primitive === "kem") ||
    name.includes("ECDH") ||
    name.includes("DIFFIE-HELLMAN") ||
    name.includes("DH") ||
    name.includes("X25519") ||
    name.includes("X448") ||
    name.includes("ELGAMAL") ||
    primitive === "kem" ||
    primitive === "key-agreement"
  ) {
    return {
      originalName: finding.name,
      recommendedAlgorithm: "ML-KEM-768",
      standard: "FIPS 203 (Module-Lattice-Based Key-Encapsulation Mechanism)",
      vulnerabilityReason:
        "Broken by Shor's algorithm — integer factorization and Diffie-Hellman discrete logarithm solvable in polynomial time, compromising public-key encapsulation.",
      replacementCode: generateReplacementCode(rawLine, "ML-KEM-768", "kem", finding.name),
      deltaReference: {
        keySizeDelta: "Public key: ~32–256 B → 1,184 B (+928–1,152 B)",
        outputSizeDelta: "Ciphertext: ~32–256 B → 1,088 B (+832–1,056 B)",
        latencyEst: "Ref delta: ~15x faster encapsulation than RSA-2048, ~1.1x vs ECDH",
      },
      migrationNote:
        "Ciphertext and encapsulation keys require >1 KB buffers. Switch from interactive DH to KEM (encapsulate/decapsulate) pattern — inspect Blast Radius view for fixed-size buffer allocations.",
    };
  }

  // 4. Classically Broken Ciphers (ARC4, RC4, RC2, CAST, IDEA, 3DES, DES, Blowfish)
  if (
    name.includes("ARC4") ||
    name.includes("RC4") ||
    name.includes("ARCFOUR") ||
    name.includes("RC2") ||
    name.includes("CAST") ||
    name.includes("IDEA") ||
    name.includes("3DES") ||
    name.includes("DES") ||
    name.includes("BLOWFISH") ||
    name.includes("SEED")
  ) {
    return {
      originalName: finding.name,
      recommendedAlgorithm: "AES-256-GCM",
      standard: "NIST SP 800-38D (Authenticated Encryption with Associated Data)",
      vulnerabilityReason:
        "Broken classically by differential / linear cryptanalysis, and effective search space reduced by Grover's algorithm.",
      replacementCode: generateReplacementCode(rawLine, "AES-256-GCM", "cipher", finding.name),
      deltaReference: {
        keySizeDelta: "Key: 56–128 bits → 256 bits (32 B)",
        outputSizeDelta: "Tag: 0 B → 16 B (128-bit authentication tag)",
        latencyEst: "Ref delta: Hardware AES-NI accelerated",
      },
      migrationNote:
        "Migrate to AEAD mode. Ensure 96-bit unique IV/nonce per operation and 256-bit cryptographic entropy in key generation.",
    };
  }

  // 5. Symmetric Ciphers (AES, SM4, ChaCha)
  if (name.includes("AES") || name.includes("SM4") || name.includes("CHACHA")) {
    return {
      originalName: finding.name,
      recommendedAlgorithm: "AES-256-GCM",
      standard: "NIST SP 800-38D (AES with 256-bit Key Length)",
      vulnerabilityReason:
        "Weakened by Grover's algorithm — quantum search halves effective security level (128-bit key drops to 64-bit security).",
      replacementCode: generateReplacementCode(rawLine, "AES-256-GCM", "cipher", finding.name),
      deltaReference: {
        keySizeDelta: "Key: 128 bits → 256 bits (+16 B)",
        outputSizeDelta: "Same block/tag overhead",
        latencyEst: "Ref delta: <5% cycle difference with AES-NI",
      },
      migrationNote:
        "Upgrade key derivation and pre-shared keys to 256-bit key length to preserve 128-bit security margin under Grover's algorithm.",
    };
  }

  // Fallback for quantum-safe or other primitives
  if (finding.quantumStatus === "quantum-safe") {
    return {
      originalName: finding.name,
      recommendedAlgorithm: finding.name,
      standard: "NIST Post-Quantum Cryptography Standard",
      vulnerabilityReason:
        "Quantum-safe algorithm — verified against hard mathematical lattice/hash problems.",
      replacementCode: rawLine,
      deltaReference: {
        keySizeDelta: "Meets NIST PQC standard",
        outputSizeDelta: "See NIST FIPS specifications",
        latencyEst: "Hardware profiled",
      },
      migrationNote:
        "No migration required. Algorithm already meets NIST post-quantum security requirements.",
    };
  }

  return {
    originalName: finding.name,
    recommendedAlgorithm: "ML-DSA-65 / ML-KEM-768",
    standard: "NIST Post-Quantum Cryptography Standards (FIPS 203 / 204)",
    vulnerabilityReason: "Evaluate post-quantum migration to NIST standardized algorithms.",
    replacementCode: generateReplacementCode(rawLine, "ML-DSA-65", "other", finding.name),
    deltaReference: {
      keySizeDelta: "Evaluate PQC parameter set",
      outputSizeDelta: "See NIST FIPS specifications",
      latencyEst: "Profile on target hardware",
    },
    migrationNote:
      "Review algorithm parameters and consult Migration view for overall system timeline and scheduling.",
  };
}

function generateReplacementCode(
  originalLine: string,
  pqcAlgo: string,
  kind: "signature" | "kem" | "cipher" | "hash" | "other",
  findingName?: string,
): string {
  const indentMatch = originalLine.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : "";
  const trimmed = originalLine.trim();

  // If empty or placeholder
  if (!trimmed || trimmed.startsWith("// Detected:")) {
    return `${indent}// Proposed FIPS replacement:\n${indent}${pqcAlgo}`;
  }

  // 1. Hash algorithm replacements (SHA3-256 -> SHA3-384, SHA-256/SHA-1/MD5 -> SHA-384)
  if (kind === "hash") {
    let replaced = originalLine;
    let modified = false;

    // Python pyca SHA3 hashes: hashes.SHA3_256, hashes.SHA3_224
    if (/hashes\.(?:SHA3_256|SHA3_224)\b/.test(replaced)) {
      replaced = replaced.replace(/hashes\.(?:SHA3_256|SHA3_224)\b/g, "hashes.SHA3_384");
      modified = true;
    }
    // pycryptodome SHA3
    if (/SHA3_256\./.test(replaced)) {
      replaced = replaced.replace(/SHA3_256\./g, "SHA3_384.");
      modified = true;
    }
    // C / OpenSSL EVP sha3
    if (/EVP_sha3_256\(\)/.test(replaced)) {
      replaced = replaced.replace(/EVP_sha3_256\(\)/g, "EVP_sha3_384()");
      modified = true;
    }
    // Quoted literals / map keys for SHA3
    if (/(['"])(?:SHA3-?256|sha3-?256|SHA3_256)\1/i.test(replaced)) {
      replaced = replaced.replace(/(['"])(?:SHA3-?256|sha3-?256|SHA3_256)\1/gi, '$1SHA3-384$1');
      modified = true;
    }

    // Python pyca hashes: hashes.SHA256, hashes.SHA1, hashes.MD5, hashes.SHA224
    if (/hashes\.(?:SHA256|SHA1|MD5|SHA224)\b/.test(replaced)) {
      replaced = replaced.replace(/hashes\.(?:SHA256|SHA1|MD5|SHA224)\b/g, "hashes.SHA384");
      modified = true;
    }
    // Python hashlib: hashlib.sha256, hashlib.sha1, hashlib.md5, hashlib.sha224
    if (/hashlib\.(?:sha256|sha1|md5|sha224)\b/.test(replaced)) {
      replaced = replaced.replace(/hashlib\.(?:sha256|sha1|md5|sha224)\b/g, "hashlib.sha384");
      modified = true;
    }
    if (/hashlib\.new\(\s*(['"])(?:sha-?256|sha-?1|md5|sha-?224)\1/i.test(replaced)) {
      replaced = replaced.replace(/hashlib\.new\(\s*(['"])(?:sha-?256|sha-?1|md5|sha-?224)\1/gi, "hashlib.new($1sha384$1");
      modified = true;
    }
    // C / OpenSSL EVP
    if (/EVP_(?:sha256|sha1|md5|sha224)\(\)/.test(replaced)) {
      replaced = replaced.replace(/EVP_(?:sha256|sha1|md5|sha224)\(\)/g, "EVP_sha384()");
      modified = true;
    }
    if (/(?:SHA256|SHA1|MD5)_Init\(/.test(replaced)) {
      replaced = replaced.replace(/(?:SHA256|SHA1|MD5)_Init\(/g, "SHA384_Init(");
      modified = true;
    }
    // Java MessageDigest
    if (/MessageDigest\.getInstance\(\s*(['"])(?:SHA-?256|SHA-?1|MD5|SHA-?224)\1\s*\)/i.test(replaced)) {
      replaced = replaced.replace(
        /MessageDigest\.getInstance\(\s*(['"])(?:SHA-?256|SHA-?1|MD5|SHA-?224)\1\s*\)/gi,
        'MessageDigest.getInstance("SHA-384")',
      );
      modified = true;
    }
    // Quoted literals / map keys / enum values (e.g. "SHA-1": hashes.SHA1, "SHA-256": hashes.SHA256)
    if (/(['"])(?:SHA-?256|sha-?256|SHA256|SHA-?1|sha-?1|MD5|md5|SHA_?1)\1/i.test(replaced)) {
      replaced = replaced.replace(/(['"])(?:SHA-?256|sha-?256|SHA256|SHA-?1|sha-?1|MD5|md5|SHA_?1)\1/gi, '$1SHA-384$1');
      modified = true;
    }

    if (modified) {
      return replaced;
    }

    // Fallback if finding name appears in line
    if (findingName && replaced.toUpperCase().includes(findingName.toUpperCase())) {
      const reg = new RegExp(findingName.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "gi");
      return replaced.replace(reg, pqcAlgo);
    }

    return `${indent}// Proposed ${pqcAlgo} Replacement:\n${indent}${trimmed.replace(/SHA3?[-_]?256|SHA-?1|MD5/gi, pqcAlgo)}`;
  }

  // 2. Digital Signatures (ML-DSA-65)
  if (kind === "signature") {
    // Python pyca key generation
    if (
      trimmed.includes("rsa.generate_private_key") ||
      trimmed.includes("ec.generate_private_key") ||
      trimmed.includes("dsa.generate_private_key") ||
      trimmed.includes("Ed25519PrivateKey.generate")
    ) {
      return `${indent}# Proposed FIPS 204 ML-DSA-65 Replacement:\n${indent}from cryptography.hazmat.primitives.asymmetric import mldsa\n${indent}private_key = mldsa.generate_private_key(mldsa.MLDSA65)`;
    }

    if (trimmed.includes("padding.PSS") || trimmed.includes("padding.PKCS1v15")) {
      return `${indent}# ML-DSA-65 uses native lattice signing (no RSA padding required):\n${indent}signature = private_key.sign(data)`;
    }

    let replaced = originalLine;
    let modified = false;

    // Java
    if (/KeyPairGenerator\.getInstance\(\s*(['"])(?:RSA|EC|DSA|Ed25519)\1\s*\)/i.test(replaced)) {
      replaced = replaced.replace(
        /KeyPairGenerator\.getInstance\(\s*(['"])(?:RSA|EC|DSA|Ed25519)\1\s*\)/gi,
        'KeyPairGenerator.getInstance("ML-DSA-65")',
      );
      modified = true;
    }
    if (/Signature\.getInstance\(\s*(['"])[^'"]+\1\s*\)/i.test(replaced)) {
      replaced = replaced.replace(
        /Signature\.getInstance\(\s*(['"])[^'"]+\1\s*\)/gi,
        'Signature.getInstance("ML-DSA-65")',
      );
      modified = true;
    }

    // C / OpenSSL
    if (/(?:EVP_PKEY_RSA|EVP_PKEY_EC|EVP_PKEY_DSA|RSA_generate_key_ex)\b/.test(replaced)) {
      return `${indent}/* Proposed FIPS 204 ML-DSA-65 Replacement */\n${indent}EVP_PKEY *pkey = EVP_PKEY_Q_keygen(libctx, NULL, "ML-DSA-65");`;
    }

    // Quoted strings: "RSA", "ECDSA", "DSA", "Ed25519", "SECP256k1"
    if (/(['"])(?:RSA|ECDSA|DSA|Ed25519|Ed448|SECP256[KR]1)\1/i.test(replaced)) {
      replaced = replaced.replace(/(['"])(?:RSA|ECDSA|DSA|Ed25519|Ed448|SECP256[KR]1)\1/gi, '$1ML-DSA-65$1');
      modified = true;
    }

    if (modified) {
      return replaced;
    }

    if (findingName && replaced.toUpperCase().includes(findingName.toUpperCase())) {
      const reg = new RegExp(findingName.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "gi");
      return replaced.replace(reg, "ML-DSA-65");
    }

    return `${indent}# Proposed FIPS 204 ML-DSA-65 Replacement:\n${indent}# Migrate: ${trimmed}\n${indent}# to NIST ML-DSA-65`;
  }

  // 3. Key Exchange / Key Encapsulation (ML-KEM-768)
  if (kind === "kem") {
    // Python pyca
    if (
      trimmed.includes("x25519.X25519PrivateKey.generate") ||
      trimmed.includes("x448.X448PrivateKey.generate") ||
      trimmed.includes("dh.generate_parameters")
    ) {
      return `${indent}# Proposed FIPS 203 ML-KEM-768 Replacement:\n${indent}from cryptography.hazmat.primitives.asymmetric import mlkem\n${indent}private_key = mlkem.generate_private_key(mlkem.MLKEM768)`;
    }
    if (trimmed.includes("ec.ECDH()") || trimmed.includes("exchange(")) {
      return `${indent}# FIPS 203 ML-KEM-768 Encapsulation / Decapsulation:\n${indent}ciphertext, shared_key = public_key.encapsulate()`;
    }

    let replaced = originalLine;
    let modified = false;

    // Java
    if (/KeyAgreement\.getInstance\(\s*(['"])(?:ECDH|DH|DiffieHellman)\1\s*\)/i.test(replaced)) {
      replaced = replaced.replace(
        /KeyAgreement\.getInstance\(\s*(['"])(?:ECDH|DH|DiffieHellman)\1\s*\)/gi,
        'KEM.getInstance("ML-KEM-768")',
      );
      modified = true;
    }

    // C / OpenSSL
    if (/(?:EVP_PKEY_X25519|EVP_PKEY_DH|EVP_PKEY_ECDH)\b/.test(replaced)) {
      return `${indent}/* Proposed FIPS 203 ML-KEM-768 Replacement */\n${indent}EVP_PKEY *pkey = EVP_PKEY_Q_keygen(libctx, NULL, "ML-KEM-768");`;
    }

    // Quoted literals
    if (/(['"])(?:X25519|X448|ECDH|DH|Diffie-?Hellman|RSA-OAEP)\1/i.test(replaced)) {
      replaced = replaced.replace(/(['"])(?:X25519|X448|ECDH|DH|Diffie-?Hellman|RSA-OAEP)\1/gi, '$1ML-KEM-768$1');
      modified = true;
    }

    if (modified) {
      return replaced;
    }

    if (findingName && replaced.toUpperCase().includes(findingName.toUpperCase())) {
      const reg = new RegExp(findingName.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "gi");
      return replaced.replace(reg, "ML-KEM-768");
    }

    return `${indent}# Proposed FIPS 203 ML-KEM-768 Replacement:\n${indent}# Migrate: ${trimmed}\n${indent}# to NIST ML-KEM-768`;
  }

  // 4. Symmetric Ciphers (AES-256-GCM)
  if (kind === "cipher") {
    // Python pyca ARC4 / 3DES / Blowfish
    if (
      trimmed.includes("algorithms.ARC4") ||
      trimmed.includes("algorithms.TripleDES") ||
      trimmed.includes("algorithms.Blowfish") ||
      trimmed.includes("algorithms.IDEA")
    ) {
      return `${indent}# Proposed AES-256-GCM AEAD Replacement:\n${indent}from cryptography.hazmat.primitives.ciphers.aead import AESGCM\n${indent}aesgcm = AESGCM(key_256)\n${indent}ciphertext = aesgcm.encrypt(nonce_96, data, associated_data)`;
    }

    if (trimmed.includes("Cipher(") || trimmed.includes("algorithms.")) {
      return `${indent}# Proposed AES-256-GCM Replacement:\n${indent}cipher = ciphers.Cipher(algorithms.AES(key_256), modes.GCM(nonce_96))`;
    }

    let replaced = originalLine;
    let modified = false;

    // Java
    if (/Cipher\.getInstance\(\s*(['"])(?:DES|DESede|RC4|ARCFOUR|AES\/CBC)[^'"]*\1\s*\)/i.test(replaced)) {
      replaced = replaced.replace(
        /Cipher\.getInstance\(\s*(['"])(?:DES|DESede|RC4|ARCFOUR|AES\/CBC)[^'"]*\1\s*\)/gi,
        'Cipher.getInstance("AES/GCM/NoPadding")',
      );
      modified = true;
    }

    // C / OpenSSL
    if (/EVP_(?:rc4|des_ede3_cbc|des_cbc|aes_128_cbc)\(\)/.test(replaced)) {
      replaced = replaced.replace(/EVP_(?:rc4|des_ede3_cbc|des_cbc|aes_128_cbc)\(\)/g, "EVP_aes_256_gcm()");
      modified = true;
    }

    // Quoted literals
    if (/(['"])(?:ARC4|RC4|ARCFOUR|3DES|TripleDES|DES|Blowfish|AES-128)\1/i.test(replaced)) {
      replaced = replaced.replace(/([''])(?:ARC4|RC4|ARCFOUR|3DES|TripleDES|DES|Blowfish|AES-128)\1/gi, '$1AES-256-GCM$1');
      modified = true;
    }

    if (modified) {
      return replaced;
    }

    if (findingName && replaced.toUpperCase().includes(findingName.toUpperCase())) {
      const reg = new RegExp(findingName.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "gi");
      return replaced.replace(reg, "AES-256-GCM");
    }

    return `${indent}# Proposed AES-256-GCM Replacement (NIST SP 800-38D):\n${indent}# Migrate: ${trimmed}\n${indent}# to AES-256-GCM`;
  }

  // 5. Generic fallback for other primitives
  if (findingName && originalLine.toUpperCase().includes(findingName.toUpperCase())) {
    const reg = new RegExp(findingName.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "gi");
    return originalLine.replace(reg, pqcAlgo);
  }

  return `${indent}// Proposed NIST ${pqcAlgo} Replacement:\n${indent}// Target: ${pqcAlgo}\n${indent}// Line:   ${trimmed}`;
}

