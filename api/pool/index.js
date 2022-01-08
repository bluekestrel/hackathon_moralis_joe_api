"use strict";

const BigNumber = require("bignumber.js");
const { web3Factory } = require("../../utils/web3");
const { getPrice } = require("../price/index");

// import necessary contract ABIs
const ERC20ABI = require("../../abis/ERC20ContractABI.json");
const JoePairABI = require("../../abis/JoePairABI.json");

const {
  AVAX_CHAIN_ID,
  SECONDS_PER_YEAR,
  BN_1E18,
  BN_1,
} = require("../../constants");

// setup provider
const web3 = web3Factory(AVAX_CHAIN_ID);

class Cache {
  async getTVLByToken(lpTokenAddress) {
    const lpTokenContract = new web3.eth.Contract(
      JoePairABI,
      lpTokenAddress,
    );

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
}

async function getTVLByToken(ctx) {
  if (!("lpToken" in ctx.params)) ctx.body = "";
  else {
    ctx.body = (await cache.getTVLByToken(ctx.params.lpToken));
  }
}

async function TVLHelper(tokenAddress) {
  return (await cache.getTVLByToken(tokenAddress));
}

const cache = new Cache();
module.exports = {
  getTVLByToken,
  TVLHelper,
};
