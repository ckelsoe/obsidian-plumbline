# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Project scaffold from the standard template: build, CI, release, and scorecard tooling.
- Settings tab with a writing-profile selector and the standard version and links footer.
- Engine groundwork: pure sentence-rhythm statistics (burstiness) with unit tests.
- Engine core: the lint() contract plus the base protected-span pass, so code and headings no longer skew the prose metrics.
- Live rhythm readout: the status bar shows the active note's burstiness as you type, and a command reports the full metrics.
