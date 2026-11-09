# Releasing MD-CSV Split Editor

The app reads anonymous public GitHub Releases. The release repository is `Ptcr8-tool/md-csv_split_viewer`. Publish only complete, verified releases. If releases are inaccessible, show a short nonmodal toast and keep editing available. Do not embed credentials or require login.


Every published stable version has one complete Windows x64 Setup.exe, SHA256SUMS.txt and a Sigstore attestation bundle named `MD-Split-VERSION-Setup.exe.sigstore.json`. Users do not need to download the bundle manually.

Versions through v1.0.2 cannot verify GitHub provenance. Since the matching private RSA key was not available for those releases, upgrading them to v1.0.3 requires one manual installation. Do not bypass verification to bridge this transition. Authenticode is separate: an attestation protects the in-app update path but does not establish a Windows publisher or remove SmartScreen warnings.

Builds and CI use Node.js 24 or later. `@codemirror/language-data` is intentionally pinned at 6.5.2 for repeatable language support; when upgrading it, update the lockfile and recheck syntax highlighting and editor UI tests.

CI audits production npm dependencies, checks the actual production web bundle in Chromium, and caches only the original WebView2 CAB using a key derived from `installer/runtime.json`. Before extraction, the packager verifies the CAB's pinned byte count and SHA-256 even after a cache hit. Dependabot proposes npm, NuGet, and GitHub Actions updates; review each change and its effects before merging. The offline end-user setup does not use those services.

Keep the bundled Microsoft fixed-runtime license in sync with the official download page and review changes before enabling silent upgrades to a runtime with different terms. The initial interactive setup displays the complete terms and retains them offline under Licenses.

1. Update `package.json`, the lockfile root versions, `native/MdSplit.csproj`, `BuildIdentity.Version`, the installer default and the runtime pin if needed. Run `npm run check:version` and provide `docs/releases/vVERSION.md`.
2. Review and merge the versioned source to `main`. Create a new lightweight `vVERSION` tag pointing to that reviewed commit; never overwrite an existing tag. Run `.github/workflows/windows-release.yml` for the tag. The workflow rejects a version, source, or repository mismatch.
3. The Windows build verifies the pinned GitHub CLI archive, retrieves Sigstore roots through the CLI's TUF validation, embeds their hashes in the app, builds the offline installer and runs the checks. GitHub Actions attests the tested setup in a separate job, and native tests verify the actual bundle, wrong-tag and tampering rejection, and the updater's download-and-verification path before publication.
4. The release job creates a draft, verifies asset hashes, sizes and tag, and only then publishes. Do not replace files on an existing published release. Keep incomplete releases unpublished and investigate failures.
5. Verify the public assets and test an actual installed older version checking, confirming, downloading, preparing documents, installing and reopening. Update the README download table only after verifying the published release. For the v1.0.3 bridge, test a manual upgrade from v1.0.2; old clients cannot verify its new proof.

The installer build does not need a long-lived signing key. Local builds are not automatically trusted as updates; only the configured GitHub-hosted release workflow on the exact release tag can produce accepted provenance. If Authenticode is added later, it must be applied before computing checksums and attesting the setup.

Every release refreshes its bundled TUF-validated trust roots. Monitor upcoming Sigstore and GitHub trust-root changes and ship updated roots before installed versions lose the ability to verify new attestations; otherwise a manual upgrade may again be needed.

The `checks.yml` workflow validates source and creates a build artifact. It does not publish a release or receive signing keys. The earlier one-time v1.0.2 workflow remains historical and does not provide the new provenance bundle. The bundled GitHub CLI license and its third-party license listing are included in `update-verifier`.

## Offline runtime pin

`installer/runtime.json` contains the official Microsoft fixed-runtime CAB URL, version, size and SHA-256. `scripts/package-installer.py` checks the CAB, extracts it and bundles the runtime. Set `MDSPLIT_RUNTIME` to an already verified extracted runtime for repeat builds. The end-user setup never downloads a runtime.

To compare installer compression, first run the normal Windows publish and packaging steps so `release/MD-Split` contains the complete payload, including its verified runtime. Then run `python scripts/compare-installer-compression.py --makensis "C:\Program Files (x86)\NSIS\makensis.exe" --runs 3` on Windows. It compiles the same payload with solid zlib and solid lzma, reports each size and elapsed build time, and deletes the temporary installers. It does not install, publish, sign, or download anything. Compare extraction time and memory on actual Windows machines separately before changing the default; this optional benchmark does not run in routine CI.

Do not commit `release/`, signing keys, credentials, machine data, `Data/`, native build outputs or dependencies. The checked-in public verification key is safe to publish. Historical ZIP versions 0.1–0.2 precede the single-exe release format; do not invent download assets for them.


