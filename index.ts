"use strict";

const Koa = require("koa");
const ratelimit = require('koa-ratelimit');
const helmet = require("koa-helmet");
const body = require("koa-bodyparser");
const cors = require("@koa/cors");
const conditional = require("koa-conditional-get");
const etag = require("koa-etag");

const rt = require("./middleware/rt");
const powered = require("./middleware/powered");
const { routerV1, routerV2 } = require("./router");

const index = new Koa();

// setup simple in-memory ratelimit
const db = new Map();
index.use(ratelimit({
  driver: 'memory',
  db: db,
  duration: 60000, // 60 seconds in milliseconds
  errorMessage: 'Rate limit exceeded, please wait one minute',
  id: (ctx) => ctx.ip,
  headers: {
    remaining: 'Rate-Limit-Remaining',
    reset: 'Rate-Limit-Reset',
    total: 'Rate-Limit-Total'
  },
  max: 80, // 80 requests per minute allowed, if new routes are added that allow for multiple
           // values to be requested, the ratelimit should be lowered dramatically
  disableHeader: false,
}));

index.use(rt);
index.use(conditional());
index.use(etag());
index.use(helmet());
index.use(cors({ origin: "*" }));
index.use(powered);
index.use(body());

index.context.cache = {};

index.use(routerV1.routes());
index.use(routerV1.allowedMethods());
index.use(routerV2.routes());
index.use(routerV2.allowedMethods());

const port = process.env.PORT || 3000;
index.listen(port);
console.log(`> joe-api running! (:${port})`);
