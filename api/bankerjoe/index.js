"use strict";

const BigNumber = require("bignumber.js");
const { web3Factory } = require("../../utils/web3");
const { getPrice } = require("../price/index");
const { formatResults } = require("../../utils/helperFunctions");

// import necessary contract ABIs
const TotalSupplyAndBorrowABI = require("../../abis/TotalSupplyAndBorrowABI.json");
const JoetrollerABI = require("../../abis/JoetrollerABI.json");
const JTokenABI = require("../../abis/JTokenABI.json");
const RewardsABI = require("../../abis/RewardDistributorABI.json");
const PriceOracleABI = require("../../abis/PriceOracleProxyUSDABI.json");

const {
  AVAX_CHAIN_ID,
  DAYS_PER_YEAR,
  SECONDS_PER_YEAR,
  JOE_ADDRESS,
  JOETROLLER_ADDRESS,
  REWARDS_DISTRIBUTOR_ADDRESS,
  PRICE_ORACLE_ADDRESS,
  TOTAL_SUPPLY_AND_BORROW_ADDRESS,
  BN_1E18,
  BN_1,
} = require("../../constants");

// setup provider
const web3 = web3Factory(AVAX_CHAIN_ID);

// instantiate smart contract objects that do not change
const TotalSupplyAndBorrow = new web3.eth.Contract(
  TotalSupplyAndBorrowABI,
  TOTAL_SUPPLY_AND_BORROW_ADDRESS,
);
const Joetroller = new web3.eth.Contract(
  JoetrollerABI,
  JOETROLLER_ADDRESS,
);
const RewardDistributor = new web3.eth.Contract(
  RewardsABI,
  REWARDS_DISTRIBUTOR_ADDRESS,
);
const PriceOracle = new web3.eth.Contract(
  PriceOracleABI,
  PRICE_ORACLE_ADDRESS,
);

class Cache {
  minElapsedTimeInMs = 10000; // 10 seconds

  constructor() {
    this.cachedTotal = undefined;
    this.lendingPoolsAddresses = undefined;
  }

  async reloadTotal() {
    // check if supply needs to be updated which can occur if: cachedTotal has not yet been
    // initialized or minElapsedTimeInMs has elapsed since total supply and borrow were updated
    if (
      !this.cachedTotal ||
      this.cachedTotal.lastRequestTimestamp + this.minElapsedTimeInMs < Date.now()
    ) {
      const result = await TotalSupplyAndBorrow.methods
        .getTotalSupplyAndTotalBorrow()
        .call();
      const lastRequestTimestamp = Date.now();
      this.cachedTotal = {
        supply: result[0],
        borrow: result[1],
        lastRequestTimestamp,
      };
    }
  }

  async getLendingPoolsAddresses() {
    // call the contract method every time in case a new banker joe lending pool is added
    // polling here is unnecessary because we don't expect the lending pool list to change
    // frequently
    const result = await Joetroller.methods
      .getAllMarkets()
      .call();
    
    this.lendingPoolsAddresses = result;
  }

  async checkIfFarm(address) {
    if (!this.lendingPoolsAddresses) {
      await this.getLendingPoolsAddresses();
    }

    const addressHexString = web3.utils.toHex(address);
    const inFarm = this.lendingPoolsAddresses.filter(
      (lendingPool) => lendingPool.toLowerCase() === addressHexString
    );
    return inFarm.length > 0 ? true : false;
  }

  async getTotalSupply() {
    await this.reloadTotal();
    return formatResults("success", this.cachedTotal.supply.toString());
  }

  async getTotalBorrow() {
    await this.reloadTotal();
    return formatResults("success", this.cachedTotal.borrow.toString());
  }

  async getLendingPools() {
    await this.getLendingPoolsAddresses();
    return formatResults("success", this.lendingPoolsAddresses);
  }

  async getSupplyRateAPY(lendingPool) {
    // if the passed-in address is not a farm then return an empty string
    const inFarm = await this.checkIfFarm(lendingPool);
    if (!inFarm) { return formatResults("failure", "Farm does not exist for that address") }

    const jtoken = new web3.eth.Contract(JTokenABI, lendingPool);
    const result = await jtoken.methods
      .supplyRatePerSecond()
      .call();

    const supplyRatePerSecond = new BigNumber(result.toString());
    let supplyRateAPR = supplyRatePerSecond
      .times(SECONDS_PER_YEAR)
      .div(BN_1E18)

    // convert APR to APY, interest is compounded daily
    const supplyRateAPY = (BN_1.plus(supplyRateAPR.div(DAYS_PER_YEAR)))
      .pow(DAYS_PER_YEAR)
      .minus(BN_1)
      .times(new BigNumber(100));
    return formatResults("success", supplyRateAPY.decimalPlaces(2));
  }

