'use strict';

async function error(ctx, next) {
  try {
    await next();
  } catch (err) {
    ctx.type = 'json';
    ctx.status = err.statusCode || err.status || 500;
    ctx.body = {
      status: 'error',
    };

    if (ctx.status == 500) {
      ctx.body.message = "Internal Server Error";
    } else {
      ctx.body.message = err.message;
    }
  }
}

module.exports = error;