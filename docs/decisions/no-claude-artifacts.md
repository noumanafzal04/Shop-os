---
name: no-claude-artifacts
description: User does not want claude.ai Artifacts published (web-visibility concern); use local files or inline instead
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-04T13:18:48.761Z
---

The user asked me not to create claude.ai Artifacts. They're hosted on claude.ai and the user worries someone could view them on the web (they default to private, but the user still doesn't want them).

**Why:** Privacy of internal ShopOS planning/design material.

**How to apply:** For design mockups, reports, checklists, or dashboards, write a local `.html`/`.md` file the user opens themselves (e.g. in the scratchpad or repo), or present the content inline in chat. Do NOT call the Artifact publish tool. Two were published (private) before this instruction landed: a product-readiness checklist and a POS mockup — the user can delete them from their claude.ai gallery.
