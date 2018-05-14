'use strict';

const EventEmitter = require('events');
const spawn = require('child_process').spawn;

const GpuUtilization = require('./lib/GpuUtilization');
const GpuUtilizationSma = require('./lib/GpuUtilizationSma');
const NvidiaGpuInfo = require('./lib/NvidiaGpuInfo');

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
        this._prevWatcherOutput = '';

        this._nvidiaGpuInfo = new NvidiaGpuInfo(nvidiaSmiPath);
        this._gpuCoresNumber = new Set();
        this._gpuCoresMem = {};
        this._gpuEncodersUsage = {};
        this._gpuDecodersUsage = {};
        this._isOverloaded = true;
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
    }

    /**
     * @throws {Error}
     */
    stop() {
        if (this._status !== NvidiaGpuMonitor.STATUS_STARTED) {
            throw new Error('NvidiaGpuMonitor service is not running');
        }

        this._status = NvidiaGpuMonitor.STATUS_STOPPING;

        if (this._healthyTimer !== undefined) {
            clearTimeout(this._healthyTimer);
        }

        if (this._restartTimer !== undefined) {
            clearTimeout(this._restartTimer);
            this._restartTimer = undefined;
        } else {
            this._dmonWatcher.kill('SIGTERM');
            this._healthy = false;
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

        for (const coreNumber of this._gpuCoresNumber) {
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

     *
     * this._readGpuStatData()
     *
     * @returns {string}
     * @throws {Error}
     */
    async _runNvidiaSmiWatcher() {
        this._dmonWatcher = spawn(this._nvidiaSmiPath, ['dmon', '-d', this._checkInterval, '-s', 'mu']);

        this._dmonWatcher.on('error', this._watcherErrorHandler);
        this._dmonWatcher.on('exit', this._watcherExitHandler);
        this._dmonWatcher.stdout.setEncoding('utf8');
        this._dmonWatcher.stdout.on('data', this._processWatcherData);
    }

    _watcherErrorHandler(err) {
        this._healthy = false;

        this.emit('error', err);
        this.emit('unhealthy');
    }

    _watcherExitHandler(code, signal) {
        this._healthy = false;
        this._dmonWatcher.stdout.removeAllListeners();

        this._dmonWatcher.stdin.destroy();
        this._dmonWatcher.stdout.destroy();
        this._dmonWatcher.stderr.destroy();


        if (this._status !== NvidiaGpuMonitor.STATUS_STOPPING) {
            this._restartTimer = setTimeout(() => this._runNvidiaSmiWatcher(), DEFAULT_RESTART_TIMEOUT_MSEC);

            const message = '"nvidia-smi dmon" finished with ' + code !== null ? `code ${code}` : `signal ${signal}`;
            this.emit('error', new Error(message));
            this.emit('unhealthy');
        } else {
            this._status = NvidiaGpuMonitor.STATUS_STOPPED;
            this.emit('stopped');
        }
    }

    /**
     * @example
     * //watcherOutput
     * # gpu    fb  bar1    sm   mem   enc   dec
     * # Idx    MB    MB     %     %     %     %
     *     0     0     2     0     0     0     0
     *     1     0     2     0     0     0     0
     *     2     0     2     0     0     0     0
     *     3     0     2     0     0     0     0
     *
     *
     * @params {string} watcherOutput
     */
    async _processWatcherData(watcherOutput) {
        const gpuCoresNumber = new Set();
        const gpuCoresMem = {};
        const gpuEncodersUtilization = {};
        const gpuDecodersUtilization = {};

        if (this._healthyTimer !== undefined) {
            clearTimeout(this._healthyTimer);
            this._healthyTimer = undefined;
        }

        if (this._prevWatcherOutput.length !== 0) {
            watcherOutput = this._prevWatcherOutput + watcherOutput;
            this._prevWatcherOutput = '';
        }

        let regExpLastIndex = 0;
        let matchResult;
        while ((matchResult = STAT_GRAB_PATTERN.exec(watcherOutput)) !== null) {
            regExpLastIndex = STAT_GRAB_PATTERN.lastIndex;
            const coreNumber = Number.parseInt(matchResult[1]);

            if (this._nvidiaGpuInfo.hasCoreNumber(coreNumber)) {
                const totalMem = this._nvidiaGpuInfo.getTotalMemory(coreNumber);
                const usedMem = Number.parseInt(matchResult[2]);

                gpuCoresNumber.add(coreNumber);
                gpuCoresMem[coreNumber] = {
                    total: totalMem,
                    free: totalMem - usedMem
                };
                gpuEncodersUtilization[coreNumber] = Number.parseInt(matchResult[3]);
                gpuDecodersUtilization[coreNumber] = Number.parseInt(matchResult[4]);
            }
        }

        if (regExpLastIndex !== watcherOutput.length) {
            this._prevWatcherOutput = watcherOutput;
        }

        this._gpuCoresNumber = gpuCoresNumber;

        if (gpuCoresNumber.size !== this._nvidiaGpuInfo.getCoreNumbers().length) {
            this._nvidiaGpuInfo.parseGpuMetaData()
                .catch(err => {
                    if (this._status !== NvidiaGpuMonitor.STATUS_STOPPED) {
                        this.emit('error', err);
                    }
                });
        } else {
            this._processCoresStatistic(gpuCoresMem, gpuEncodersUtilization, gpuDecodersUtilization);

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

    /**
     * @param {Object} gpuCoresMem
     * @param {Object} gpuEncodersUtilization
     * @param {Object} gpuDecodersUtilization
     */
    _processCoresStatistic(gpuCoresMem, gpuEncodersUtilization, gpuDecodersUtilization) {
        this._gpuCoresMem = gpuCoresMem;
        this._gpuEncodersUsage = this._encoderUsageCalculator.getUsage(gpuEncodersUtilization);
        this._gpuDecodersUsage = this._decoderUsageCalculator.getUsage(gpuDecodersUtilization);
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
        for (const pciId in coresMemCollection) {
            const {free, total} = coresMemCollection[pciId];
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
        for (const pciId in coresMemCollection) {
            const {free, total} = coresMemCollection[pciId];
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
        for (const pciId in coresUsageCollection) {
            if ((highWatermark * 100) < coresUsageCollection[pciId]) {
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
