import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { z } from "zod";
import { validateBody, validateParams, validateQuery } from "./validate.js";

function makeApp() {
  const app = express();
  app.use(express.json());

  const schema = z.object({ name: z.string().min(1), age: z.number().int().positive() });
  app.post("/test", validateBody(schema), (req, res) => {
    res.json(req.body);
  });

  const querySchema = z.object({ page: z.coerce.number().default(1) });
  app.get("/test", validateQuery(querySchema), (req, res) => {
    res.json(req.query);
  });

  const paramsSchema = z.object({ id: z.string().uuid() });
  app.get("/test/:id", validateParams(paramsSchema), (req, res) => {
    res.json(req.params);
  });

  return app;
}

const app = makeApp();

describe("validateBody", () => {
  it("passes valid body through", async () => {
    const res = await request(app)
      .post("/test")
      .send({ name: "Alice", age: 30 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: "Alice", age: 30 });
  });

  it("returns 400 on missing required field", async () => {
    const res = await request(app).post("/test").send({ name: "Alice" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(res.body.details).toBeDefined();
  });

  it("returns 400 on wrong type", async () => {
    const res = await request(app).post("/test").send({ name: "Alice", age: "old" });
    expect(res.status).toBe(400);
    expect(res.body.details.some((d: { field: string }) => d.field === "age")).toBe(true);
  });

  it("returns 400 on empty string when min(1)", async () => {
    const res = await request(app).post("/test").send({ name: "", age: 1 });
    expect(res.status).toBe(400);
  });

  it("returns 400 on empty body", async () => {
    const res = await request(app).post("/test").send({});
    expect(res.status).toBe(400);
  });
});

describe("validateQuery", () => {
  it("applies default when param absent", async () => {
    const res = await request(app).get("/test");
    expect(res.status).toBe(200);
    expect(Number(res.body.page)).toBe(1);
  });

  it("parses provided query param", async () => {
    const res = await request(app).get("/test?page=3");
    expect(res.status).toBe(200);
    expect(Number(res.body.page)).toBe(3);
  });
});

describe("validateParams", () => {
  it("passes valid UUID", async () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const res = await request(app).get(`/test/${uuid}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(uuid);
  });

  it("returns 400 on invalid UUID", async () => {
    const res = await request(app).get("/test/not-a-uuid");
    expect(res.status).toBe(400);
  });
});
