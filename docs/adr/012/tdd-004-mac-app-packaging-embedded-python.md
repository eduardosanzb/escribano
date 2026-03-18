# TDD-004: Mac App Packaging & Embedded Python

## 1. Overview
This document specifies how the Escribano Swift binary is packaged into a standard macOS `.app` bundle, how a standalone Python interpreter is embedded within it to support `mlx-vlm`, and how the final `.dmg` is code-signed.

## 2. `.app` Bundle Structure
The macOS application will follow this directory structure:
```text
Escribano.app/
  Contents/
    MacOS/
      escribano (Swift executable)
    Resources/
      python_env/ (Standalone Python environment)
        bin/python3
        lib/python3.X/site-packages/ (mlx, mlx-vlm, etc.)
    Info.plist
```

## 3. Embedded Python Strategy
- **Source**: We will use a pre-compiled standalone Python distribution (e.g., [indygreg/python-build-standalone](https://github.com/indygreg/python-build-standalone)).
- **Installation**: During CI, the standalone environment is downloaded, and dependencies are installed directly into it using `pip`.
- **Execution**: The Swift application will launch MLX scripts via `Process()` pointing explicitly to `Bundle.main.resourceURL.appendingPathComponent("python_env/bin/python3")`.

## 4. Code Signing and Notarization
To pass macOS Gatekeeper for non-technical users:
1. Both the inner Python binaries and the outer Swift executable must be signed with an Apple Developer ID Application certificate.
2. The final `.dmg` must be submitted to Apple's Notary Service via `xcrun notarytool`.
3. The notarization ticket is stapled to the `.dmg` before distribution via GitHub Releases.
