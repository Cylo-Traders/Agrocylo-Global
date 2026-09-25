import { prisma } from '../src/db/client.js';

const products = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Premium Maize',
    description: 'High-quality maize seeds for optimal yield',
    priceTokens: 500000n,
    inventoryCount: 100,
    category: 'GRAINS',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Organic Tomatoes',
    description: 'Fresh organic tomatoes from local farms',
    priceTokens: 200000n,
    inventoryCount: 50,
    category: 'VEGETABLES',
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Fresh Strawberries',
    description: 'Sweet and ripe strawberries',
    priceTokens: 800000n,
    inventoryCount: 25,
    category: 'FRUITS',
  },
];

await prisma.product.deleteMany({ where: { id: { in: products.map((product) => product.id) } } });
await prisma.product.createMany({ data: products });
await prisma.$disconnect();
