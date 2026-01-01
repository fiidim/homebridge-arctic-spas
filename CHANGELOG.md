# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [1.1.0] - 2026-01-01

### Updated
- Changed Pumps to Fan v2, since Pump1 can be variable speed
    - Pump1 supports OFF, LOW, HIGH, which equate to 0, 50, 100.  HomeKit will snap to each of those values
- Moved from Axios to Native Fetch
- Fixed defaults to match a basic custom Spa
- Added verification banner

## [1.0.3] - 2026-01-01

### Updated
- Changes required for Homebridge Verification

## [1.0.1] - 2025-12-12

### Added
- Initial Release for NPM
