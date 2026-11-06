# Code signing policy

## Status

The project plans to apply for code signing through [SignPath Foundation](https://signpath.org/). Approval and integration are pending. The v1.0.0 and v1.0.1 setup executables do not have an Authenticode code signature. This document does not claim that the project has been accepted or that any release is signed by SignPath.

If accepted, the intended provider credit is: Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

## Proposed roles and release process

- Committer and maintainer: [@Ptcr8](https://github.com/Ptcr8).
- Reviewer of contributions from non-committers: [@Ptcr8](https://github.com/Ptcr8).
- Proposed signing approver: [@Ptcr8](https://github.com/Ptcr8).

If the project is accepted and signing is configured, the approver will manually approve each release signing request after reviewing its source and build. The existing build process is described in [Releasing.md](docs/Releasing.md). Roles and process may be adjusted to meet the provider requirements before signed releases are published.

## Privacy and network access

The application supports configurable checks for new versions through public GitHub Releases. Updates selected by the user are downloaded from the release service. Displaying a remote image or opening an external link can also cause network access. Setup itself does not download the runtime. See [README: updates and uninstall](README.md#更新とアンインストール) for the current behavior.

The installer includes Microsoft WebView2 Fixed Version Runtime; its own terms describe data collection and Microsoft services. See the [bundled WebView2 license](licenses/WebView2-Fixed-Runtime.txt) and [Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement).
