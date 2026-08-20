const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('server.js', 'utf8');
new vm.Script(source);
console.log('server.js syntax OK');
