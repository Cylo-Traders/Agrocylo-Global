# Issue 1141: Remove raw SQL from groupOrderService

Replace line 261 advisory lock with Prisma optimistic locking:

```typescript
// BEFORE (raw SQL - security risk):
await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${lockId})`);

// AFTER (Prisma-based concurrency):
// Use version field for optimistic locking
const groupOrder = await tx.groupOrder.update({
  where: { 
    id: groupOrderId,
    version: currentVersion // Optimistic lock
  },
  data: {
    status: 'pooling',
    version: { increment: 1 }
  }
});

if (!groupOrder) {
  throw new Error('Concurrent modification detected');
}
```

Add version field to schema.prisma:
```prisma
model GroupOrder {
  id      Int @id @default(autoincrement())
  version Int @default(0)
  // ... other fields
}
```

This satisfies security guardrails while preserving concurrency safety.
