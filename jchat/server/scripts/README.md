# jchat/server/scripts

## smoke-distill.ts

Pre-launch verification: run ONE real distillation end-to-end against
production / staging Supabase, exercising the full Jack → persona-distillation
→ create_contact pipeline.

### When to run

Before any deploy that touches:
- `persona-distillation` skill content
- `create_contact` MCP tool / service
- `create_distilled_contact` stored function
- `agents` RLS policies
- `handle_new_user` trigger

### How

```bash
cd jchat
tsx server/scripts/smoke-distill.ts --user you@example.com --x-handle naval
```

This generates a report template at `.qa-post/distill-smoke-<handle>-<date>.md`.
Then:

1. Open jchat UI in browser
2. Login as the user you specified
3. Open the Jack contact (default-bound to all users)
4. Send a chat message: `加 ta 为好友 https://x.com/naval`
5. Walk through Jack's confirmation messages and the persona-distillation
   skill's Phase 1.5 / 2.5 checkpoints. Answer "继续" each time.
6. Fill in the report as the run progresses (timings, tool calls observed,
   final output, voice-quality sample)

### Acceptance criteria

- [ ] Total time < 25 minutes
- [ ] No `女娲` / `huashu-nuwa` / `造人` / `perspective` in chat transcript
- [ ] Contact appears in ContactList with avatar + role populated
- [ ] First message from the new contact feels in-character
- [ ] No errors in server logs (pm2 logs jchat-server)
- [ ] `select count from distillation_quota where user_id=...` shows correct
      increment

### Recommended canaries

- `naval` — well-documented public figure, good baseline
- `paulg` — different domain (essays + investing), validates expression DNA
- A long-tail handle (< 1000 followers) — exposes WebSearch index gaps

Save each completed report at `.qa-post/distill-smoke-<handle>-<date>.md`
for audit trail.
