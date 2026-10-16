# Third-Party Notices

JobChat includes third-party software and media. This file covers components
that are vendored into the source tree or otherwise require a project-level
attribution. Third-party components remain under their own licenses; the
JobChat Apache-2.0 license does not replace those terms.

## Web Artifacts Builder

- **Component:** `web-artifacts-builder` (distributed here as `artifacts-builder`)
- **Upstream:** https://github.com/anthropics/skills/tree/master/skills/web-artifacts-builder
- **Copyright:** Copyright 2026 Anthropic, PBC.
- **License:** Apache License 2.0
- **Used at:** `jchat/server/skills/artifacts-builder/`
- **License text:** `jchat/server/skills/artifacts-builder/LICENSE.txt`
- **Modifications:** renamed and adapted for JobChat; demo and showcase
  applications are not redistributed. See the component `NOTICE.md`.

## Nuwa Skill / Persona Distillation

- **Component:** `huashu-nuwa` / `persona-distillation`
- **Upstream:** https://github.com/alchaincyf/nuwa-skill
- **Upstream commit:** `ea4b9abfe0e60e5051ed946c70e51434402d3545`
- **Copyright:** Copyright (c) alchaincyf
- **License:** MIT
- **Used at:** `jchat/server/skills/persona-distillation/`
- **License text and derivation notice:**
  `jchat/server/skills/persona-distillation/LICENSE-NOTICE.md`

## shadcn/ui

- **Upstream:** https://github.com/shadcn-ui/ui
- **Copyright:** Copyright (c) 2023 shadcn
- **License:** MIT
- **License text:** `licenses/MIT-shadcn.txt`
- **Used at:**
  - `landing/src/components/ui/`
  - `meeting/src/components/ui/`
  - `jchat/server/skills/artifacts-builder/scripts/shadcn-components.tar.gz`

The components may have been adapted for JobChat. Their copyright and MIT
permission notice are retained regardless of those adaptations.

## Tailwind CSS

- **Upstream:** https://github.com/tailwindlabs/tailwindcss
- **Copyright:** Copyright (c) Tailwind Labs, Inc.
- **License:** MIT
- **License text:** `licenses/MIT-tailwind.txt`
- **Used at:** npm dependencies and generated utility CSS, including the
  license banner in `landing/src/index.css`.

## Unsplash photographs

The landing page references remote photographs from Unsplash under the
[Unsplash License](https://unsplash.com/license). The original Figma Make
attribution is retained in `landing/src/Attributions.md`.

Source image identifiers used at release time:

- `photo-1438761681033-6461ffad8d80`
- `photo-1472099645785-5658abf4ff4e`
- `photo-1487412720507-e7ab37603c6f`
- `photo-1489424731084-a5d8b219a5bb`
- `photo-1494790108377-be9c29b29330`
- `photo-1500648767791-00dcc994a43e`
- `photo-1506794778202-cad84cf45f1d`
- `photo-1507003211169-0a1dd7228f2d`
- `photo-1519085360753-af0119f7cbe7`
- `photo-1531482615713-2afd69097998`
- `photo-1534528741775-53994a69daeb`
- `photo-1552664730-d307ca884978`
- `photo-1557804506-669a67965ba0`
- `photo-1573496359142-b8d87734a5a2`

The corresponding canonical image URLs are recorded in
`landing/src/components/BlogSection.tsx`, `TeamSection.tsx`, and
`TestimonialsSection.tsx`. Unsplash does not require attribution under its
standard license; retaining these source identifiers is intended to make the
asset inventory auditable.

## Figma Make

The initial landing-page source was exported from a Figma Make project:
https://www.figma.com/design/XmoQZ7osQqmZ99xUGhGCnT/Redesign-Website-with-Style-Guide

The export's shadcn/ui and Unsplash attribution is preserved in
`landing/src/Attributions.md`.

## Claude Agent SDK — proprietary runtime dependency

- **Packages:** `@anthropic-ai/claude-agent-sdk` and its platform packages
- **Copyright:** © Anthropic PBC. All rights reserved.
- **License:** Proprietary; **not an open-source license**
- **License notice:** `licenses/ANTHROPIC-CLAUDE-AGENT-SDK.md`
- **Terms:** https://code.claude.com/docs/en/legal-and-compliance

The SDK and bundled Claude Code binary are obtained from npm during dependency
installation rather than vendored into the JobChat source repository. The
binary must remain unmodified. Self-hosters and distributors are responsible
for the applicable Anthropic commercial terms, authentication, billing, and
restrictions on reselling or intermediating Claude usage. See
`docs/RUNTIME_TERMS.md` for deployment obligations.

## npm dependencies

Dependencies installed by npm remain under their respective licenses. Exact
versions are locked in the repository's `package-lock.json` files. The direct
manifests are located at:

- `package.json`
- `jchat/package.json`
- `meeting/package.json`
- `landing/package.json`
- `jchat/server/skills/gemini-chat/scripts/package.json`
- `jchat/server/skills/gemini-deep-research/scripts/package.json`

Development-only dependencies are not necessarily included in a production
distribution. Release checks evaluate the complete lockfile dependency tree
so that copyleft or unknown licenses can be reviewed before distribution.

## Brand assets

The JobChat name and logo are project brand assets. No trademark rights or
rights to imply endorsement are granted by the software license. Product
screenshots in `docs/assets/` were supplied by the project maintainer and
sanitized for publication.
