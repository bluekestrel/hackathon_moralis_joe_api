"use strict";

const axios = require("axios");
const BigNumber = require("bignumber.js");
const { web3Factory } = require("../../utils/web3");
const { getPrice } = require("../price/index");

// import necessary contract ABIs
const ERC20ABI = require("../../abis/ERC20ContractABI.json");
const JoePairABI = require("../../abis/JoePairABI.json");
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
} = require("../../constants");

const moralisEndpoint = "https://deep-index.moralis.io/api/v2";

// keccak256 hash of the 'Swap' event topic for JoePairs
const swapTopic = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";

// ABI of a transfer event for a JoePair, needed by Moralis api endpoint
const swapABI = {
  "anonymous": false,
  "inputs": [
    {
      "indexed": true,
      "internalType": "address",
      "name": "sender",
      "type": "address"
    },
    {
      "indexed": false,
      "internalType": "uint256",
      "name": "amount0In",
      "type": "uint256"
    },
    {
      "indexed": false,
      "internalType": "uint256",
      "name": "amount1In",
      "type": "uint256"
    },
    {
      "indexed": false,
      "internalType": "uint256",
      "name": "amount0Out",
      "type": "uint256"
    },
    {
      "indexed": false,
      "internalType": "uint256",
      "name": "amount1Out",
      "type": "uint256"
    },
    {
      "indexed": true,
      "internalType": "address",
      "name": "to",
      "type": "address"
    }
  ],
  "name": "Swap",
  "type": "event"
};

const queryConfig = {
  headers: {
    "accept": "application/json",
    "X-API-Key": API_KEY,
    "Content-Type": "application/json",
  }
};

// setup provider
const web3 = web3Factory(AVAX_CHAIN_ID);

// instantiate smart contract objects that do not change
const JoeFactoryContract = new web3.eth.Contract(
  JoeFactoryABI,
  JOE_FACTORY_ADDRESS,
);

class Cache {
  dayInMs = 86400000 // 24 hours
  minElapsedTimeInMs = 3600000; // 1 hour

  constructor() {
    this.pools = {};
  }

  async getToken0Info(lpTokenAddress) {
    const lpTokenContract = new web3.eth.Contract(
      JoePairABI,
      lpTokenAddress,
    );

    const token0Address = await lpTokenContract.methods.token0().call();
    const token0Contract = new web3.eth.Contract(
      ERC20ABI,
      token0Address,
    );

    let [decimals, price] = await Promise.all([
      token0Contract.methods.decimals().call(),
      getPrice(token0Address, false),
    ]);

    decimals = new BigNumber(decimals.toString());
    price = (new BigNumber(price.toString())).div(BN_1E18);

    return { decimals, price };
  }

  async verifyLPToken(lpTokenAddress) {
    let lpTokenContract;
    try {
      lpTokenContract = new web3.eth.Contract(JoePairABI, lpTokenAddress);
    } catch {
      return false;
    }

    // optimistically attempt to retrieve the two tokens from the lp token contract
    let results = await Promise.allSettled([
      lpTokenContract.methods.token0().call(),
      lpTokenContract.methods.token1().call(),
    ]);

    if (results[0].status === "rejected" || results[1].status === "rejected") {
      return false;
    }

    // pull the token addresses out of the promise result array
    const { value: token0Address } = results[0];
    const { value: token1Address } = results[1];

    const tokenAddressFromFactory = await JoeFactoryContract.methods
      .getPair(token0Address, token1Address).call();

    // compare the lp token address returned from the JoeFactory to the lp token address that was
    // provided to see if they are the same
    if (tokenAddressFromFactory.toLowerCase() !== web3.utils.toHex(lpTokenAddress.toLowerCase())) {
      // address is not the same, return false
      return false;
    }
    else {
      return true;
    }
  }

