# Hash Patch UI

[![Build](https://img.shields.io/badge/build-vite%20passing-brightgreen?style=flat-square)](https://vitejs.dev/)
[![Tests](https://img.shields.io/badge/tests-vitest%20passing-brightgreen?style=flat-square)](https://vitest.dev/)
[![Linter](https://img.shields.io/badge/linter-oxlint%20passed-brightgreen?style=flat-square)](https://oxc-project.github.io/)
[![UI Style](https://img.shields.io/badge/theme-forensic%20terminal-blueviolet?style=flat-square)](https://github.com/shriram-s7/hash_patch-ui)

The modern, forensic-terminal user interface for **Hash Patch** — an offline post-quantum cryptographic discovery and risk analysis platform.

Built with **React 19**, **TypeScript**, **Vite**, and **Tailwind CSS**, designed to run both as a fast web application and as an embedded GUI inside the **Hash Patch Desktop** Electron application.

---

## 📥 Desktop Downloads

Download the pre-bundled desktop application with the offline scanning engine:

- 🪟 [**Windows Installer (HashPatch-Setup.exe)**](https://github.com/shriram-s7/hash_patch/releases/download/v0.1.0/HashPatch-Setup.exe)
- 💼 [**Windows Standalone Portable (HashPatch-Portable.exe)**](https://github.com/shriram-s7/hash_patch/releases/download/v0.1.0/HashPatch-Portable.exe)
- 📦 [**All Releases & Changelog**](https://github.com/shriram-s7/hash_patch/releases/latest)

---

## 🌟 Key UI Capabilities

- **Unified Home & Workspace**:
  - Direct path input supporting absolute and relative repository paths.
  - One-click access to quick demo scan targets, scan history, and guided onboarding.
- **Findings Inspector & Unique View**:
  - **All Findings Mode**: Detailed per-finding reachability, call chains, algorithm specs, and code context.
  - **Unique Findings Mode**: Grouping by cryptographic primitive (e.g. SHA-1, RSA, AES) with change counts, aggregated occurrences, and quick category filtering.
- **Blast Radius & Topology Graph**:
  - Interactive SVG dependency and call graph visualization showing cryptographic risk propagation from entry points to sinks.
  - Search filter bar, dynamic zoom controls, interactive minimap, and legend.
- **PQC Migration Planner & Optimizer**:
  - Visual burn-down charts, NIST-standardized replacements (ML-KEM, ML-DSA, SLH-DSA), and step-by-step code patch snippets.
- **Discrete Multi-Page PDF Report Generation**:
  - Generates executive and technical audit-ready PDF reports with deterministic A4 discrete paging and high-resolution vector rendering.
- **Offline AI Assistant ("Ask")**:
  - Natural language Q&A against the discovered CBOM and code context using local Ollama integration.

---

## 🛠️ Development & Local Run

### Prerequisites
- Node.js 20+
- npm

### Installation
```bash
# Clone the repository
git clone https://github.com/shriram-s7/hash_patch-ui.git
cd hash_patch-ui

# Install dependencies
npm install

# Start Vite development server
npm run dev
```

### Running Tests & Quality Checks
```bash
# Run Vitest unit tests
npm run test

# Run Oxlint static analysis
npx oxlint
```

### Building for Production
```bash
# Compile and build production assets into /dist
npm run build
```

---

## 📄 License
This project is licensed under the Apache 2.0 / MIT License.
