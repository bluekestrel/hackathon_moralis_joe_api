'use strict';

const Router = require('koa-router');

// setup two routers with version prefixes
const routerV1 = new Router({
  prefix: '/v1',
});

const routerV2 = new Router({
  prefix: '/v2',
});

// import the logic for each of the different api routes
const noop = require('./api/noop');
const supply = require('./api/supply');
const nftHat = require('./api/nft/hat');
const price = require('./api/price');
const bankerJoe = require('./api/bankerjoe');
const farm = require('./api/farm');
const pool = require('./api/pool');
const stake = require('./api/stake');

// supply info routes
routerV1.get('/supply/circulating', supply.circulatingSupply);
routerV1.get('/supply/circulating-adjusted', supply.circulatingSupplyAdjusted);
routerV1.get('/supply/total', supply.totalSupply);
routerV1.get('/supply/max', supply.maxSupply);

// nft info routes
routerV1.get('/nft/hat', nftHat.infos);
routerV1.get('/nft/hat/:id', nftHat.infos)

// token price routes
routerV1.get('/priceavax/:tokenAddress', price.derivedPriceOfToken)
routerV1.get('/priceusd/:tokenAddress', price.priceOfToken)

// banker joe info routes
routerV1.get('/lending/list', bankerJoe.getLendingPools)
routerV1.get('/lending/supply', bankerJoe.totalSupply)
routerV1.get('/lending/borrow', bankerJoe.totalBorrow)

// V2 routes are below, starting with more banker joe info routes
routerV2.get('/lending/depositAPY/:lendingPool', bankerJoe.getSupplyRateAPY);
routerV2.get('/lending/depositRewardsAPR/:lendingPool', bankerJoe.getSupplyRewardsAPR);
routerV2.get('/lending/borrowAPY/:lendingPool', bankerJoe.getBorrowRateAPY);
routerV2.get('/lending/borrowRewardsAPR/:lendingPool', bankerJoe.getBorrowRewardsAPR);

// farms info routes
routerV2.get('/farm/list', farm.listPools);
routerV2.get('/farm/poolweight/:lpToken', farm.getPoolWeight);
routerV2.get('/farm/APR/:lpToken', farm.getFarmAPR);
routerV2.get('/farm/liquidity/:lpToken', farm.getFarmLiquidity);
routerV2.get('/farm/bonusAPR/:lpToken', farm.getBonusAPR);

// pools info routes
routerV2.get('/pool/liquidity/:lpToken', pool.getTVLByToken);
routerV2.get('/pool/volume/:lpToken', pool.get24HourTransactionVolume);
routerV2.get('/pool/fees/:lpToken', pool.getTransactionFees);
routerV2.get('/pool/APR/:lpToken', pool.getPoolAPR);

// stake info routes
routerV2.get('/stake/fees', stake.getTotalFees);
routerV2.get('/stake/APR', stake.getAPR);
routerV2.get('/stake/APY', stake.getAPY);

routerV1.get('/', noop);
routerV2.get('/', noop);

module.exports = {
  routerV1,
  routerV2,
};
