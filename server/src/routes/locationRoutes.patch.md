# Issue 1144: Apply rate limiting to location routes

Add writeRateLimiter to location write endpoints:

```typescript
import { writeRateLimiter } from '../middleware/rateLimiter';

// Apply to POST /locations (create)
router.post('/',
  writeRateLimiter,  // ADD THIS
  validateLocation,
  locationController.createLocation
);

// Apply to PUT /locations/:id (update)
router.put('/:id',
  writeRateLimiter,  // ADD THIS
  validateLocation,
  locationController.updateLocation
);

// Apply to DELETE /locations/:id
router.delete('/:id',
  writeRateLimiter,  // ADD THIS
  locationController.deleteLocation
);
```
