# Issue 1144: Apply rate limiting to demand/supply routes

Add writeRateLimiter to demand and supply write endpoints:

```typescript
import { writeRateLimiter } from '../middleware/rateLimiter';

// Apply to POST /demand (create demand)
router.post('/demand',
  writeRateLimiter,  // ADD THIS
  validateDemand,
  demandController.createDemand
);

// Apply to POST /supply (create supply)
router.post('/supply',
  writeRateLimiter,  // ADD THIS
  validateSupply,
  supplyController.createSupply
);

// Apply to PUT endpoints
router.put('/demand/:id',
  writeRateLimiter,  // ADD THIS
  validateDemand,
  demandController.updateDemand
);

router.put('/supply/:id',
  writeRateLimiter,  // ADD THIS
  validateSupply,
  supplyController.updateSupply
);
```
