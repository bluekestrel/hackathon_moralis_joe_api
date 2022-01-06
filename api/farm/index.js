"use strict";

const BigNumber = require("bignumber.js");
const { web3Factory } = require("../../utils/web3");
const { TVLHelper } = require("../pool/index");
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
      pools[poolInfo.lpToken.toLowerCase()] = {
        allocPoint: new BigNumber(poolInfo.allocPoint),
        accJoePerShare: new BigNumber(poolInfo.accJoePerShare),
        // assume we can cast the pool length bignumber to a regular JS integer, this will work so
        // long as it is not greater than MAX_INT which is highly unlikely
        pid: Number(i),
        APR: undefined,
        lastUpdated: 0,
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

  async calculateAPR(poolAddress, poolsList, contract, version) {
    const joePairContract = new web3.eth.Contract(
      JoePairABI,
      poolAddress,
    );

    // get new information for the specific pool address requested
    const poolInfo = await contract.methods.poolInfo(poolsList[poolAddress].pid).call();
    const poolAllocPoints = new BigNumber(poolInfo.allocPoint.toString());

    // get the total allocation points for the AMM contract (aka the MasterChef contract)
    let result = await contract.methods.totalAllocPoint().call();
    const totalAllocPoints = new BigNumber(result.toString());

    // get the amount of JOE earned per second for the given MasterChef contract
    result = await contract.methods.joePerSec().call();
    const joeAccruedPerSec = (new BigNumber(result.toString())).div(BN_1E18);

    // get the price of JOE (in usd)
    result = await getPrice(JOE_ADDRESS, false);
    const joePrice = new BigNumber(result.toString()).div(BN_1E18);

    // calculate the numerator, which is the total value of JOE earned per year for this specific
    // pool address
    const numerator = (poolAllocPoints.div(totalAllocPoints))
      .times(joeAccruedPerSec)
      .times(joePrice)
      .times(SECONDS_PER_YEAR);
    
    // get the TVL of the pool
    result = await TVLHelper(poolAddress);
    const TVL = new BigNumber(result.toString());

    // get the number of decimals for the LP token
    result = await joePairContract.methods.decimals().call();
    const lpDecimals = new BigNumber(result.toString());

    // get the number of LP tokens that the AMM contract holds
    result = await joePairContract.methods.balanceOf(contract._address).call();
    const chefBalance = (new BigNumber(result.toString())).div(
      new BigNumber(10).pow(lpDecimals),
    );

    // get the total supply of LP tokens
    result = await joePairContract.methods.totalSupply().call();
    const totalSupply = (new BigNumber(result.toString())).div(
      new BigNumber(10).pow(lpDecimals),
    );

    // calulate the denominator, which is the current derived total value of the LP token
    // V2 farms need to have the denominator multiplied by 2, V3 farms do not
    let denominator = (TVL).times(chefBalance).div(totalSupply);
    if (version === "V2") {
      denominator = denominator.times(2);
    }

    // now calculate the APR
    const APR = numerator.div(denominator).times(100).decimalPlaces(2);

    // update the values in the poolsList for the specific LP token
    poolsList[poolAddress].APR = APR;
    poolsList[poolAddress].lastUpdated = Date.now();

    return APR;
  }

  async getPoolAPR(poolAddress) {
    poolAddress = poolAddress.toLowerCase();
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
        poolAPR = await this.calculateAPR(poolAddress, this.v2Pools, MasterChefV2, "V2");
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
        poolAPR = await this.calculateAPR(poolAddress, this.v3Pools, MasterChefV3, "V3");
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

// TODO: calculate reward APR for tokens that are being bolstered by a secondary reward generating
// contract (i.e. rewarder address in poolInfo will be a non-zero address!)

async function listPools(ctx) {
  ctx.body = (await cache.listPools());
}

async function getFarmAPR(ctx) {
  if (!("lpToken" in ctx.params)) ctx.body = "";
  else {
    ctx.body = (await cache.getPoolAPR(ctx.params.lpToken));
  }
}

const cache = new Cache();
module.exports = {
  listPools,
  getFarmAPR,
};
