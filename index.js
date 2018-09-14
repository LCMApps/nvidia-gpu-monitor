'use strict';

const EventEmitter = require('events');
const spawn = require('child_process').spawn;
const readline = require('readline');

const GpuUtilization = require('./src/GpuUtilization');
const GpuUtilizationSma = require('./src/GpuUtilizationSma');
const NvidiaGpuInfo = require('./src/NvidiaGpuInfo');

const DEFAULT_RESTART_TIMEOUT_MSEC = 1000;
const STAT_GRAB_PATTERN = new RegExp(
    '(\\d+)\\s+(\\d+)\\s+\\d+\\s+\\d+\\s+\\d+\\s+(\\d+)\\s+(\\d+)',
    'g'
);

/**
 * @emits NvidiaGpuMonitor#healthy
 * @emits NvidiaGpuMonitor#unhealhy
 * @emits NvidiaGpuMonitor#error
 * @emits NvidiaGpuMonitor#stopped
 */
class NvidiaGpuMonitor extends EventEmitter {
    static get STATUS_STOPPED() {
        return 1;
    }

    static get STATUS_STARTED() {
        return 2;
    }

    static get STATUS_STOPPING() {
        return 3;
    }

    /**
     * @param {string} nvidiaSmiPath
     * @param {number} checkIntervalSec
     * @param {Object} mem
     * @param {Object} decoder
     * @param {Object} encoder
     */
    constructor({nvidiaSmiPath, checkIntervalSec, mem, decoder, encoder}) {
        super();

        if (typeof nvidiaSmiPath !== 'string') {
            throw new TypeError('field "nvidiaSmiPath" is required and must be a string');
        }

        if (!Number.isSafeInteger(checkIntervalSec) || checkIntervalSec < 1) {
            throw new TypeError('field "checkIntervalSec" is required and must be an integer and not less than 1');
        }

        this._nvidiaSmiPath = nvidiaSmiPath;
        this._checkInterval = checkIntervalSec;
        this._isMemOverloaded = undefined;

        this._initMemChecks(mem);
        const encoderCheckers = this._initCoreUtilizationChecks(encoder, 'encoder');
        const decoderCheckers = this._initCoreUtilizationChecks(decoder, 'decoder');

        this._encoderUsageCalculator = encoderCheckers.usageCalculator;
        this._isEncoderOverloaded = encoderCheckers.usageOverloadedChecker;
        this._decoderUsageCalculator = decoderCheckers.usageCalculator;
        this._isDecoderOverloaded = decoderCheckers.usageOverloadedChecker;

        this._status = NvidiaGpuMonitor.STATUS_STOPPED;
        this._dmonWatcher = undefined;
        this._restartTimer = undefined;
        this._healthyTimer = undefined;
        this._healthy = false;

        this._nvidiaGpuInfo = new NvidiaGpuInfo(nvidiaSmiPath);
        this._coreNumbers = new Set();
        this._tmpCoreNumbers = new Set();
        this._gpuCoresMem = {};
        this._gpuEncodersUsage = {};
        this._gpuDecodersUsage = {};
        this._gpuEncodersUtilization = {};
        this._gpuDecodersUtilization = {};
        this._isOverloaded = true;

        this._watcherErrorHandler = this._watcherErrorHandler.bind(this);
        this._watcherExitHandler = this._watcherExitHandler.bind(this);
        this._processGpuCoreInfo = this._processGpuCoreInfo.bind(this);
        this._runNvidiaSmiWatcher = this._runNvidiaSmiWatcher.bind(this);
    }

    /**
     * @throws {Error}
     */
    async start() {
        if (this._status !== NvidiaGpuMonitor.STATUS_STOPPED) {
            throw new Error('NvidiaGpuMonitor service is already started');
        }

        await this._nvidiaGpuInfo.parseGpuMetaData();
        this._runNvidiaSmiWatcher();

        this._healthy = true;
        this._status = NvidiaGpuMonitor.STATUS_STARTED;

        return this._nvidiaGpuInfo.getCoreNumbers();
    }

    stop() {
        if (this._status === NvidiaGpuMonitor.STATUS_STOPPED) {
            return;
        }

        if (this._healthyTimer !== undefined) {
            clearTimeout(this._healthyTimer);
            this._healthyTimer = undefined;
        }

        this._healthy = false;

        if (this._restartTimer !== undefined) {
            clearTimeout(this._restartTimer);
            this._restartTimer = undefined;
            this._status = NvidiaGpuMonitor.STATUS_STOPPED;
            this.emit('stopped');
        } else {
            this._status = NvidiaGpuMonitor.STATUS_STOPPING;
            this._dmonWatcher.kill();
        }
    }

    /**
     * @returns {boolean}
     */
    isWatchHealthy() {
        if (this._status === NvidiaGpuMonitor.STATUS_STOPPED) {
            throw new Error('NvidiaGpuMonitor service is not started');
        }

        return this._healthy;
    }

