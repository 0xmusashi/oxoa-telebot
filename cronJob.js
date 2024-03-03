const { sync } = require('./sync');

const schedule = require('node-schedule');

// sync every 45 minutes
const job = schedule.scheduleJob('*/45 * * * *', sync);