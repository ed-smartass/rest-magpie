# Claude Design brief — rest-magpie landing artifact

This is the brief to paste into Claude Design (claude.ai → Design tab) to generate the marketing landing artifact that the README links to.

**Why Claude Design and not a static HTML in the repo?** Claude Design produces hosted, shareable artifacts that anyone can view (no Claude account needed for the viewer). It iterates faster than hand-written HTML and gives us a polished page without maintaining a separate site. Once published, we paste the share link into the README under the banner.

**Workflow:**
1. Open claude.ai → Design tab.
2. (Optional but powerful) Point Claude Design at this GitHub repo so it can extract the design system from `docs/images/` and the README palette automatically.
3. Paste the prompt below.
4. Iterate visually until happy.
5. Publish the artifact (Anthropic gives a public share URL).
6. Send me the URL — I'll add it to the README and open PR-0c.

## What the page must do (one job)

Convince an agent-tooling developer that they should install rest-magpie *right now* by showing them, in under 10 seconds of scrolling:
1. The pain they live with (raw JSON blowing up context windows + per-curl permission churn).
2. That rest-magpie removes both pains with one MCP install.
3. How to install it for their specific client.

If a visitor leaves without copying an install snippet, the page failed.

## Prompt to paste into Claude Design

```
Build a single-page marketing landing for "rest-magpie", an MCP server that wraps arbitrary REST API calls so AI agents see a compact schema first instead of dumping raw responses into their context window.

VISUAL STYLE
- Palette: deep midnight navy (#0a1828) on the left/dark side, transitioning through teal (#1a4a5e), ending in warm parchment cream (#f5e8d0) on the right/light side. Subtle gradients throughout. Accent: warm gold (#d4a84b) for highlights and CTA buttons.
- Typography: clean modern sans-serif (Inter / Geist Sans / similar). Monospace for code (JetBrains Mono / Geist Mono). Generous line-height. Tight character spacing on headlines.
- Aesthetic: developer-tool brand visuals. Reference: bun.sh, Vercel marketing pages, Linear app brand site. Premium, minimal, slightly playful.
- A stylized magpie illustration (flat-vector, hand-drawn feel) appears in the hero and as a small mascot at section transitions. The magpie has black-and-white plumage with iridescent dark-blue tail feathers and trails small gold geometric "shiny bits" — gems, sparkles, abstract bracket-shaped glyphs hinting at JSON.

PAGE STRUCTURE (top to bottom)

1. HERO (first viewport)
   - Background: full-bleed wide ribbon banner (use docs/images/banner.png from the repo if accessible, or recreate the visual: magpie in upper-left flying forward, trail of shiny bits scattering through the canvas, navy-to-cream gradient).
   - Headline (huge, white-on-navy): "REST that picks only the shiny bits."
   - Sub-hook (regular weight, two lines): "Your agent burned 12K tokens on a 200KB JSON to read one field. With rest-magpie, the same field costs ~200 tokens."
   - Primary CTA button (gold): "Install for Claude Desktop" — scrolls to install section.
   - Secondary CTA: "View on GitHub" — links to https://github.com/ed-smartass/rest-magpie

2. THE PAIN (split section, two columns)
   - Left column (titled "Without rest-magpie", red/warning accent):
     - Animated counter ticking up: "200,847 bytes"
     - Below: "12,400 tokens consumed. Context window: 80% full after one call."
     - Small visual: an agent's context bar filling up with garbage data
   - Right column (titled "And every curl prompt", same red accent):
     - Animated screenshot of a Claude Code permission dialog: "Allow Bash(curl https://api...)? [Always] [Once] [Deny]"
     - Caption: "You clicked Always last call. The next call has a different URL. Here's the dialog again."
   - Tagline below both columns (centered, muted): "Two pains. Same root cause: HTTP for agents was never designed for agents."

3. THE FIX (full-width section, gold accent)
   - Headline: "One MCP server. Both pains gone."
   - Three-step illustrated flow (horizontal, with arrows between):
     a. fetch — agent calls http_request
     b. schema — server returns compact structure (paths/shape/sample/json_schema), body cached
     c. jq mask — agent calls http_read with a mask, gets only the field it asked for
   - Below the flow, side-by-side numeric comparison card:
     |                  | Without | With rest-magpie |
     |------------------|--------:|-----------------:|
     | Tokens to context|  12,400 |              200 |
     | Permission prompts (50 calls) |    50  |               1 |
     | Latency overhead |    0 ms |          ~10 ms |
   - One-line below the table: "Authorize the MCP server once at config time. Done."

4. SCHEMA FORMATS SHOWCASE (carousel or tabs)
   - Four tabs: paths (default) / shape / sample / json_schema
   - Each tab shows the same hypothetical /users response rendered in that format. Use the rendering examples from the rest-magpie README as content reference.
   - Caption per tab: when this format is the right pick (e.g. "paths — when you want a flat field listing with types").

5. INSTALL (THE MOST IMPORTANT SECTION)
   - Headline: "Use it in your client"
   - Tabs (one per MCP client):
     - Claude Desktop
     - Claude Code
     - VS Code (.vscode/mcp.json)
     - Cursor
     - Cline
     - Windsurf
   - Each tab: a single copy-pasteable JSON config block + a "Copy" button. Use the npx invocation from the README ("npx -y rest-magpie") for all of them — adapt only the surrounding config schema per client.
   - Below the tabs: a small Docker section with the same-path bind-mount + MAGPIE_FILES_ROOT pattern.
   - Sub-tagline (gold): "After this, no per-call permission prompts. Ever. The MCP server is authorized once."

6. FOOTER
   - Three columns:
     - Left: rest-magpie logo + tagline + license (MIT) + GitHub stars badge.
     - Middle: links — Spec, CHANGELOG, Issues, Contributing.
     - Right: "Built by [GitHub]@ed-smartass" + Twitter/X handle if applicable.
   - Bottom strip: "v0.1.1 · npm · Docker (GHCR)"

INTERACTION
- Smooth scroll between sections.
- Schema-format tabs animate the content change.
- Install-section tabs preserve which client is selected if the user clicks something else.
- Copy buttons give visible feedback on click.
- The numeric counters in the Pain section start animating only when scrolled into view (intersection observer).
- Mobile-responsive: stacks columns vertically, tabs become a horizontal scroller.

CONTENT NOTES
- Don't invent features that aren't in the README.
- Don't oversell "zero permissions ever" — the precise framing is "authorize the MCP server once, no per-call prompts after that."
- The 12K-tokens-vs-200 comparison is illustrative; phrase it as a typical scenario, not a benchmarked claim.
- The 1 permission prompt for 50 calls is exact (one MCP authorization at config time covers all subsequent tool calls).

DON'T
- Don't add testimonials we don't have yet.
- Don't add fake screenshots of named companies using rest-magpie.
- Don't add a pricing section — it's free and MIT.
- Don't autoplay any video.
```

## After Claude Design publishes the artifact

Send me the share URL. I'll then:
1. Take a 1280×720 screenshot of the hero for thumbnail.
2. Replace the ASCII-flow block in README with: an embedded thumbnail linked to the artifact URL.
3. Open PR-0c with both files (thumbnail in `docs/images/demo-thumbnail.png` + README diff).
4. Drop the existing `fetch → cache → schema → jq mask → field value` ASCII chain (per the earlier decision — once a real demo lands, the ASCII becomes redundant).

## Iteration tips

- If Claude Design produces something too marketing-y, ask for "more dev-tool, less consumer-product."
- If the install section gets buried, prompt "make the install section the visual centerpiece — that's the conversion goal."
- If the magpie illustration looks off, point at `docs/images/banner.png` from this repo as the reference style.
