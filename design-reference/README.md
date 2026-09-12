# Purrenade Design Reference

This directory contains approved and supporting visual references for Purrenade.

## Source of Truth

### 1. Written Product/Game Specification

The written Product/Game Specification is authoritative for all product behavior.

It defines:

- gameplay rules
- scoring
- difficulty
- progression
- collectibles
- character unlocks
- SLAYYY behavior
- Loli Bonus behavior
- authentication
- authorization
- persistence
- API behavior
- anti-cheat
- localization
- tutorial behavior
- audio
- accessibility
- responsive behavior
- security
- observability
- testing
- acceptance criteria

If any visual reference conflicts with the written specification, the written specification wins for behavior.

### 2. Claude Design v0.3

Location:

`./claude-design/v0.3`

This is the primary approved UX/UI and brand reference.

Use it for:

- screen structure
- approved navigation
- visual hierarchy
- layout
- responsive behavior
- Purrenade brand identity
- gameplay presentation
- character presentation
- Loli presentation
- auth presentation
- support/settings screens

If v0.3 conflicts visually with earlier approved designs, v0.3 wins.

### 3. Claude Design v0.2.1

Historical visual decisions from v0.2.1 are represented inside the v0.3 reference material.

Use them only where v0.3 explicitly preserves those decisions.

### 4. ChatGPT Art Direction Board

Location:

`./chatgpt-art-direction`

This is an aspirational art-direction reference only.

Use it to understand:

- seaside atmosphere
- production-art quality target
- environmental richness
- color relationships
- character scale
- menu composition
- gameplay composition
- SLAYYY transformation mood
- Loli companion placement
- logo and brand direction

Do not:

- treat it as a literal pixel-perfect implementation target
- crop production sprites from it
- extract final production artwork from it
- reproduce AI artifacts literally
- infer unsupported gameplay mechanics from it

Production assets must be supplied separately.

## Private Source References

Local-only private character/source photographs may be stored under:

`./private-source`

This directory is intentionally excluded from Git.

Private source photographs must never be:

- committed
- published
- copied into public documentation
- exposed in application bundles
- used as downloadable production assets

They exist only as local visual reference material for approved character artwork.

## Conflict Rules

1. Written Product/Game Specification wins for behavior.
2. Claude Design v0.3 wins for approved UX/UI and visual decisions.
3. Approved production assets win over illustrative mockups.
4. ChatGPT Art Direction is aspirational, not literal.
5. Private source photographs are reference-only and must remain local.
6. If a conflict cannot be resolved using these rules, stop and report it instead of inventing a decision.
