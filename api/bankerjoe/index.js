"use strict";

const { web3Factory } = require("../../utils/web3");
const TotalSupplyAndBorrowABI = require("../../abis/TotalSupplyAndBorrowABI.json");
const JoetrollerABI = require("../../abis/JoetrollerABI.json");
const {
  AVAX_CHAIN_ID,
  JOETROLLER_ADDRESS,
  TOTAL_SUPPLY_AND_BORROW_ADDRESS,
} = require("../../constants");

const web3 = web3Factory(AVAX_CHAIN_ID);
const TotalSupplyAndBorrow = new web3.eth.Contract(
  TotalSupplyAndBorrowABI,
  TOTAL_SUPPLY_AND_BORROW_ADDRESS,
);
const Joetroller = new web3.eth.Contract(
  JoetrollerABI,
  JOETROLLER_ADDRESS,
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
      this.cachedTotal.lastRequestTimestamp + this.minElapsedTimeInMs <
        Date.now()
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

  async getTotalSupply() {
    await this.reloadTotal();
    return this.cachedTotal.supply;
  }

  async getTotalBorrow() {
    await this.reloadTotal();
    return this.cachedTotal.borrow;
  }

  async getLendingPools() {
    await this.getLendingPoolsAddresses();
    return this.lendingPoolsAddresses;
  }
}

async function totalSupply(ctx) {
  ctx.body = (await cache.getTotalSupply()).toString();
}

async function totalBorrow(ctx) {
  ctx.body = (await cache.getTotalBorrow()).toString();
}

async function getLendingPools(ctx) {
  ctx.body = (await cache.getLendingPools());
}

const cache = new Cache();
module.exports = {
  totalSupply,
  totalBorrow,
  getLendingPools
};
