# 3290 executor close — feed fail-loud half (agent-kanban)

DISPATCH-NONCE:OR-NONCE-d6defc3cf46ff51f

Executor-close: PR https://github.com/ziylam3999/agent-kanban/pull/94 (draft) — made board-live-push.mjs abort before the first upsert, state hash unwritten, with a named focus-join-failed stderr line whenever focus-progress returned focuses but the inner status-tables run gave no focus scalars (fail / empty foci / timeout), added the sandboxed fail-loud smoke (npm run test:board-live-push-failloud: must-fire red at pristine origin/master, green at head; healthy fixture byte-identical to base), and verified parity, size and jest suites green.
