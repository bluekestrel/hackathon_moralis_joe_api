"use strict";

const BigNumber = require("bignumber.js");
const { web3Factory } = require("../../utils/web3");
const { TVLHelper } = require("../pool/index");
const { getPrice } = require("../price/index");

// import necessary contract ABIs
const JoePairABI = require("../../abis/JoePairABI.json");
const MasterChefV2ABI = require("../../abis/MasterChefJoeV2ABI.json");
const MasterChefV3ABI = require("../../abis/MasterChefJoeV3ABI.json");
const SimpleRewardABI = require("../../abis/SimpleRewardABI.json");

const {
  AVAX_CHAIN_ID,
  SECONDS_PER_YEAR,
  JOE_ADDRESS,
  MASTERCHEFV2_ADDRESS,
  MASTERCHEFV3_ADDRESS,
  BN_1E18,
  BN_1,
  ZERO_ADDRESS,
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
        liquidity: undefined,
        APR: undefined,
        bonusAPR: undefined,
        lastUpdatedAPR: 0,
        lastUpdatedBonusAPR: 0,
        lastUpdatedLiquidity: 0,
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

  async findPool(address) {
    // given a potential lp token address, return the associated pool information
    // make sure the pools lists are up to date first by calling getPools(...)
    await Promise.all([
      this.getPools(this.v2PoolsLength, this.v2Pools, MasterChefV2, "V2"),
      this.getPools(this.v3PoolsLength, this.v3Pools, MasterChefV3, "V3"),
    ]);

    if (address in this.v2Pools) {
      return {
        list: this.v2Pools,
        contract: MasterChefV2,
        version: "V2",
      };
    }
    else if (address in this.v3Pools) {
      return {
        list: this.v3Pools,
        contract: MasterChefV3,
        version: "V3",
      };
    }
    else {
      throw new Error("404: Farm not found");
    }
  }

  async calculateFarmLiquidity(poolAddress, poolsList, ammContract) {
    // check if values for the specific pool are new enough to be used
    const expirationTime = poolsList[poolAddress].lastUpdatedLiquidity + this.minElapsedTimeInMs;
    if (poolsList[poolAddress].liquidity && (expirationTime > Date.now())) {
      // return value saved in cache
      return poolsList[poolAddress].liquidity;
    }

    const joePairContract = new web3.eth.Contract(
      JoePairABI,
      poolAddress,
    );

    // get the TVL of the overal pool
    let result = await TVLHelper(poolAddress);
    const poolTVL = new BigNumber(result.toString());

    // get the number of decimals for the LP token
    result = await joePairContract.methods.decimals().call();
    const lpDecimals = new BigNumber(result.toString());

    // get the number of LP tokens that the AMM contract holds
    result = await joePairContract.methods.balanceOf(ammContract._address).call();
    const chefBalance = (new BigNumber(result.toString())).div(
      new BigNumber(10).pow(lpDecimals),
    );

    // get the total supply of LP tokens
    result = await joePairContract.methods.totalSupply().call();
    const totalSupply = (new BigNumber(result.toString())).div(
      new BigNumber(10).pow(lpDecimals),
    );

    // calulate the farm liquidity, which is the current derived total value of the LP token
    let farmLiquidity = (poolTVL).times(chefBalance).div(totalSupply).decimalPlaces(2);
    poolsList[poolAddress].liquidity = farmLiquidity;
    poolsList[poolAddress].lastUpdatedLiquidity = Date.now();

    return farmLiquidity;
  }

  async getFarmLiquidity(poolAddress) {
    poolAddress = poolAddress.toLowerCase();

    // get necessary information to calculate liquidity
    let list, contract, version;
    try {
      ({ list, contract, version } = await this.findPool(poolAddress));
    } catch {
      return "Pool is not an active yield farm"
    }

    return await this.calculateFarmLiquidity(poolAddress, list, contract, version);
  }

  async getFarmBonusAPR(poolAddress) {
    poolAddress = poolAddress.toLowerCase();

    // get necessary information to calculate liquidity
    let list, contract, version;
    try {
      ({ list, contract, version } = await this.findPool(poolAddress));
    } catch {
      return "Pool is not an active yield farm"
    }

    // check to make sure farm requested is receiving bonus tokens
    const { rewarder: rewarderAddress } = await contract.methods
      .poolInfo(list[poolAddress].pid)
      .call();

    if (rewarderAddress === ZERO_ADDRESS) {
      // farm is currently not receiving any bonus tokens, so return 0 for bonus APR
      return 0;
    }

    // check if values for the specific pool are new enough to be used
    const expirationTime = list[poolAddress].lastUpdatedBonusAPR + this.minElapsedTimeInMs;
    if (list[poolAddress].bonusAPR && (expirationTime > Date.now())) {
      // return value saved in cache
      return list[poolAddress].bonusAPR;
    }

    const rewarderContract = new web3.eth.Contract(SimpleRewardABI, rewarderAddress);

    // get the address of the reward token and calculate its value (in USD)
    const rewardTokenAddress = await rewarderContract.methods.rewardToken().call();
    let result = await getPrice(rewardTokenAddress, false);
    const tokenPrice = new BigNumber(result.toString()).div(BN_1E18);

    // get the number of reward tokens earned per second
    result = await rewarderContract.methods.tokenPerSec().call();
    const tokenAccruedPerSec = (new BigNumber(result.toString())).div(BN_1E18);

    // calculate the numerator, which is the total value of the reward token earned per year by
    // the reward contract
    const numerator = tokenAccruedPerSec.times(tokenPrice).times(SECONDS_PER_YEAR);

    // calculate the farm liquidity, which is the denominator
    const denominator = await this.calculateFarmLiquidity(poolAddress, list, contract, version);

    // now calculate the bonus reward APR
    const bonusAPR = numerator.div(denominator).times(100).decimalPlaces(2);

    // update the values stored in the pools list
    list[poolAddress].bonusAPR = bonusAPR;
    list[poolAddress].lastUpdatedBonusAPR = Date.now();

    return bonusAPR;
  }

  async calculateAPR(poolAddress, poolsList, contract, version) {
    // get new information for the specific pool address requested
    const poolInfo = await contract.methods.poolInfo(poolsList[poolAddress].pid).call();
    const poolAllocPoints = new BigNumber(poolInfo.allocPoint.toString());

    // if poolAllocPoints is zero then the APR will also be 0
    if (poolAllocPoints.eq(0)) {
      return 0;
    }

    // TODO: consolidate individual contract calls into an array and await on the array to save
    // some computation time

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

    // calculate the farm liquidity, which is the denominator
    // for MasterChef V2 pools, multiply the denominator by 2
    let denominator = await this.calculateFarmLiquidity(poolAddress, poolsList, contract, version);
    if (version === "V2") {
      denominator = denominator.times(2);
    }

    // now calculate the APR
    const APR = numerator.div(denominator).times(100).decimalPlaces(2);

    // update the values in the poolsList for the specific LP token
    poolsList[poolAddress].APR = APR;
    poolsList[poolAddress].lastUpdatedAPR = Date.now();

    return APR;
  }

  async getPoolAPR(poolAddress) {
    poolAddress = poolAddress.toLowerCase();

    // get necessary information to calculate APR
    let list, contract, version;
    try {
      ({ list, contract, version } = await this.findPool(poolAddress));
    } catch {
      return "Pool is not an active yield farm"
    }

    let poolAPR;
    if (
      !(list[poolAddress].APR) || (list[poolAddress].lastUpdatedAPR + this.minElapsedTimeInMs <
        Date.now() // check if values for the specific pool need to be updated
      )
    ) {
      poolAPR = await this.calculateAPR(poolAddress, list, contract, version);
    } else {
      poolAPR = list[poolAddress].APR;
    }

    return poolAPR;
  }

  async getPoolWeight(poolAddress) {
    poolAddress = poolAddress.toLowerCase();

    // get necessary information to calculate pool weight
    let list, contract;
    try {
      ({ list, contract } = await this.findPool(poolAddress));
    } catch {
      return "Pool is not an active yield farm"
    }

    const { allocPoint } =  await contract.methods.poolInfo(list[poolAddress].pid).call();
    const poolWeight = (new BigNumber(allocPoint)).div(100);
    return poolWeight;
  }
}

async function listPools(ctx) {
  ctx.body = (await cache.listPools());
}

async function getFarmAPR(ctx) {
  if (!("lpToken" in ctx.params)) ctx.body = "";
  else {
    ctx.body = (await cache.getPoolAPR(ctx.params.lpToken));
  }
}

async function getFarmLiquidity(ctx) {
  if (!("lpToken" in ctx.params)) ctx.body = "";
  else {
    ctx.body = (await cache.getFarmLiquidity(ctx.params.lpToken));
  }
}

async function getBonusAPR(ctx) {
  if (!("lpToken" in ctx.params)) ctx.body = "";
  else {
    ctx.body = (await cache.getFarmBonusAPR(ctx.params.lpToken));
  }
}

async function getPoolWeight(ctx) {
  if (!("lpToken" in ctx.params)) ctx.body = "";
  else {
    ctx.body = (await cache.getPoolWeight(ctx.params.lpToken));
  }
}

const cache = new Cache();
module.exports = {
  listPools,
  getFarmAPR,
  getFarmLiquidity,
  getBonusAPR,
  getPoolWeight,
};
