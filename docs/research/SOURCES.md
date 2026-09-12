# UI Research and Provenance

Nolane Social uses external products and open-source repositories as **mechanism references**, not as a source of copied branding/trade dress. The implementation was authored for Nolane Social from scratch and then evaluated against Nolane UI Intelligence.

## Bluesky Social

Repository: `bluesky-social/social-app`
License reviewed: MIT (`LICENSE`, copyright 2023–2026 Bluesky Social PBC)
Files inspected during research:

- `src/view/com/home/HomeHeader.tsx`
- `src/view/com/home/HomeHeaderLayout.tsx`
- `src/view/com/home/HomeHeaderLayout.web.tsx`
- `src/view/com/home/HomeHeaderLayoutMobile.tsx`
- `src/view/com/util/MainScrollProvider.tsx`

Mechanisms studied:

- separate compact/desktop shell behavior;
- sticky feed/header treatment;
- centered reading surface independent from larger viewport width;
- route/navigation controls adapting across breakpoints.

No Bluesky logo, icons, copy, color system, component source, or recognizable visual composition is shipped in Nolane Social.

Source: https://github.com/bluesky-social/social-app

## Elk

Repository: `elk-zone/elk`
License reviewed: MIT
Files inspected during research:

- `app/components/nav/NavSide.vue`
- related bottom-navigation buttons/components discovered from the repository search.

Mechanisms studied:

- persistent social navigation destinations;
- compact navigation that remains reachable on small screens;
- explicit Explore/Search separation;
- responsive reduction of desktop chrome.

No Elk code, icons, branding, or visual styling is copied into the product.

Source: https://github.com/elk-zone/elk

## Mastodon

Repository: `mastodon/mastodon`
License reviewed: GNU AGPLv3
Files found during mechanism research:

- `app/javascript/mastodon/features/ui/components/columns_area/index.tsx`
- `app/javascript/mastodon/features/navigation_panel/index.tsx`
- `app/javascript/styles/mastodon/components.scss`

Because the project is AGPL and Nolane Social is not adapting Mastodon source, research was kept at **idea/mechanism level only**: multi-region social shell, navigation panel, and a bounded main reading region. No Mastodon code was copied or translated.

Source: https://github.com/mastodon/mastodon

## X / Twitter

X.com is a user-specified **quality benchmark** for maturity of hierarchy, interaction feedback, content density, and responsive social reading. No X source code, assets, branding, logo, proprietary icons, screenshots, exact layout measurements, or copied trade dress are included.

The Nolane-specific signature is documented in `docs/ui/NUI-DESIGN-PACKET.md`.

## Nolane UI Intelligence

The user supplied the Nolane UI Intelligence repository as the governing design/verification system for this project. Relevant guidance used included high visual ambition, global navigation shells, threaded conversations, visual critique, runtime UI verification, visual regression evidence, high-contrast/low-vision behavior, reduced motion, and non-hover affordances.

It functions as an internal design authority; shipped product UI remains authored specifically for Nolane Social.

## Protocol/platform references

Deployment and protocol implementation were checked against current primary documentation during the 2026-09-12 build:

- Cloudflare D1 Wrangler commands: https://developers.cloudflare.com/d1/wrangler-commands/
- Cloudflare D1 migrations: https://developers.cloudflare.com/d1/reference/migrations/
- Cloudflare MCP server security: https://developers.cloudflare.com/agents/model-context-protocol/guides/securing-mcp-server/
- Cloudflare remote MCP guidance: https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/
- OpenAI custom MCP/developer mode help: https://help.openai.com/en/articles/12584461

Platform UI/availability can change; repository documentation intentionally describes ChatGPT as one compatible client rather than a hard dependency.
