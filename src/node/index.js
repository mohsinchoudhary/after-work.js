/* eslint no-console: 0, max-len: 0, global-require: 0, import/no-dynamic-require: 0, object-curly-newline: 0 */
const globby = require('globby');
const Mocha = require('mocha');
const chokidar = require('chokidar');
const importCwd = require('import-cwd');
const NYC = require('nyc');
const fs = require('fs');
const path = require('path');
const options = require('./options');

class Runner {
  constructor(argv, libs) {
    this.argv = argv;
    this.files = [];
    this.srcFiles = [];
    this.mochaRunner = undefined;
    this.mocha = undefined;
    this.nyc = undefined;
    this.isFirstRun = true;
    this.libs = libs;
  }
  setFiles() {
    this.files = globby.sync(this.argv.glob).map(f => path.resolve(f));
    if (!this.files.length) {
      console.log('No files found for:', this.argv.glob);
      process.exit(1);
    }
    return this;
  }
  setSrcFiles() {
    this.srcFiles = globby.sync(this.argv.src).map(f => path.resolve(f));
    return this;
  }
  ensureBabelRequire() {
    // We need to remove `babel-register` for coverage since NYC needs to require it for instrumentation
    if (this.argv.coverage && this.argv.nyc.babel && this.argv.require.includes('babel-register')) {
      const ix = this.argv.require.indexOf('babel-register');
      this.argv.require.splice(ix, 1);
    }
    return this;
  }
  require() {
    this.argv.require.forEach(m => this.libs.importCwd(m));
    return this;
  }
  deleteCoverage() {
    delete global.__coverage__; // eslint-disable-line
    return this;
  }
  runTests() {
    this.mochaRunner = this.mocha.run((failures) => {
      process.on('exit', () => {
        process.exit(failures);
      });
    });
    this.mochaRunner.on('end', () => {
      if (this.argv.coverage) {
        this.nyc.writeCoverageFile();
        this.nyc.report();
      }
    });
    return this;
  }
  setup() {
    if (this.argv.coverage) {
      this.nyc.reset();
      if (this.isFirstRun) {
        this.nyc.wrap();
      }
      this.srcFiles.forEach((f) => {
        if (require.cache[f]) {
          delete require.cache[f];
        }
      });
    }
    this.files.forEach((f) => {
      if (require.cache[f]) {
        delete require.cache[f];
      }
      this.mocha.addFile(f);
    });
    if (this.argv.coverage) {
      this.srcFiles.forEach(f => require(`${f}`));
    }
    return this;
  }
  setupAndRunTests() {
    process.removeAllListeners();
    if (this.mochaRunner) {
      this.mochaRunner.removeAllListeners();
    }
    this.mocha = new this.libs.Mocha(this.argv.mocha);
    this.nyc = new this.libs.NYC(this.argv.nyc);
    this
      .deleteCoverage()
      .setup()
      .runTests();
  }
  run() {
    this.setupAndRunTests();
    if (this.argv.watch) {
      this.libs.chokidar.watch(this.argv.watchGlob).on('change', () => {
        this.isFirstRun = false;
        this.setupAndRunTests();
      });
    }
  }
}

const configure = (configPath) => {
  if (configPath === null) {
    return {};
  }
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config ${configPath} not found`);
  }
  let config = {};
  const foundConfig = require(configPath);
  if (typeof foundConfig === 'function') {
    config = Object.assign({}, foundConfig());
  } else {
    config = Object.assign({}, foundConfig);
  }
  return config;
};

const coerceNyc = (opt) => {
  if (opt.babel) {
    opt.require.push('babel-register');
    opt.sourceMap = false;
    opt.instrumenter = './lib/instrumenters/noop';
  }
  return opt;
};

const node = {
  Runner,
  configure,
  coerceNyc,
  command: ['node [options]', '$0'],
  desc: 'Run tests in node',
  builder(yargs) {
    return yargs
      .options(options)
      .config('config', configure)
      .coerce('nyc', coerceNyc);
  },
  handler(argv) {
    const runner = new node.Runner(argv, { Mocha, NYC, importCwd, chokidar });
    runner
      .setFiles()
      .setSrcFiles()
      .ensureBabelRequire()
      .require()
      .run();
    return runner;
  },
};

module.exports = node;


// if (typeof process.stdin.setRawMode === 'function') {
//   process.stdin.setRawMode(true);
//   process.stdin.resume();
//   process.stdin.setEncoding('hex');
//   process.stdin.on('data', (a, b) => {
//     console.log(a, b);
//   });
// }