  async calculate24HourHistory(lpTokenAddress) {
    // query the moralis API endpoint for transaction history for a given LP token pair
    // returns an array where each element represents 1 hour of transaction volume
    const promises = [];
    const currTime = Date.now();
    let startTime = currTime - this.dayInMs;
    for (let i = 0; i < 24; i += 1) {
      // request an hour's worth of transaction data from the Moralis api endpoint at a time, until
      // we have requested the last 24 hours' worth of transaction event data
      const endTime = startTime + 3600000;
      const startDate = new Date(startTime);
      const endDate = new Date(endTime);

      // construct the query
      const queryEndpoint = `${moralisEndpoint}/${lpTokenAddress}/events`;
      const queryParams = `?chain=avalanche&from_date=${startDate.toISOString()}` +
        `&to_date=${endDate.toISOString()}&topic=${swapTopic}`;

      const fullQuery = `${queryEndpoint}${queryParams}`;
      promises.push(axios.post(fullQuery, swapABI, queryConfig));

      // move the end time back for the next query
      startTime = endTime;
    }

    // get the decimals and price of token0 - it doesn't matter which token we use for the
    // tranasction calculation as long as we're consistent
    const { decimals, price } = await this.getToken0Info(lpTokenAddress);

    const hourlyTransactionVolume = [];
    const transactionResults = await Promise.all(promises);
    transactionResults.forEach((transactionResult) => {
      const { result: transactions } = transactionResult.data;
      let runningTotal = new BigNumber(0);

      transactions.forEach((transaction) => {
        let { amount0In, amount0Out } = transaction.data;

        // convert the amount of token0 used in the swap transaction to a value, then add that to
        // the running total for this hour of transactions
        let txAmount = amount0In === "0" ? amount0Out : amount0In;
        txAmount = (new BigNumber(txAmount)).div(
          new BigNumber(10).pow(decimals)
        );
        const value = txAmount.times(price);

        runningTotal = runningTotal.plus(value);
      });

      hourlyTransactionVolume.push(runningTotal);
    });

    // save the hourly transaction volume for this lp token in the cache, along with the date and
    // the position of the most recent hour of transaction volume, which will be length - 1
    this.pools[lpTokenAddress.toLowerCase()] = {
      hourlyTransactionVolume,
      dateUpdated: currTime,
      currPosition: hourlyTransactionVolume.length - 1,
    };
  }

  async calculateLastHourHistory(lpTokenAddress) {
    const currTime = Date.now();
    const startTime = new Date(currTime - 3600000);
    const endTime = new Date(currTime);

    // construct the query
    const queryEndpoint = `${moralisEndpoint}/${lpTokenAddress}/events`;
    const queryParams = `?chain=avalanche&from_date=${startTime.toISOString()}` +
      `&to_date=${endTime.toISOString()}&topic=${transferTopic}`;
    const fullQuery = `${queryEndpoint}${queryParams}`;

    const response = await axios.post(fullQuery, swapABI, queryConfig);
    const { result: transactions } = response.data;
    let runningTotal = new BigNumber(0);

    // add up the value of all the transactions to get the transaction volume for that hour
    transactions.forEach((transaction) => {
      let { value } = transaction.data;
      value = (new BigNumber(value)).div(BN_1E18);
      runningTotal = runningTotal.plus(value);
    });

    // save the new hourly transaction volume into the (current slot + 1) % 24 slot since we know
    // that has to be the oldest data
    lpTokenAddress = lpTokenAddress.toLowerCase();
    const newPosition = this.pools[lpTokenAddress].currPosition + 1 % 24; // circular buffer
    this.pools[lpTokenAddress].hourlyTransactionVolume[newPosition] = runningTotal;
    this.pools[lpTokenAddress].dateUpdated = currTime;
    this.pools[lpTokenAddress].currPosition = newPosition;
  }

  async getTransactionHistory(lpTokenAddress) {
    const isLPToken = await this.verifyLPToken(lpTokenAddress);
    if (!isLPToken) { return "Token Address passed in is not an LP Token" };

    lpTokenAddress = lpTokenAddress.toLowerCase();
    if (!(this.pools[lpTokenAddress])) {
      // if this lp token has not been initialized, initialize the entire 24 hour transaction
      // volume array
      await this.calculate24HourHistory(lpTokenAddress);
    }
    // check to see if an hour has elapsed since transaction data for a pool was last found
    else if (this.pools[lpTokenAddress].dateUpdated + this.minElapsedTimeInMs < Date.now()) {
      await this.calculateLastHourHistory(lpTokenAddress);
    }

    let total24HourVolume = new BigNumber(0);
    this.pools[lpTokenAddress].hourlyTransactionVolume.forEach((hour) => {
      total24HourVolume = total24HourVolume.plus(hour);
    });

    return total24HourVolume.decimalPlaces(4);
  }

