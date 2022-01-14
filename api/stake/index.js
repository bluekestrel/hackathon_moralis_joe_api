"use strict";

const axios = require("axios");
const BigNumber = require("bignumber.js");
const { web3Factory } = require("../../utils/web3");
const { getPrice } = require("../price/index");
const { calculateAPYDailyCompund } = require("../../utils/helperFunctions");

// import necessary contract ABIs
const ERC20ABI = require("../../abis/ERC20ContractABI.json");
const JoeMakerV3ABI = require("../../abis/JoeMakerV3ABI.json");
const JoeBarABI = require("../../abis/JoeBarContractABI.json");
const JoeFactoryABI = require("../../abis/JoeFactoryContractABI.json");

const {
  API_KEY,
  AVAX_CHAIN_ID,
  BN_1E18,
  BN_1,
  DAYS_PER_YEAR,
  FEES_PERCENT,
  JOE_FACTORY_ADDRESS,
  SECONDS_PER_YEAR,
  XJOE_ADDRESS,
  JOE_ADDRESS,
} = require("../../constants");

// ABI of a LogConvert event, needed by Moralis api endpoint
const LogConvertABI = {
  "anonymous": false,
  "inputs": [
    {
      "indexed": true,
      "internalType": "address",
      "name": "server",
      "type": "address"
    },
    {
      "indexed": true,
      "internalType": "address",
      "name": "token0",
      "type": "address"
    },
    {
      "indexed": true,
      "internalType": "address",
      "name": "token1",
      "type": "address"
    },
    {
      "indexed": false,
      "internalType": "uint256",
      "name": "amount0",
      "type": "uint256"
    },
    {
      "indexed": false,
      "internalType": "uint256",
      "name": "amount1",
      "type": "uint256"
    },
    {
      "indexed": false,
      "internalType": "uint256",
      "name": "amountJOE",
      "type": "uint256"
    }
  ],
  "name": "LogConvert",
  "type": "event"
};

const logConvertTopic = "0xd06b1d7ed79b664d17472c6f6997b929f1abe463ccccb4e5b6a0038f2f730c15";

const queryConfig = {
  headers: {
    "accept": "application/json",
    "X-API-Key": API_KEY,
    "Content-Type": "application/json",
  }
};

// setup provider
const web3 = web3Factory(AVAX_CHAIN_ID);

const moralisEndpoint = "https://deep-index.moralis.io/api/v2";

// setup contracts that are constant
const JoeFactoryContract = new web3.eth.Contract(
  JoeFactoryABI,
  JOE_FACTORY_ADDRESS,
);

const xJoeContract = new web3.eth.Contract(
  JoeBarABI,
  XJOE_ADDRESS,
);

const JoeContract = new web3.eth.Contract(
  ERC20ABI,
  JOE_ADDRESS,
);

class Cache {
  dayInMs = 86400000 // 24 hours
  minElapsedTimeInMs = 3600000; // 1 hour

  constructor() {
    this.stakeData = undefined;
    this.JoeMakerContract = undefined;
  }

  async getJoeMaker() {
    // if the joe maker contract is defined then return
    if (this.JoeMakerContract !== undefined) { return };

    // get the address provided by the feeTo() method from the JoeFactory, this is the JoeMaker
    const joeMakerAddress = await JoeFactoryContract.methods.feeTo().call();
    this.JoeMakerContract = new web3.eth.Contract(
      JoeMakerV3ABI,
      joeMakerAddress,
    );
  }

  async calculate24HourFees() {
    const currTime = Date.now();
    const startTime = new Date(currTime - this.dayInMs);
    const endTime = new Date(currTime);

    // construct the query
    const queryEndpoint = `${moralisEndpoint}/${this.JoeMakerContract._address}/events`;
    const queryParams = `?chain=avalanche&from_date=${startTime.toISOString()}` +
      `&to_date=${endTime.toISOString()}&topic=${logConvertTopic}`;
    const fullQuery = `${queryEndpoint}${queryParams}`;

    const response = await axios.post(fullQuery, LogConvertABI, queryConfig);
    const { result: transactions } = response.data;
    let runningTotal = new BigNumber(0);

    transactions.forEach((transaction) => {
      let { amountJOE } = transaction.data;
      amountJOE = (new BigNumber(amountJOE)).div(BN_1E18);
      runningTotal = runningTotal.plus(amountJOE);
    });

    // get the price of JOE
    let joePrice = await getPrice(JOE_ADDRESS, false);
    joePrice = new BigNumber(joePrice.toString()).div(BN_1E18);

    // multiply the total amount of JOE 'bought' over the course of a day by the current price
    // of JOE to get an approximation of the total fees that were occrued by pool swaps in a day
    const fees = runningTotal.times(joePrice);

    // store the calculated information into stakeData
    this.stakeData = {
      fees: fees.decimalPlaces(4),
      lastUpdated: Date.now(),
    }
  }

  async getTotalFees() {
    // make sure the joe maker contract has been initialized
    await this.getJoeMaker();

    const shouldUpdate = this.stakeData?.lastUpdated + this.minElapsedTimeInMs < Date.now();
    if ((this.stakeData ===  undefined) || shouldUpdate) {
      // cache has not been initialized or cached information is outdated
      await this.calculate24HourFees();
    }

    return this.stakeData.fees;
  }

  async calculateAPR() {
    // get the total value of fees (in USD) for the last 24 hours
    const totalFees = await this.getTotalFees();

    // get the price of JOE, the totalSupply of xJOE, the decimals in xJOE, and the number of JOE
    // tokens that the JoeBar contract (aka xJOE) holds
    let [
      joePrice,
      xJoeSupply,
      xJoeDecimals,
      joeBalance,
    ] = await Promise.all([
      getPrice(JOE_ADDRESS, false),
      xJoeContract.methods.totalSupply().call(),
      xJoeContract.methods.decimals().call(),
      JoeContract.methods.balanceOf(xJoeContract._address).call(),
    ]);

    joePrice = new BigNumber(joePrice.toString()).div(BN_1E18);
    xJoeSupply = (new BigNumber(xJoeSupply.toString())).div(
      new BigNumber(10).pow(new BigNumber(xJoeDecimals.toString()))
    );

    // we can use xJoeDecimals for converting the JOE balance because these two tokens have the same
    // decimals value of 18
    joeBalance = (new BigNumber(joeBalance.toString())).div(
      new BigNumber(10).pow(new BigNumber(xJoeDecimals.toString()))
    );

    const numerator = totalFees.div(xJoeSupply).times(DAYS_PER_YEAR);
    const denominator = joeBalance.div(xJoeSupply).times(joePrice);
    const APR = numerator.div(denominator).times(100);
    return APR.decimalPlaces(4);
  }

  async calculateAPY() {
    const percentAPR = await this.calculateAPR();
    const APY = calculateAPYDailyCompund(percentAPR);
    return APY.decimalPlaces(4);
  }
}

async function getTotalFees(ctx) {
  ctx.body = (await cache.getTotalFees());
}

async function getAPR(ctx) {
  ctx.body = (await cache.calculateAPR());
}

async function getAPY(ctx) {
  ctx.body = (await cache.calculateAPY());
}

const cache = new Cache();
module.exports = {
  getTotalFees,
  getAPR,
  getAPY,
}
