import { z } from "zod";
import { basketStatusEnum, paginationQuery, stellarAddress, uuidParam } from "./common.js";

export const BasketIdParamSchema = z.object({
  id: uuidParam,
});

export const ListBasketsQuerySchema = z.object({
  status: basketStatusEnum.optional(),
  ...paginationQuery,
});

export const ListBasketDepositsQuerySchema = z.object({
  depositorAddress: stellarAddress,
});

export type ListBasketsQuery = z.infer<typeof ListBasketsQuerySchema>;
export type ListBasketDepositsQuery = z.infer<typeof ListBasketDepositsQuerySchema>;
