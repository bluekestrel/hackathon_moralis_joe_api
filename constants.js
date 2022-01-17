require('dotenv').config({ path: './.env' });
const BigNumber = require("bignumber.js");
const CLA = require('command-line-args');
const config = require('./config');

const API_KEY = process.env.MORALIS_API_KEY;

// number constants
const BN_1E18 = new BigNumber("1000000000000000000");
const BN_18 = new BigNumber("18");
const BN_2 = new BigNumber("2");
const BN_1 = new BigNumber("1");
const DAYS_PER_YEAR = new BigNumber("365");
const SECONDS_PER_YEAR = new BigNumber("31536000");
const FEES_PERCENT = new BigNumber("0.0025");

// address constants
const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function getNetworkInfo(network) {
  if (network && config[network]) {
    // network exists in predefined constants
    return {
      AVAX_RPC: process.env.AVAX_RPC || config[network].defaultRPC,
      AVAX_CHAIN_ID: config[network].chainid,
    }
  } else {
    // network is not defined or is not present in the NETWORKS object, default to Avalanche Mainnet
    // C-chain
    return {
      AVAX_RPC: process.env.AVAX_RPC || config.mainnet.defaultRPC,
      AVAX_CHAIN_ID: config.mainnet.chainid,
    }
  }
}

// given a network and key attempt to look up the corresponding value, if the network name is not
// found default to using the mainnet config
function getConfigValue(network, key) {
  if (network && config[network]) {
    return config[network][key];
  } else {
    return config.mainnet[key];
  }
}

// setup command-line parsing options
const optionDefinitions = [
  { name: 'network', alias: 'n', type: String },
];
const options = CLA(optionDefinitions);

// get network info
const { AVAX_RPC, AVAX_CHAIN_ID } = getNetworkInfo(options.network);

// get contract addresses
const {
  JOE_ADDRESS,
  XJOE_ADDRESS,
  JOE_FACTORY_ADDRESS,
  JOE_ROUTER_ADDRESS,
  MASTERCHEFV2_ADDRESS,
  MASTERCHEFV3_ADDRESS,
  JOETROLLER_ADDRESS,
  PRICE_ORACLE_ADDRESS,
  REWARDS_DISTRIBUTOR_ADDRESS,
  TOTAL_SUPPLY_AND_BORROW_ADDRESS,
  USDC_ADDRESS,
  USDT_ADDRESS,
  WAVAX_ADDRESS,
  WAVAX_USDT_ADDRESS,
  WAVAX_USDC_ADDRESS,
} = getConfigValue(options.network, 'contract_addresses');

// get treasury wallets
const TEAM_TREASURY_WALLETS = getConfigValue(options.network, 'team_treasury_wallets');

module.exports = {
  API_KEY,
  AVAX_RPC,
  AVAX_CHAIN_ID,
  BN_1E18,
  BN_18,
  BN_2,
  BN_1,
  FEES_PERCENT,
  JOE_ADDRESS,
  XJOE_ADDRESS,
  JOE_FACTORY_ADDRESS,
  TEAM_TREASURY_WALLETS,
  JOE_ROUTER_ADDRESS,
  MASTERCHEFV2_ADDRESS,
  MASTERCHEFV3_ADDRESS,
  JOETROLLER_ADDRESS,
  PRICE_ORACLE_ADDRESS,
  REWARDS_DISTRIBUTOR_ADDRESS,
  TOTAL_SUPPLY_AND_BORROW_ADDRESS,
  USDC_ADDRESS,
  USDT_ADDRESS,
  WAVAX_ADDRESS,
  WAVAX_USDT_ADDRESS,
  WAVAX_USDC_ADDRESS,
  BURN_ADDRESS,
  ZERO_ADDRESS,
  DAYS_PER_YEAR,
  SECONDS_PER_YEAR,
};
