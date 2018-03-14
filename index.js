'use strict';

const exec = require('child_process').exec;
const promisify = require('util').promisify;

const GpuUtilization = require('./lib/GpuUtilization');
const GpuUtilizationSma = require('./lib/GpuUtilizationSma');
const NvidiaGpuInfo = require('./lib/NvidiaGpuInfo');

const execAsync = promisify(exec);

const STAT_GRAB_PATTERN = new RegExp(
    'GPU (\\d+:\\d+:\\d+.\\d+)[\\s\\S]+?'
    + 'FB Memory Usage\\s+Total\\s+:\\s*(\\d+) MiB\\s+Used\\s+:\\s*\\d+ MiB\\s+Free\\s+:\\s*(\\d+) MiB[\\s\\S]+?'
    + 'Encoder\\s*:\\s*(\\d+)\\s*%[\\s\\S]+?'
    + 'Decoder\\s*:\\s*(\\d+)\\s*%',
    'g'
);

class NvidiaGpuMonitor {
    static get STATUS_STOPPED() {
        return 1;
    }

    static get STATUS_STARTED() {
        return 2;
    }

    /**
     * @param {string} nvidiaSmiPath
     * @param {number} checkInterval
     * @param {Object} mem
     * @param {Object} decoder
     * @param {Object} encoder
     */
    constructor({nvidiaSmiPath, checkInterval, mem, decoder, encoder}) {
        if (typeof nvidiaSmiPath !== 'string') {
            throw new TypeError('field "nvidiaSmiPath" is required and must be a string');
        }

        if (!Number.isSafeInteger(checkInterval) || checkInterval < 1) {
            throw new TypeError('field "checkInterval" is required and must be an integer and not less than 1');
        }

        this._nvidiaSmiPath = nvidiaSmiPath;
        this._checkInterval = checkInterval;
        this._isMemOverloaded = undefined;

        this._initMemChecks(mem);
        const encoderCheckers = this._initCoreUtilizationChecks(encoder, 'encoder');
        const decoderCheckers = this._initCoreUtilizationChecks(decoder, 'decoder');

        this._encoderUsageCalculator = encoderCheckers.usageCalculator;
        this._isEncoderOverloaded = encoderCheckers.usageOverloadedChecker;
        this._decoderUsageCalculator = decoderCheckers.usageCalculator;
        this._isDecoderOverloaded = decoderCheckers.usageOverloadedChecker;

        this._status = NvidiaGpuMonitor.STATUS_STOPPED;

        this._nvidiaGpuInfo = new NvidiaGpuInfo(nvidiaSmiPath);
        this._gpuPciIdList = [];
        this._gpuCoresMem = {};
        this._gpuEncodersUsage = {};
        this._gpuDecodersUsage = {};
        this._isOverloaded = true;

        this._monitorScheduler = undefined;
    }

    /**
     * @throws {Error}
     */
    async start() {
        if (this._status === NvidiaGpuMonitor.STATUS_STARTED) {
            throw new Error('NvidiaGpuMonitor service is already started');
        }

        await this._nvidiaGpuInfo.parseGpuMetaData();
        await this._determineCoresStatistic();

        this._monitorScheduler = setInterval(() => this._determineCoresStatistic(), this._checkInterval);
        this._status = NvidiaGpuMonitor.STATUS_STARTED;
    }

    /**
     * @throws {Error}
     */
    stop() {
        if (this._status === NvidiaGpuMonitor.STATUS_STOPPED) {
            throw new Error('NvidiaGpuMonitor service is not started');
        }

        clearInterval(this._monitorScheduler);

        this._status = NvidiaGpuMonitor.STATUS_STOPPED;
    }

    /**
     * @returns {Array}
     * @throws {Error}
     */
    getGpuStatistic() {
        if (this._status === NvidiaGpuMonitor.STATUS_STOPPED) {
            throw new Error('NvidiaGpuMonitor service is not started');
        }

        const gpuStat = [];

        for (const pciId of this._gpuPciIdList) {
            gpuStat.push({
                core: this._nvidiaGpuInfo.getCoreNumber(pciId),
                mem: {
                    free: this._gpuCoresMem[pciId].free
                },
                usage: {
                    enc: this._gpuEncodersUsage[pciId],
                    dec: this._gpuDecodersUsage[pciId]
                }
            });
        }

        return gpuStat;
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

        return this._nvidiaGpuInfo.getProductsName();
    }

