# ADR-004: SQLite Storage with better-sqlite3

## Status
Proposed

## Date
2026-01-20

## Context

The Context-First model (ADR-003) requires persistent storage with:
- Many-to-many relationships (ObservationContext join)
- Cross-recording queries (TopicBlockRepository.findByContext)
- Type-safe data access
- Local-first, offline operation
- Future vector similarity search

JSON files become awkward for relational queries. A proper database is needed.

## Decision

Use **SQLite** with the following stack:

| Component | Choice | Purpose |
|-----------|--------|---------|
| **Driver** | better-sqlite3 | Synchronous, fast, local-first |
| **Types** | kysely-codegen | Generate TypeScript from schema |
| **Migrations** | Custom runner | Simple SQL files, can load extensions |
| **IDs** | UUIDv7 | Time-sortable, unique |
| **Vectors** | BLOB (initially) | sqlite-vector later if needed |

### Database Location

```
~/.escribano/escribano.db
```

### Schema Overview

```sql
-- Core tables
CREATE TABLE recordings (...);
CREATE TABLE observations (...);
CREATE TABLE contexts (...);
CREATE TABLE topic_blocks (...);
CREATE TABLE artifacts (...);

-- Join table
CREATE TABLE observation_contexts (
  observation_id TEXT NOT NULL,
  context_id TEXT NOT NULL,
  PRIMARY KEY (observation_id, context_id)
);

-- Migration tracking
CREATE TABLE _schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Migration Approach

1. SQL files in `migrations/` directory at the project root: `001_initial.sql`, `002_*.sql`, etc.
2. Custom runner in `src/db/migrate.ts`
3. Runner can load SQLite extensions (future sqlite-vector support)
4. No rollback support (fix forward)

### Type Generation

```bash
pnpm db:generate  # Run kysely-codegen after schema changes
```

### Why Not Other Options

| Option | Rejected Because |
|--------|------------------|
| Prisma | ORM, too heavy, async, black-box query generation |
| Drizzle | ORM-adjacent, complex tooling (Drizzle Kit), async |
| Kysely (full) | Async wrapper overhead over better-sqlite3 |
| Turso/libSQL | Cloud-focused, overkill for local-only app |
| JSON files | Poor for relational queries, manual indexing needed |

## Consequences

### Positive
- Type-safe queries via generated types
- Proper relational queries (JOINs, indexes)
- Future sqlite-vector support possible
- Synchronous API matches local-first model
- Single file, easy backup

### Negative
- New dependency (better-sqlite3)
- Must run type generation after schema changes
- Custom migration runner to maintain

## References
- better-sqlite3: https://github.com/WiseLibs/better-sqlite3
- kysely-codegen: https://github.com/RobinBlomberg/kysely-codegen
- uuidv7: https://www.npmjs.com/package/uuidv7
