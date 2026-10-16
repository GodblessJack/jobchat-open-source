# JobChat application

The main JobChat React client, Node.js server, database schema, local authentication, isolated model runtime, and tests.

## Common commands

```bash
npm ci
npm run precheck       # Validate required provider configuration
npm run bootstrap      # Migrate PostgreSQL, create the local user, seed contacts
npm run dev            # Start the complete development stack from the repository root
npm run typecheck
npm test
npm run lint
npm run build
npm start              # Run the compiled server after npm run build
```

See the repository root README for the complete setup. Configuration is documented in `../docs/CONFIGURATION.md`, and migration details are in `sql/README.md`.

## Test policy

The default suite uses deterministic test-only values and mock infrastructure. The hosted SDK pipeline test runs only when explicitly enabled with `RUN_SDK_INTEGRATION=1` and valid provider credentials.
