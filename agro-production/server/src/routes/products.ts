import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { jsonValidated, validateParams, validateResponse } from '../middleware/validate.js';
import { problemDetail } from '../middleware/errors.js';

const router = Router();

const ProductCategoryEnum = z.enum([
  'GRAINS',
  'VEGETABLES',
  'FRUITS',
  'LIVESTOCK',
  'DAIRY',
  'OTHER',
]);

const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: ProductCategoryEnum,
  pricePerUnit: z.string(),
  unit: z.string(),
  quantity: z.number(),
  location: z.string(),
  farmerAddress: z.string(),
  campaignId: z.string().optional(),
  imageUrl: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ProductListResponseSchema = z.object({
  data: z.array(ProductSchema),
  meta: z.object({
    total: z.number(),
    page: z.number(),
    limit: z.number(),
  }),
});

const ProductIdParamSchema = z.object({
  id: z.string(),
});

const inMemoryProducts = [
  {
    id: 'prod-001',
    name: 'Premium Maize',
    description: 'High-quality maize seeds for optimal yield',
    category: 'GRAINS' as const,
    pricePerUnit: '500000',
    unit: 'bag',
    quantity: 100,
    location: 'Umuahia, Abia State',
    farmerAddress: 'GBRPFJUCMVXQFMQN7WAWGHNBOGX64YIQVZ5AOOOCFZ4Y5O3A2FG4AQQ',
    imageUrl: 'https://via.placeholder.com/300x200?text=Maize',
    createdAt: new Date('2024-01-15').toISOString(),
    updatedAt: new Date('2024-06-01').toISOString(),
  },
  {
    id: 'prod-002',
    name: 'Organic Tomatoes',
    description: 'Fresh organic tomatoes from local farms',
    category: 'VEGETABLES' as const,
    pricePerUnit: '200000',
    unit: 'crate',
    quantity: 50,
    location: 'Ibadan, Oyo State',
    farmerAddress: 'GBRPFJUCMVXQFMQN7WAWGHNBOGX64YIQVZ5AOOOCFZ4Y5O3A2FG4AQQ',
    imageUrl: 'https://via.placeholder.com/300x200?text=Tomatoes',
    createdAt: new Date('2024-02-10').toISOString(),
    updatedAt: new Date('2024-06-05').toISOString(),
  },
  {
    id: 'prod-003',
    name: 'Fresh Strawberries',
    description: 'Sweet and ripe strawberries',
    category: 'FRUITS' as const,
    pricePerUnit: '800000',
    unit: 'kg',
    quantity: 25,
    location: 'Jos, Plateau State',
    farmerAddress: 'GBRPFJUCMVXQFMQN7WAWGHNBOGX64YIQVZ5AOOOCFZ4Y5O3A2FG4AQQ',
    imageUrl: 'https://via.placeholder.com/300x200?text=Strawberries',
    createdAt: new Date('2024-03-20').toISOString(),
    updatedAt: new Date('2024-06-10').toISOString(),
  },
  {
    id: 'prod-004',
    name: 'Free-Range Chicken',
    description: 'Healthy free-range chicken products',
    category: 'LIVESTOCK' as const,
    pricePerUnit: '5000000',
    unit: 'bird',
    quantity: 30,
    location: 'Enugu, Enugu State',
    farmerAddress: 'GBRPFJUCMVXQFMQN7WAWGHNBOGX64YIQVZ5AOOOCFZ4Y5O3A2FG4AQQ',
    imageUrl: 'https://via.placeholder.com/300x200?text=Chicken',
    createdAt: new Date('2024-04-05').toISOString(),
    updatedAt: new Date('2024-06-08').toISOString(),
  },
  {
    id: 'prod-005',
    name: 'Fresh Milk',
    description: 'Pure fresh milk from grass-fed cows',
    category: 'DAIRY' as const,
    pricePerUnit: '300000',
    unit: 'liter',
    quantity: 200,
    location: 'Kaduna, Kaduna State',
    farmerAddress: 'GBRPFJUCMVXQFMQN7WAWGHNBOGX64YIQVZ5AOOOCFZ4Y5O3A2FG4AQQ',
    imageUrl: 'https://via.placeholder.com/300x200?text=Milk',
    createdAt: new Date('2024-05-12').toISOString(),
    updatedAt: new Date('2024-06-12').toISOString(),
  },
];

router.get(
  '/products',
  validateResponse(ProductListResponseSchema),
  async (_req: Request, res: Response) => {
    const total = inMemoryProducts.length;
    jsonValidated(res, ProductListResponseSchema, 200, {
      data: inMemoryProducts,
      meta: { total, page: 1, limit: 50 },
    });
  },
);

router.get(
  '/products/:id',
  validateParams(ProductIdParamSchema),
  validateResponse(ProductSchema),
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const product = inMemoryProducts.find((p) => p.id === id);

    if (!product) {
      problemDetail(res, req, 404, 'Product Not Found', `No product with id ${id}`);
      return;
    }

    jsonValidated(res, ProductSchema, 200, product);
  },
);

export default router;
