const { join } = require('path');

module.exports = async () => {
  console.log(`[after-pack] skipping asarmor (would corrupt app.asar)`);
};
