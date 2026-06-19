# Changelog

All notable changes to this project are documented here. Format mirrors content-pipeline
(semantic-release-style): each release lists Features / Bug Fixes with PR links.

## [0.1.0] — unreleased

### Features

* **scaffold:** public-repo bootstrap — gitignore-first (agent-scratch + private board snapshot), CI (ubuntu+windows matrix, Node 20, typecheck + jest + Conventional-Commits gate + privacy gate), changelog. The live board surfaces local `~/.claude` task + 3-role-ledger state; local files are the source of truth, the web view is a synced, login-gated mirror.