    /**
     * @returns {Array}
     * @throws {Error}
     */
    getGpuStatistic() {
        if (this._status === NvidiaGpuMonitor.STATUS_STOPPED) {
            throw new Error('NvidiaGpuMonitor service is not started');
        }

        const output = [];

        for (const coreNumber of this._coreNumbers.values()) {
            output.push({
                core: coreNumber,
                mem: {
                    free: this._gpuCoresMem[coreNumber].free
                },
                usage: {
                    enc: this._gpuEncodersUsage[coreNumber],
                    dec: this._gpuDecodersUsage[coreNumber]
                }
            });
        }

        return output;
    }

    /**
     * @returns {boolean}
     * @throws {Error}
     */
    isOverloaded() {
        if (this._status === NvidiaGpuMonitor.STATUS_STOPPED) {
            throw new Error('NvidiaGpuMonitor service is not started');
        }

        return this._isOverloaded;
    }

    /**
     * @returns {string}
     * @throws {Error}
     */
    getGpuDriverVersion() {
        if (this._status === NvidiaGpuMonitor.STATUS_STOPPED) {
            throw new Error('NvidiaGpuMonitor service is not started');
        }

        return this._nvidiaGpuInfo.getDriverVersion();
    }

    /**
     * @returns {Object}
     * @throws {Error}
     */
    getGpuProductsName() {
        if (this._status === NvidiaGpuMonitor.STATUS_STOPPED) {
            throw new Error('NvidiaGpuMonitor service is not started');
        }

        return this._nvidiaGpuInfo.getProductNames();
    }

    /**
     * @throws {Error}
     */
    _runNvidiaSmiWatcher() {
        this._dmonWatcher = spawn(this._nvidiaSmiPath, ['dmon', '-d', this._checkInterval, '-s', 'mu']);

        this._dmonWatcher.on('error', this._watcherErrorHandler);
        this._dmonWatcher.on('exit', this._watcherExitHandler);
        this._dmonWatcher.stdout.setEncoding('utf8');

        this._readLineInterface = readline.createInterface({
            input: this._dmonWatcher.stdout,
            crlfDelay: Infinity
        });

        this._readLineInterface.on('line', this._processGpuCoreInfo);
    }

    /**
     * @param {Error} err
     */
    _watcherErrorHandler(err) {
        this._healthy = false;

        this.emit('error', err);
        this.emit('unhealthy');
    }

    /**
     * @param {number} code
     * @param {string} signal
     */
    _watcherExitHandler(code, signal) {
        this._healthy = false;
        this._dmonWatcher.stdout.removeAllListeners();

        this._dmonWatcher.stdin.destroy();
        this._dmonWatcher.stdout.destroy();
        this._dmonWatcher.stderr.destroy();

        if(this._status !== NvidiaGpuMonitor.STATUS_STOPPING) {
            this._restartTimer = setTimeout(this._runNvidiaSmiWatcher, DEFAULT_RESTART_TIMEOUT_MSEC);

            const message = '"nvidia-smi dmon" finished with ' + (code !== null ? `code ${code}` : `signal ${signal}`);
            this.emit('error', new Error(message));
            this.emit('unhealthy');
        } else {
            this._status = NvidiaGpuMonitor.STATUS_STOPPED;
            this.emit('stopped');
        }
    }

    /**
     * @params {string} watcherOutput
     */
    async _processGpuCoreInfo(coreInfo) {
        if (this._healthyTimer !== undefined) {
            clearTimeout(this._healthyTimer);
            this._healthyTimer = undefined;
        }

        const matchResult = STAT_GRAB_PATTERN.exec(coreInfo);
        if (matchResult !== null) {
            STAT_GRAB_PATTERN.lastIndex = 0;

            const coreNumber = Number.parseInt(matchResult[1], 10);
            const totalMem = this._nvidiaGpuInfo.getTotalMemory(coreNumber);
            const usedMem = Number.parseInt(matchResult[2], 10);

            this._gpuCoresMem[coreNumber] = {
                total: totalMem,
                free: totalMem - usedMem
            };

            if (this._tmpCoreNumbers.has(coreNumber)) {
                this._coreNumbers = this._tmpCoreNumbers;
                this._tmpCoreNumbers = new Set();
                this._processCoresStatistic();
            }

            this._gpuEncodersUtilization[coreNumber] = Number.parseInt(matchResult[3], 10);
            this._gpuDecodersUtilization[coreNumber] = Number.parseInt(matchResult[4], 10);
            this._tmpCoreNumbers.add(coreNumber);

            if (this._tmpCoreNumbers.size === this._nvidiaGpuInfo.getCoreNumbers().length) {
                this._coreNumbers = this._tmpCoreNumbers;
                this._tmpCoreNumbers = new Set();
                this._processCoresStatistic();
            }

            if (!this._healthy) {
                this._healthy = true;
                this.emit('healthy');
            }
        }

        this._healthyTimer = setTimeout(() => {
            this._healthy = false;
            this.emit('unhealthy');
        }, this._checkInterval * 2 * 1000);
    }

