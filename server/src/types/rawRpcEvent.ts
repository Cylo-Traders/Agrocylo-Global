import type { rpc } from "@stellar/stellar-sdk";

/** Decoded Soroban event as returned by the Stellar RPC `getEvents` call. */
export type RawRpcEvent = rpc.Api.EventResponse;
