import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import {
  formatZodError,
  validateBody,
  validateParams,
  validateQuery,
} from './validate.js';

function makeApp() {
  const app = express();
  app.use(express.json());

  const schema = z.object({
    name: z.string().min(1),
    age: z.number().int().positive(),
  });
  app.post('/test', validateBody(schema), (req, res) => {
    res.json(req.body);
  });

  const querySchema = z.object({ page: z.coerce.number().default(1) });
  app.get('/test', validateQuery(querySchema), (req, res) => {
    res.json(req.query);
  });

  const paramsSchema = z.object({ id: z.string().uuid() });
  app.get('/test/:id', validateParams(paramsSchema), (req, res) => {
    res.json(req.params);
  });

  return app;
}

const app = makeApp();

describe('formatZodError', () => {
  it('maps Zod issues to RFC 7807 field errors', () => {
    const schema = z.object({ age: z.number() });
    const result = schema.safeParse({ age: 'x' });
    if (result.success) throw new Error('expected failure');
    const problem = formatZodError(result.error, '/example');
    expect(problem.title).toBe('Validation Failed');
    expect(problem.status).toBe(400);
    expect(problem.errors[0]?.field).toBe('age');
    expect(problem.errors[0]?.code).toBeDefined();
  });
});

describe('validateBody', () => {
  it('passes valid body through', async () => {
    const res = await request(app)
      .post('/test')
      .send({ name: 'Alice', age: 30 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'Alice', age: 30 });
  });

  it('returns RFC 7807 problem detail on missing field', async () => {
    const res = await request(app).post('/test').send({ name: 'Alice' });
    expect(res.status).toBe(400);
    expect(res.body.title).toBe('Validation Failed');
    expect(res.body.errors).toBeDefined();
    expect(
      res.body.errors.some((d: { field: string }) => d.field === 'age'),
    ).toBe(true);
  });

  it('returns 400 on wrong type', async () => {
    const res = await request(app)
      .post('/test')
      .send({ name: 'Alice', age: 'old' });
    expect(res.status).toBe(400);
    expect(
      res.body.errors.some((d: { field: string }) => d.field === 'age'),
    ).toBe(true);
  });

  it('returns 400 on empty string when min(1)', async () => {
    const res = await request(app).post('/test').send({ name: '', age: 1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 on empty body', async () => {
    const res = await request(app).post('/test').send({});
    expect(res.status).toBe(400);
  });
});

describe('validateQuery', () => {
  it('applies default when param absent', async () => {
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(Number(res.body.page)).toBe(1);
  });

  it('parses provided query param', async () => {
    const res = await request(app).get('/test?page=3');
    expect(res.status).toBe(200);
    expect(Number(res.body.page)).toBe(3);
  });
});

describe('validateParams', () => {
  it('passes valid UUID', async () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const res = await request(app).get(`/test/${uuid}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(uuid);
  });

  it('returns 400 on invalid UUID', async () => {
    const res = await request(app).get('/test/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.title).toBe('Validation Failed');
  });
});
