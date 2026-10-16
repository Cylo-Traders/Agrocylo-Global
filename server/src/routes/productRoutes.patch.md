# Issue 1144: Apply rate limiting to product routes

Add writeRateLimiter to product write endpoints:

```typescript
import { writeRateLimiter } from '../middleware/rateLimiter';

// Apply to POST /products (create)
router.post('/', 
  writeRateLimiter,  // ADD THIS
  validateProductInput,
  productController.createProduct
);

// Apply to PUT /products/:id (update)
router.put('/:id',
  writeRateLimiter,  // ADD THIS
  validateProductInput,
  productController.updateProduct
);

// Apply to DELETE /products/:id
router.delete('/:id',
  writeRateLimiter,  // ADD THIS
  productController.deleteProduct
);
```

This prevents spam listing creation and abuse.
Returns 429 with Retry-After header when limit exceeded.
