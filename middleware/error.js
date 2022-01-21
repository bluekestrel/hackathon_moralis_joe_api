'use strict';

async function error(ctx, next) {
  try {
    await next();
  } catch (err) {
    console.error(err);
    ctx.type = 'json';
    ctx.status = err.statusCode || err.status || 500;
    ctx.body = {
      status: 'error',
    };

    if (ctx.status == 500) {
      ctx.body.result = "Internal Server Error";
    } else {
      ctx.body.result = err.message;
    }
  }
}

module.exports = error;