import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/database.js', () => ({
  prisma: { location: { upsert: vi.fn(), update: vi.fn(), findMany: vi.fn() } },
}));

const { prisma } = await import('../config/database.js');
const { setLocation, updateLocation, getFarmerLocations } = await import('./locationService.js');

const bad = expect.objectContaining({ status: 400 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.location.findMany).mockResolvedValue([]);
});

describe('location validation (#1136)', () => {
  it.each([{ lat: 0, lng: 0 }, { latitude: 0, longitude: 0 }])('setLocation rejects (0,0): %j', async (b) => {
    await expect(setLocation('w', b)).rejects.toThrow(bad);
    expect(prisma.location.upsert).not.toHaveBeenCalled();
  });

  it('setLocation accepts a single zero coordinate', async () => {
    await setLocation('w', { lat: 0, lng: 3.4 });
    expect(prisma.location.upsert).toHaveBeenCalledOnce();
  });

  it('updateLocation rejects (0,0) and lone coordinates', async () => {
    await expect(updateLocation('w', 'w', { lat: 0, lng: 0 })).rejects.toThrow(bad);
    await expect(updateLocation('w', 'w', { lat: 5 })).rejects.toThrow(bad);
    expect(prisma.location.update).not.toHaveBeenCalled();
  });

  it('updateLocation allows non-coordinate updates', async () => {
    await updateLocation('w', 'w', { city: 'Abuja' });
    expect(prisma.location.update).toHaveBeenCalledOnce();
  });

  it.each([{ radius: '10' }, { lat: '6', radius: '10' }, { lat: '6', lng: '3' }])(
    'proximity query rejects partial origin/radius: %j',
    async (q) => {
      await expect(getFarmerLocations(q)).rejects.toThrow(bad);
    },
  );

  it('proximity query accepts all three or none', async () => {
    await expect(getFarmerLocations({ lat: '6', lng: '3', radius: '10' })).resolves.toBeDefined();
    await expect(getFarmerLocations({})).resolves.toBeDefined();
  });
});