  async getSupplyRewardsAPR(lendingPool) {
    const inFarm = await this.checkIfFarm(lendingPool);
    if (!inFarm) { return formatResults("failure", "Farm does not exist for that address") }

    // get the reward supply per second
    let result = await RewardDistributor.methods.rewardSupplySpeeds(0, lendingPool).call();
    const rewardSupplyPerSecond = new BigNumber(result.toString()).div(BN_1E18);

    // get the price of JOE (in usd)
    result = await getPrice(JOE_ADDRESS, false);
    const joePrice = new BigNumber(result.toString()).div(BN_1E18);

    // calculate the total value of rewards earned in a year, this is the numerator
    const numerator = rewardSupplyPerSecond.times(SECONDS_PER_YEAR).times(joePrice);

    // get the total supply of the particular jToken and its stored exchange rate
    const jtoken = new web3.eth.Contract(JTokenABI, lendingPool);
    result = await jtoken.methods.totalSupply().call();
    const totalSupply = new BigNumber(result.toString()).div(BN_1E18);
    result = await jtoken.methods.exchangeRateStored().call();
    const exchangeRate = new BigNumber(result.toString()).div(BN_1E18);

    // using the price oracle, get the underlying price of the jToken
    result = await PriceOracle.methods.getUnderlyingPrice(lendingPool).call();
    const underlyingPrice = new BigNumber(result.toString()).div(BN_1E18);

    // calculate the current total value of the jToken, this is the denominator
    const denominator = totalSupply.times(exchangeRate).times(underlyingPrice);

    // calculate the supply rewards APR
    const supplyRewardsAPR = numerator.div(denominator)
      .times(new BigNumber(100));
    return formatResults("success", supplyRewardsAPR.decimalPlaces(2));
  }

  async getBorrowRateAPY(lendingPool) {
    // if the passed-in address is not a farm then return an empty string
    const inFarm = await this.checkIfFarm(lendingPool);
    if (!inFarm) { return formatResults("failure", "Farm does not exist for that address") }

    const jtoken = new web3.eth.Contract(JTokenABI, lendingPool);
    const result = await jtoken.methods
      .borrowRatePerSecond()
      .call();

    const borrowRatePerSecond = new BigNumber(result.toString());
    let borrowRateAPR = borrowRatePerSecond
      .times(SECONDS_PER_YEAR)
      .div(BN_1E18);

    // convert APR to APY, interest is compounded daily
    const borrowRateAPY = (BN_1.plus(borrowRateAPR.div(DAYS_PER_YEAR)))
      .pow(DAYS_PER_YEAR)
      .minus(BN_1)
      .times(new BigNumber(100));
    return formatResults("success", borrowRateAPY.decimalPlaces(2));
  }

  async getBorrowRewardsAPR(lendingPool) {
    const inFarm = await this.checkIfFarm(lendingPool);
    if (!inFarm) { return formatResults("failure", "Farm does not exist for that address") }

    // get the reward borrow per second
    let result = await RewardDistributor.methods.rewardBorrowSpeeds(0, lendingPool).call();
    const rewardBorrowPerSecond = new BigNumber(result.toString()).div(BN_1E18);

    // get the price of JOE (in usd)
    result = await getPrice(JOE_ADDRESS, false);
    const joePrice = new BigNumber(result.toString()).div(BN_1E18);

    // calculate the total value of rewards earned in a year, this is the numerator
    const numerator = rewardBorrowPerSecond.times(SECONDS_PER_YEAR).times(joePrice);

    // get the total borrows of the particular jToken
    const jtoken = new web3.eth.Contract(JTokenABI, lendingPool);
    result = await jtoken.methods.totalBorrows().call();
    const totalBorrows = new BigNumber(result.toString()).div(BN_1E18);

    // using the price oracle, get the underlying price of the jToken
    result = await PriceOracle.methods.getUnderlyingPrice(lendingPool).call();
    const underlyingPrice = new BigNumber(result.toString()).div(BN_1E18);

    // calculate the current total value of the jToken, this is the denominator
    const denominator = totalBorrows.times(underlyingPrice);

    // calculate the supply rewards APR
    const borrowRewardsAPR = numerator.div(denominator)
      .times(new BigNumber(100));
    return formatResults("success", borrowRewardsAPR.decimalPlaces(2));
  }
}

async function totalSupply(ctx) {
  ctx.body = (await cache.getTotalSupply());
}

async function totalBorrow(ctx) {
  ctx.body = (await cache.getTotalBorrow());
}

async function getLendingPools(ctx) {
  ctx.body = (await cache.getLendingPools());
}

async function getSupplyRateAPY(ctx) {
  if (!("lendingPool" in ctx.params)) ctx.body = "";
  else {
    ctx.body = (await cache.getSupplyRateAPY(ctx.params.lendingPool));
  }
}

async function getSupplyRewardsAPR(ctx) {
  if (!("lendingPool" in ctx.params)) ctx.body = "";
  else {
    ctx.body = (await cache.getSupplyRewardsAPR(ctx.params.lendingPool));
  }
}

async function getBorrowRateAPY(ctx) {
  if (!("lendingPool" in ctx.params)) ctx.body = "";
  else {
    ctx.body = (await cache.getBorrowRateAPY(ctx.params.lendingPool));
  }
}

async function getBorrowRewardsAPR(ctx) {
  if (!("lendingPool" in ctx.params)) ctx.body = "";
  else {
    ctx.body = (await cache.getBorrowRewardsAPR(ctx.params.lendingPool));
  }
}

const cache = new Cache();
module.exports = {
  totalSupply,
  totalBorrow,
  getLendingPools,
  getSupplyRateAPY,
  getBorrowRateAPY,
  getSupplyRewardsAPR,
  getBorrowRewardsAPR,
};
