"use strict";

const BigNumber = require("bignumber.js");
const { web3Factory } = require("../../utils/web3");
const { getPrice } = require("../price/index");

// import necessary contract ABIs
const ERC20ContractABI = require("../../abis/ERC20ContractABI.json");
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
        // long as it is not >= MAX_INT which is highly unlikely
        pid: Number(i),
      };

      i = i.plus(BN_1);
    });
  }

  async listPools() {
    // allow the pools to initialize and/or update if necessary before returning the list
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
}

async function listPools(ctx) {
  ctx.body = (await cache.listPools());
}

const cache = new Cache();
module.exports = {
  listPools,
};