    /**
     * @example
     * // returns
     *   Timestamp                           : Tue Feb 20 15:26:54 2018
     *   Driver Version                      : 384.11
     *
     *   Attached GPUs                       : 4
     *   GPU 00000000:06:00.0
     *   FB Memory Usage
     *   Total                       : 8123 MiB
     *   Used                        : 149 MiB
     *   Free                        : 7974 MiB
     *   BAR1 Memory Usage
     *   Total                       : 256 MiB
     *   Used                        : 2 MiB
     *   Free                        : 254 MiB
     *   Utilization
     *   Gpu                         : 13 %
     *   Memory                      : 10 %
     *   Encoder                     : 42 %
     *   Decoder                     : 24 %
     *   GPU Utilization Samples
     *   Duration                    : 18446744073709.22 sec
     *   Number of Samples           : 99
     *   Max                         : 15 %
     *   Min                         : 0 %
     *   Avg                         : 0 %
     *   Memory Utilization Samples
     *   Duration                    : 18446744073709.22 sec
     *   Number of Samples           : 99
     *   Max                         : 10 %
     *   Min                         : 0 %
     *   Avg                         : 0 %
     *   ENC Utilization Samples
     *   Duration                    : 18446744073709.22 sec
     *   Number of Samples           : 99
     *   Max                         : 42 %
     *   Min                         : 0 %
     *   Avg                         : 0 %
     *   DEC Utilization Samples
     *   Duration                    : 18446744073709.22 sec
     *   Number of Samples           : 99
     *   Max                         : 24 %
     *   Min                         : 0 %
     *   Avg                         : 0 %
     *   Processes
     *   Process ID                  : 74920
     *   Type                    : C
     *   Name                    : ffmpeg
     *   Used GPU Memory         : 138 MiB
     *
     * this._readGpuStatData()
     *
     * @returns {string}
     * @throws {Error}
     */
    async _readGpuStatData() {
        const {stdout} = await execAsync(`${this._nvidiaSmiPath} -q -d UTILIZATION,MEMORY`);

        return stdout;
    }

    /**
     * @throws {Error}
     */
    async _parseGpuStat() {
        let gpuStat;
        let wasError = false;

        try {
            gpuStat = await this._readGpuStatData();
        } catch (err) {
            wasError = true;
        }

        const gpuPciIdList = [];
        const gpuCoresMem = {};
        const gpuEncodersUtilization = {};
        const gpuDecodersUtilization = {};

        if (!wasError) {
            let matchResult;
            while ((matchResult = STAT_GRAB_PATTERN.exec(gpuStat)) !== null) {
                if (matchResult[1] !== undefined && this._nvidiaGpuInfo.getCoreNumber(matchResult[1]) !== undefined) {
                    const pciId = matchResult[1];
                    const totalMem = Number.parseInt(matchResult[2]);
                    const freeMem = Number.parseInt(matchResult[3]);
                    const encoderUtilization = Number.parseInt(matchResult[4]);
                    const decoderUtilization = Number.parseInt(matchResult[5]);

                    if (
                        Number.isInteger(totalMem) && Number.isInteger(freeMem) && Number.isInteger(encoderUtilization)
                        && Number.isInteger(decoderUtilization)
                    ) {
                        gpuPciIdList.push(pciId);
                        gpuCoresMem[pciId] = {};
                        gpuCoresMem[pciId].total = totalMem;
                        gpuCoresMem[pciId].free = freeMem;
                        gpuEncodersUtilization[pciId] = encoderUtilization;
                        gpuDecodersUtilization[pciId] = decoderUtilization;
                    }
                }
            }
        }

        return {
            gpuPciIdList,
            gpuCoresMem,
            gpuEncodersUtilization,
            gpuDecodersUtilization
        };
    }

    /**
     * @throws {Error}
     */
    async _determineCoresStatistic() {
        const {
            gpuPciIdList,
            gpuCoresMem,
            gpuEncodersUtilization,
            gpuDecodersUtilization
        } = await this._parseGpuStat();

        this._gpuPciIdList = gpuPciIdList;
        this._gpuCoresMem = gpuCoresMem;
        this._gpuEncodersUsage = this._encoderUsageCalculator.getUsage(gpuEncodersUtilization);
        this._gpuDecodersUsage = this._decoderUsageCalculator.getUsage(gpuDecodersUtilization);
        this._isOverloaded = this._isMemOverloaded(gpuCoresMem)
            || this._isEncoderOverloaded(gpuEncodersUtilization)
            || this._isDecoderOverloaded(gpuDecodersUtilization);
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