    _processCoresStatistic() {
        this._gpuEncodersUsage = this._encoderUsageCalculator.getUsage(this._gpuEncodersUtilization);
        this._gpuDecodersUsage = this._decoderUsageCalculator.getUsage(this._gpuDecodersUtilization);
        this._gpuEncodersUtilization = {};
        this._gpuDecodersUtilization = {};
        this._isOverloaded = this._isMemOverloaded(this._gpuCoresMem)
            || this._isEncoderOverloaded(this._gpuEncodersUsage)
            || this._isDecoderOverloaded(this._gpuDecodersUsage);
    }

    /**
     * @param {number} free
     * @param {number} total
     * @returns {boolean}
     */
    _isMemOverloadedByIncorrectData(free, total) {
        return free < 0 || total < 0;
    }

    /**
     * @param {number} minFree
     * @param {Object} coresMemCollection
     * @returns {boolean}
     */
    _isMemOverloadedByFixedThreshold(minFree, coresMemCollection) {
        for (const coreNumber in coresMemCollection) {
            const {free, total} = coresMemCollection[coreNumber];
            if (this._isMemOverloadedByIncorrectData(free, total) || free < minFree) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param {number} highWatermark
     * @param {Object} coresMemCollection
     * @returns {boolean}
     */
    _isMemOverloadedByRateThreshold(highWatermark, coresMemCollection) {
        for (const coreNumber in coresMemCollection) {
            const {free, total} = coresMemCollection[coreNumber];
            if (this._isMemOverloadedByIncorrectData(free, total) || ((total - free) / total) > highWatermark) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param {number} highWatermark
     * @param {Object} coresUsageCollection
     * @returns {boolean}
     * @private
     */
    _isGpuUsageOverloadByRateThreshold(highWatermark, coresUsageCollection) {
        for (const coreNumber in coresUsageCollection) {
            if ((highWatermark * 100) < coresUsageCollection[coreNumber]) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param {Object} mem
     * @param {string} mem.thresholdType
     */
    _initMemChecks(mem) {
        if (typeof mem !== 'object' || mem === null) {
            throw new TypeError('field "mem" is required and must be an object');
        }

        if (mem.thresholdType === 'fixed') {
            if (!Number.isSafeInteger(mem.minFree) || mem.minFree <= 0) {
                throw new TypeError('"mem.minFree" field is required for threshold = fixed and must be more than 0');
            }

            this._isMemOverloaded = this._isMemOverloadedByFixedThreshold.bind(this, mem.minFree);
        } else if (mem.thresholdType === 'rate') {
            if (!Number.isFinite(mem.highWatermark) || mem.highWatermark <= 0 || mem.highWatermark >= 1) {
                throw new TypeError(
                    '"mem.highWatermark" field is required for threshold = "rate" and must be in range (0;1)'
                );
            }

            this._isMemOverloaded = this._isMemOverloadedByRateThreshold.bind(this, mem.highWatermark);
        } else if (mem.thresholdType === 'none') {
            this._isMemOverloaded = this._isMemOverloadedByIncorrectData;
        } else {
            throw new TypeError('"mem.thresholdType" is not set or has invalid type');
        }
    }

    /**
     * @param {Object} config
     * @param {string} config.calculationAlgo
     * @param {string} config.thresholdType
     * @param {string} utilizationParameter
     * @returns {{usageCalculator, usageOverloadedChecker}}
     */
    _initCoreUtilizationChecks(config, utilizationParameter) {
        let usageCalculator;
        let usageOverloadedChecker;

        if (typeof config !== 'object' || config === null) {
            throw new TypeError(`field "${utilizationParameter}" is required and must be an object`);
        }

        if (config.calculationAlgo === 'sma') {
            if (!Number.isSafeInteger(config.periodPoints) || config.periodPoints <= 1) {
                throw new TypeError(
                    `"${utilizationParameter}.periodPoints" field is required for SMA algorithm`
                    + ' and must be more than 1'
                );
            }
            usageCalculator = new GpuUtilizationSma(config.periodPoints);
        } else if (config.calculationAlgo === 'last_value') {
            usageCalculator = new GpuUtilization();
        } else {
            throw new TypeError(`"${utilizationParameter}.calculationAlgo" is not set or has invalid type`);
        }

        if (config.thresholdType === 'rate') {
            if (!Number.isFinite(config.highWatermark) || config.highWatermark <= 0 || config.highWatermark >= 1) {
                throw new TypeError(
                    `"${utilizationParameter}.highWatermark" field is required for threshold = "rate"`
                    + ' and must be in range (0,1)'
                );
            }

            usageOverloadedChecker = this._isGpuUsageOverloadByRateThreshold.bind(
                null,
                config.highWatermark
            );
        } else if (config.thresholdType === 'none') {
            usageOverloadedChecker = () => false;
        } else {
            throw new TypeError(`"${utilizationParameter}.thresholdType" is not set or has invalid type`);
        }

        return {usageCalculator, usageOverloadedChecker};
    }
}

module.exports = NvidiaGpuMonitor;