  async getTransactionFees(lpTokenAddress) {
    const isLPToken = await this.verifyLPToken(lpTokenAddress);
    if (!isLPToken) { return "Token Address passed in is not an LP Token" };

    const transactionVolume = await this.getTransactionHistory(lpTokenAddress);
    const fees = transactionVolume.times(FEES_PERCENT);
    return fees.decimalPlaces(4);
  }

  async getTVLByToken(lpTokenAddress) {
    let lpTokenContract;
    try {
      lpTokenContract = new web3.eth.Contract(JoePairABI, lpTokenAddress);
    } catch {
      return "Address passed in is not an LP token";
    }

    // optimistically attempt to retrieve the two tokens from the lp token contract
    let results = await Promise.allSettled([
      lpTokenContract.methods.token0().call(),
      lpTokenContract.methods.token1().call(),
    ]);

    if (results[0].status === "rejected" || results[1].status === "rejected") {
      return "Address passed in is not an LP token";
    }

    // pull the token addresses out of the promise result array
    const { value: token0Address } = results[0];
    const { value: token1Address } = results[1];

    const token0Contract = new web3.eth.Contract(
      ERC20ABI,
      token0Address,
    );
    const token1Contract = new web3.eth.Contract(
      ERC20ABI,
      token1Address,
    );

    // determine the number of tokens the lpToken address holds, the decimals values for the
    // tokens, and the respective price in USD for each token
    let [
      resultToken0,
      resultToken1,
      decimalsToken0,
      decimalsToken1,
      token0Price,
      token1Price,
    ] = await Promise.all([
      token0Contract.methods.balanceOf(lpTokenAddress).call(),
      token1Contract.methods.balanceOf(lpTokenAddress).call(),
      token0Contract.methods.decimals().call(),
      token1Contract.methods.decimals().call(),
      getPrice(token0Address, false),
      getPrice(token1Address, false),
    ]);

    // convert resulting values to bignumber.js bignumbers, and divide the balances for token0 and
    // token1 by 10 ** decimals for each token respectively
    decimalsToken0 = new BigNumber(decimalsToken0.toString());
    decimalsToken1 = new BigNumber(decimalsToken1.toString());
    const balanceToken0 = (new BigNumber(resultToken0.toString())).div(
      new BigNumber(10).pow(decimalsToken0));
    const balanceToken1 = (new BigNumber(resultToken1.toString())).div(
      new BigNumber(10).pow(decimalsToken1));

    // convert the prices of token0 and token1
    token0Price = (new BigNumber(token0Price.toString())).div(BN_1E18);
    token1Price = (new BigNumber(token1Price.toString())).div(BN_1E18);

    // calculate TVL
    const tvlToken0 = (new BigNumber(token0Price)).times(balanceToken0);
    const tvlToken1 = (new BigNumber(token1Price)).times(balanceToken1);
    return tvlToken0.plus(tvlToken1).decimalPlaces(2);
  }

  async getPoolAPR(lpTokenAddress) {
    const isLPToken = await this.verifyLPToken(lpTokenAddress);
    if (!isLPToken) { return "Token Address passed in is not an LP Token" };

    const transactionFees = await this.getTransactionFees(lpTokenAddress);
    const tokenTVL = await this.getTVLByToken(lpTokenAddress);
    const APR = transactionFees.times(DAYS_PER_YEAR).div(tokenTVL).times(100);
    return APR.decimalPlaces(4);
  }
}

async function getTVLByToken(ctx) {
  if (!("lpToken" in ctx.params)) ctx.body = "";
  else {
    ctx.body = (await cache.getTVLByToken(ctx.params.lpToken));
  }
}

async function get24HourTransactionVolume(ctx) {
  if (!("lpToken" in ctx.params)) ctx.body = "";
  else {
    ctx.body = (await cache.getTransactionHistory(ctx.params.lpToken));
  }
}

async function getTransactionFees(ctx) {
  if (!("lpToken" in ctx.params)) ctx.body = "";
  else {
    ctx.body = (await cache.getTransactionFees(ctx.params.lpToken));
  }
}

async function getPoolAPR(ctx) {
  if (!("lpToken" in ctx.params)) ctx.body = "";
  else {
    ctx.body = (await cache.getPoolAPR(ctx.params.lpToken));
  }
}

async function TVLHelper(tokenAddress) {
  return (await cache.getTVLByToken(tokenAddress));
}

const cache = new Cache();
module.exports = {
  getTVLByToken,
  TVLHelper,
  get24HourTransactionVolume,
  getTransactionFees,
  getPoolAPR,
};
