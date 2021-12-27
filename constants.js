require('dotenv').config;
const BN = require("bn.js");
const CLA = require('command-line-args');
const config = require('./config');

// number constants
const BN_1E18 = new BN("1000000000000000000");
const BN_18 = new BN("18");
const BN_2 = new BN("2");

const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function getNetworkInfo(network) {
  if (network && config[network]) {
    // network exists in predefined constants
    return {
      AVAX_RPC: process.env.AVAX_MAINNET_RPC || config[network].defaultRPC,
      AVAX_CHAIN_ID: config[network].chainid,
    }
  } else {
    // network is not defined or is not present in the NETWORKS object, default to Avalanche Mainnet
    // C-chain
    return {
      AVAX_RPC: config.mainnet.defaultRPC,
      AVAX_CHAIN_ID: config.mainnet.chainid,
    }
  }
}

function getConfigValue(network, value) {
  if (network && config[network]) {
    return config[network][value];
  } else {
    return config.mainnet[value];
  }
}

// setup command-line parsing
const optionDefinitions = [
  { name: 'network', alias: 'n', type: String },
  { name: 'rate-limit', alias: 'l', type: Number }
];
const options = CLA(optionDefinitions);

// get network info
const { AVAX_RPC, AVAX_CHAIN_ID } = getNetworkInfo(options.network);

// get contract addresses
const {
  JOE_ADDRESS,
  JOEFACTORY_ADDRESS,
  WAVAX_ADDRESS,
  XJOE_ADDRESS,
  USDC_ADDRESS,
  USDT_ADDRESS,
  WAVAX_USDT_ADDRESS,
  WAVAX_USDC_ADDRESS,
  TOTAL_SUPPLY_AND_BORROW_ADDRESS,
} = getConfigValue(options.network, 'contract_addresses');

// get treasury wallets
const TEAM_TREASURY_WALLETS = getConfigValue(options.network, 'team_treasury_wallets');

module.exports = {
  AVAX_RPC,
  AVAX_CHAIN_ID,
  BN_1E18,
  BN_18,
  BN_2,
  JOE_ADDRESS,
  JOEFACTORY_ADDRESS,
  TEAM_TREASURY_WALLETS,
  TOTAL_SUPPLY_AND_BORROW_ADDRESS,
  USDC_ADDRESS,
  USDT_ADDRESS,
  WAVAX_ADDRESS,
  XJOE_ADDRESS,
  WAVAX_USDT_ADDRESS,
  WAVAX_USDC_ADDRESS,
  BURN_ADDRESS,
  ZERO_ADDRESS,
};
