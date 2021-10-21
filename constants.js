const BN = require("bn.js");
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

const AVAX_RPC = process.env.AVAX_RPC || 'https://api.avax.network/ext/bc/C/rpc';
const AVAX_CHAIN_ID = 43114;


const AVAX_VAULTS_ENDPOINT =
  'https://raw.githubusercontent.com/traderjoe-xyz/beefy-app/prod/src/features/configure/vault/avalanche_pools.js';

const _1E18 = new BN("1000000000000000000");

module.exports = {
  API_BASE_URL,
  _1E18,

  AVAX_RPC,
  AVAX_CHAIN_ID,
  AVAX_VAULTS_ENDPOINT
};
