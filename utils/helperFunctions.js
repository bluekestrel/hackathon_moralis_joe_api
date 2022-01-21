const {
  BN_1,
  DAYS_PER_YEAR,
  SECONDS_PER_YEAR,
} = require("../constants");

function calculateAPYDailyCompund(percentAPR) {
  // given APR (as a percentage) calculate and return APY (compounded daily)
  const APR = percentAPR.div(100);
  const APY = ((BN_1.plus(APR.div(DAYS_PER_YEAR))).pow(DAYS_PER_YEAR)).minus(BN_1);
  return APY.times(100);
}

function calculateAPYSecondsCompund(percentAPR) {
  // given APR (as a percentage) calculate and return APY (compounded every second)
  const APR = percentAPR.div(100);
  const APY = ((BN_1.plus(APR.div(SECONDS_PER_YEAR))).pow(SECONDS_PER_YEAR)).minus(BN_1);
  return APY.times(100);
}

function formatResults(status, result) {
  return {
    status,
    result,
  };
}

module.exports = {
  calculateAPYDailyCompund,
  calculateAPYSecondsCompund,
  formatResults,
};
