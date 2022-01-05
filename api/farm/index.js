"use strict";

const BigNumber = require("bignumber.js");
const { web3Factory } = require("../../utils/web3");
const { getPrice } = require("../price/index");

// import necessary contract ABIs
const JoePairABI = require("../../abis/JoePairABI.json");
const MasterChefV2ABI = require("../../abis/MasterChefJoeV2ABI.json");
const MasterChefV3ABI = require("../../abis/MasterChefJoeV3ABI.json");

const {
  AVAX_CHAIN_ID,
  SECONDS_PER_YEAR,
  JOE_ADDRESS,
  MASTERCHEFV2_ADDRESS,
  MASTERCHEFV3_ADDRESS,
  BN_1E18,
  BN_1,
} = require("../../constants");

// setup provider
const web3 = web3Factory(AVAX_CHAIN_ID);

// setup contract objects that do not change
const MasterChefV2 = new web3.eth.Contract(
  MasterChefV2ABI,
  MASTERCHEFV2_ADDRESS,
);

const MasterChefV3 = new web3.eth.Contract(
  MasterChefV3ABI,
  MASTERCHEFV3_ADDRESS,
);

class Cache {
  minElapsedTimeInMs = 60000; // 60 seconds

  constructor() {
    this.v2Pools = {};
    this.v2PoolsLength = new BigNumber(0);
    this.v3Pools = {};
    this.v3PoolsLength = new BigNumber(0);
  }

  async getPools(length, pools, contract, type = "") {
    // get the total number of pools in the given contract
    let result = await contract.methods.poolLength().call();
    const poolLength = new BigNumber(result.toString());

    const promises = [];
    // we start at the current length and assume the previous indices have already been populated
    for (let i = length; i.lt(poolLength); i = i.plus(BN_1)) {
      // await-ing each contract call one by one is slow, asynchonously call the contract and then
      // await on an array of promises instead
      promises.push(
        contract.methods.poolInfo(i).call(),
      );
    }

    // update the original length object with the new length
    let i = length; // need this for populating the pools object
    if (type === "V2") {
      this.v2PoolsLength = poolLength;
    }
    else if (type === "V3") {
      this.v3PoolsLength = poolLength;
    }

    const poolsInfo = await Promise.all(promises);
    poolsInfo.forEach((poolInfo) => {
      // now that we have the pool info, populate the passed-in pools object accordingly
      pools[poolInfo.lpToken] = {
        allocPoint: new BigNumber(poolInfo.allocPoint),
        accJoePerShare: new BigNumber(poolInfo.accJoePerShare),
        // assume we can cast the pool length bignumber to a regular JS integer, this will work so
        // long as it is not greater than MAX_INT which is highly unlikely
        pid: Number(i),
        APR: undefined,
        lastUpdated: Date.now(),
      };

      i = i.plus(BN_1);
    });
  }

  async listPools() {
    // allow the pool lists to initialize and/or add new pools to farm
    await this.getPools(this.v2PoolsLength, this.v2Pools, MasterChefV2, "V2");
    await this.getPools(this.v3PoolsLength, this.v3Pools, MasterChefV3, "V3");

    const list = {
      [MASTERCHEFV2_ADDRESS]: [],
      [MASTERCHEFV3_ADDRESS]: [],
    };
    // iterate over the two pools and return the lp token address and pool id
    Object.keys(this.v2Pools).forEach((lpToken) => {
      list[MASTERCHEFV2_ADDRESS].push({
        token: lpToken,
        pid: this.v2Pools[lpToken].pid,
      });
    });

    Object.keys(this.v3Pools).forEach((lpToken) => {
      list[MASTERCHEFV3_ADDRESS].push({
        token: lpToken,
        pid: this.v3Pools[lpToken].pid,
      });
    });

    return list;
  }

  async calculateAPR(poolAddress, poolsList, contract) {
    // TODO: remember to update the APR in poolsList for the specific poolAddress with the new APR
    // and lastUpdated timestamp
    // TODO: update _all_ the values after doing the calculations
    const joePairContract = new web3.eth.Contract(
      poolAddress,
      JoePairABI,
    );

    // get new information for the specific pool address requested
    const poolInfo = await contract.methods.poolInfo(poolsList[poolAddress].pid).call();
    const poolAllocPoints = new BigNumber(poolInfo.allocPoint.toString());

    // get the total allocation points for the AMM contract (aka the MasterChef contract)
    let result = await contract.methods.totalAllocPoint().call();
    const totalAllocPoints = new BigNumber(result.toString());

    // get the amount of JOE earned per second for the given MasterChef contract
    result = await contract.methods.joePerSec().call();
    const joeAccruedPerSec = new BigNumber(result.toString());

    // get the price of JOE (in usd)
    result = await getPrice(JOE_ADDRESS, false);
    const joePrice = new BigNumber(result.toString()).div(BN_1E18);

    // calculate the numerator, which is the total value of JOE earned per year for this specific
    // pool address
    const numerator = (poolAllocPoints.div(totalAllocPoints))
      .times(joeAccruedPerSec)
      .times(joePrice)
      .times(SECONDS_PER_YEAR);
    
    // TODO: need to get TVL for a Joe LP token pair
  }

  async getPoolAPR(poolAddress) {
    // check to make sure the pool is listed in one of the two MasterChef contracts
    // make sure the pools lists are up to date first by calling getPools(...)
    await this.getPools(this.v2PoolsLength, this.v2Pools, MasterChefV2, "V2");
    await this.getPools(this.v3PoolsLength, this.v3Pools, MasterChefV3, "V3");

    if (poolAddress in this.v2Pools) {
      let poolAPR;

      if (
        !(this.v2Pools[poolAddress]) || (this.v2Pools[poolAddress].lastUpdated +
          this.minElapsedTimeInMs <
          Date.now() // check if values for the specific pool need to be updated
        )
      ) {
        poolAPR = await this.calculateAPR(poolAddress, this.v2Pools, MasterChefV2);
      } else {
        poolAPR = this.v2Pools[poolAddress].APR;
      }

      return poolAPR;
    }
    else if (poolAddress in this.v3Pools) {
      let poolAPR;

      if (
        !(this.v3Pools[poolAddress]) || (this.v3Pools[poolAddress].lastUpdated +
          this.minElapsedTimeInMs <
          Date.now() // check if values for the specific pool need to be updated
        )
      ) {
        poolAPR = await this.calculateAPR(poolAddress, this.v3Pools, MasterChefV3);
      } else {
        poolAPR = this.v3Pools[poolAddress].APR;
      }

      return poolAPR;
    }
    else {
      return "Pool is not an active yield farm";
    }
  }
}

async function listPools(ctx) {
  ctx.body = (await cache.listPools());
}

const cache = new Cache();
module.exports = {
  listPools,
};
