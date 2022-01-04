'use strict';

const Router = require('koa-router');
const router = new Router();

const noop = require('./api/noop');
const supply = require('./api/supply');
const nftHat = require('./api/nft/hat');
const price = require('./api/price');
const bankerJoe = require('./api/bankerjoe');
const farm = require('./api/farm');

// supply info routes
router.get('/supply/circulating', supply.circulatingSupply);
router.get('/supply/circulating-adjusted', supply.circulatingSupplyAdjusted);
router.get('/supply/total', supply.totalSupply);
router.get('/supply/max', supply.maxSupply);

// nft info routes
router.get('/nft/hat', nftHat.infos);
router.get('/nft/hat/:id', nftHat.infos)

// token price routes
router.get('/priceavax/:tokenAddress', price.derivedPriceOfToken)
router.get('/priceusd/:tokenAddress', price.priceOfToken)

// banker joe info routes
router.get('/lending/list', bankerJoe.getLendingPools) // TODO: all new routes will have a v2 prefixed to the path
router.get('/lending/supply', bankerJoe.totalSupply)
router.get('/lending/borrow', bankerJoe.totalBorrow)
router.get('/lending/:lendingPool/supplyRateAPY', bankerJoe.getSupplyRateAPY); // v2 route
router.get('/lending/:lendingPool/supplyRewardsAPR', bankerJoe.getSupplyRewardsAPR); // v2 route
router.get('/lending/:lendingPool/borrowRateAPY', bankerJoe.getBorrowRateAPY); // v2 route
router.get('/lending/:lendingPool/borrowRewardsAPR', bankerJoe.getBorrowRewardsAPR); // v2 route

// farms info routes
router.get('/farm/list', farm.listPools); // v2 route

router.get('/', noop);

module.exports = router;
