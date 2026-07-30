import { rpc } from '@stellar/stellar-sdk';
import { config } from '../config/index.js';

export const server = new rpc.Server(config.rpcUrl);
