'use strict';

async function rt(ctx, next) {
  await next();
  ctx.set('X-Powered-By', 'JOE');
}

module.exports = rt;
