'use strict';

const exec = require('child_process').exec;
const promisify = require('util').promisify;

const GpuUtilization = require('./lib/GpuUtilization');
const GpuUtilizationSma = require('./lib/GpuUtilizationSma');
const NvidiaGpuInfo = require('./lib/NvidiaGpuInfo');

const execAsync = promisify(exec);

const STAT_GRAB_PATTERN = new RegExp(
    'GPU (\\d+:\\d+:\\d+.\\d+)[\\s\\S]+?'
    + 'FB Memory Usage\\s+Total\\s+: (\\d+) MiB\\s+Used\\s+: \\d+ MiB\\s+Free\\s+: (\\d+) MiB[\\s\\S]+?'
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
            throw new TypeError('field `nvidiaSmiPath` is required and must be a string');
        }

        if (!Number.isSafeInteger(checkInterval) || checkInterval < 1) {
            throw new TypeError('field `checkInterval` is required and must be an integer and more than 1');
        }

        this._nvidiaSmiPath = nvidiaSmiPath;
        this._checkInterval = checkInterval;

        this._isMemOverloaded = undefined;
        this._isEncoderOverloaded = undefined;
        this._isDecoderOverloaded = undefined;
        this._decoderUsageCalculator = undefined;
        this._encoderUsageCalculator = undefined;

        this._initMemChecks(mem);
        this._initDecoderChecks(decoder);
        this._initEncoderChecks(encoder);

        this._status = NvidiaGpuMonitor.STATUS_STOPPED;

        this._nvidiaGpuInfo = new NvidiaGpuInfo(nvidiaSmiPath);
        this._gpuMetaInfo = Object.create(null);
        this._gpuCoresMem = {};
        this._gpuEncodersUsage = {};
        this._gpuDecodersUsage = {};
        this._gpuEncodersUtilization = {};
        this._gpuDecodersUtilization = {};
        this._isOverloaded = true;

        this._monitorScheduler = undefined;
    }

    async start() {
        if (this._status === NvidiaGpuMonitor.STATUS_STARTED) {
            throw new Error('NvidiaGpuMonitor service is already started');
        }

        await this._nvidiaGpuInfo.parseGpuMetaData();
        await this._determineCoresStatistic();

        this._monitorScheduler = setInterval(() => this._determineCoresStatistic(), this._checkInterval);
        this._status = NvidiaGpuMonitor.STATUS_STARTED;
    }

    stop() {
        if (this._status === NvidiaGpuMonitor.STATUS_STOPPED) {
            throw new Error('NvidiaGpuMonitor service is not started');
        }

        clearInterval(this._monitorScheduler);

        this._status = NvidiaGpuMonitor.STATUS_STOPPED;
    }

    /**
     * @returns {Array}
     */
    getGpuStat() {
        if (this._status === NvidiaGpuMonitor.STATUS_STOPPED) {
            throw new Error('NvidiaGpuMonitor service is not started');
        }

        const gpuStat = [];

        for (const coreId in this._nvidiaGpuInfo.getCoreId2NumberHash()) {
            gpuStat.push({
                core: this._nvidiaGpuInfo.getCoreNumberById(coreId),
                mem: {
                    free: this._gpuCoresMem[coreId].free
                },
                usage: {
                    enc: this._gpuEncodersUsage[coreId],
                    dec: this._gpuDecodersUsage[coreId]
                }
            });
        }

        return gpuStat;
    }

    /**
     * @returns {Object}
     */
    getGpuMetaInfo() {
        if (this._status === NvidiaGpuMonitor.STATUS_STOPPED) {
            throw new Error('NvidiaGpuMonitor service is not started');
        }

        return this._gpuMetaInfo;
    }

    /**
     * @returns {boolean}
     */
    isOverloaded() {
        if (this._status === NvidiaGpuMonitor.STATUS_STOPPED) {
            throw new Error('NvidiaGpuMonitor service is not started');
        }

        return this._isOverloaded;
    }

    /**
     * @returns {string}
     */
    getGpuDriverVersion() {
        if (this._status === NvidiaGpuMonitor.STATUS_STOPPED) {
            throw new Error('NvidiaGpuMonitor service is not started');
        }

        return this._nvidiaGpuInfo.getDriverVersion();
    }

    /**
     * @returns {string}
     */
    getGpuProductName() {
        if (this._status === NvidiaGpuMonitor.STATUS_STOPPED) {
            throw new Error('NvidiaGpuMonitor service is not started');
        }

        return this._nvidiaGpuInfo.getProductName();
    }

    /**
     * @returns {string}
     */
    async _readGpuStatData() {
        const {stdout} = await execAsync(`${this._nvidiaSmiPath} -q -d UTILIZATION,MEMORY`);

        return stdout;
    }

    /*
    Timestamp                           : Tue Feb 20 15:26:54 2018
    Driver Version                      : 384.111

    Attached GPUs                       : 4
    GPU 00000000:06:00.0
        FB Memory Usage
            Total                       : 8123 MiB
            Used                        : 149 MiB
            Free                        : 7974 MiB
        BAR1 Memory Usage
            Total                       : 256 MiB
            Used                        : 2 MiB
            Free                        : 254 MiB
        Utilization
            Gpu                         : 13 %
            Memory                      : 10 %
            Encoder                     : 42 %
            Decoder                     : 24 %
        GPU Utilization Samples
            Duration                    : 18446744073709.22 sec
            Number of Samples           : 99
            Max                         : 15 %
            Min                         : 0 %
            Avg                         : 0 %
        Memory Utilization Samples
            Duration                    : 18446744073709.22 sec
            Number of Samples           : 99
            Max                         : 10 %
            Min                         : 0 %
            Avg                         : 0 %
        ENC Utilization Samples
            Duration                    : 18446744073709.22 sec
            Number of Samples           : 99
            Max                         : 42 %
            Min                         : 0 %
            Avg                         : 0 %
        DEC Utilization Samples
            Duration                    : 18446744073709.22 sec
            Number of Samples           : 99
            Max                         : 24 %
            Min                         : 0 %
            Avg                         : 0 %
        Processes
            Process ID                  : 74920
                Type                    : C
                Name                    : ffmpeg
                Used GPU Memory         : 138 MiB
     */
    async _parseGpuStat() {
        let gpuStat;
        let wasError = false;

        try {
            gpuStat = await this._readGpuStatData();
        } catch (err) {
            wasError = true;
            return;
        }

        // Set default values
        for (const coreId in this._nvidiaGpuInfo.getCoreId2NumberHash()) {
            this._gpuCoresMem[coreId] = {
                total: -1,
                free: -1
            };
            this._gpuEncodersUtilization[coreId] = 100;
            this._gpuDecodersUtilization[coreId] = 100;
        }

        if (wasError) {
            return;
        }

        let matchResult;
        while ((matchResult = STAT_GRAB_PATTERN.exec(gpuStat)) !== null) {
            if (matchResult[1] !== undefined) {
                const totalMem = Number.parseInt(matchResult[2]);
                const freeMem = Number.parseInt(matchResult[3]);
                const encoderUtilization = Number.parseInt(matchResult[4]);
                const decoderUtilization = Number.parseInt(matchResult[5]);

                if (Number.isInteger(totalMem)) {
                    this._gpuCoresMem[matchResult[1]].mem.total = totalMem;
                }
                if (Number.isInteger(freeMem)) {
                    this._gpuCoresMem[matchResult[1]].mem.free = freeMem;
                }
                if (Number.isInteger(encoderUtilization)) {
                    this._gpuCoresMem[matchResult[1]].encoder = encoderUtilization;
                }
                if (Number.isInteger(totalMem)) {
                    this._gpuCoresMem[matchResult[1]].decoder = decoderUtilization;
                }
            }
        }
    }

    async _determineCoresStatistic() {
        await this._parseGpuStat();

        this._gpuEncodersUsage = this._encoderUsageCalculator.getUsage(this._gpuEncodersUtilization);
        this._gpuDecodersUsage = this._decoderUsageCalculator.getUsage(this._gpuDecodersUtilization);
        this._isOverloaded = this._isMemOverloaded() || this._isEncoderOverloaded() || this._isDecoderOverloaded();
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
        for (const coreId in coresMemCollection) {
            const {free, total} = coresMemCollection[coreId];
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
        for (const coreId in coresMemCollection) {
            const {free, total} = coresMemCollection[coreId];
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
        for (const coreId in coresUsageCollection) {
            if ((highWatermark * 100) < coresUsageCollection[coreId]) {
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
        if (typeof mem !== 'object') {
            throw new TypeError('field `mem` is required and must be an object');
        }

        if (mem.thresholdType === 'fixed') {
            if (!Number.isSafeInteger(mem.minFree) || mem.minFree <= 0) {
                throw new TypeError('`mem.minFree` field is required for threshold = fixed and must be more than 0');
            }

            this._isMemOverloaded = this._isMemOverloadedByFixedThreshold.bind(this, mem.minFree, this._gpuCoresMem);
        } else if (mem.thresholdType === 'rate') {
            if (!Number.isFinite(mem.highWatermark) || mem.highWatermark <= 0 || mem.highWatermark >= 1) {
                throw new TypeError(
                    '`mem.highWatermark` field is required for threshold = "rate" and must be in range (0;1)'
                );
            }

            this._isMemOverloaded = this._isMemOverloadedByRateThreshold.bind(
                this,
                mem.highWatermark,
                this._gpuCoresMem
            );
        } else if (mem.thresholdType === 'none') {
            this._isMemOverloaded = this._isMemOverloadedByIncorrectData;
        } else {
            throw new TypeError('`mem.thresholdType` is not set or has invalid type');
        }
    }

    /**
     * @param {Object} encoder
     * @param {string} encoder.calculationAlgo
     * @param {string} encoder.thresholdType
     */
    _initEncoderChecks(encoder) {
        if (typeof encoder !== 'object') {
            throw new TypeError('field `encoder` is required and must be an object');
        }

        if (encoder.calculationAlgo === 'sma') {
            if (!Number.isSafeInteger(encoder.periodPoints) || encoder.periodPoints < 1) {
                throw new TypeError(
                    '`encoder.periodPoints` field is required for SMA algorithm and must be more or equal than 0'
                );
            }
            this._encoderUsageCalculator = new GpuUtilizationSma(encoder.periodPoints);
        } else if (encoder.calculationAlgo === 'last_value') {
            this._encoderUsageCalculator = new GpuUtilization();
        } else {
            throw new TypeError('`encoder.calculationAlgo` is not set or has invalid type');
        }

        if (encoder.thresholdType === 'rate') {
            if (!Number.isFinite(encoder.highWatermark) || encoder.highWatermark <= 0 || encoder.highWatermark >= 1) {
                throw new TypeError(
                    '`encoder.highWatermark` field is required for threshold = "rate" and must be in range (0,1)'
                );
            }

            this._isEncoderOverloaded = this._isGpuUsageOverloadByRateThreshold.bind(
                null,
                encoder.highWatermark,
                this._gpuEncodersUsage
            );
        } else if (encoder.thresholdType === 'none') {
            this._isEncoderOverloaded = () => false;
        } else {
            throw new TypeError('`encoder.thresholdType` is not set or has invalid type');
        }
    }

    /**
     * @param {Object} decoder
     * @param {string} decoder.calculationAlgo
     * @param {string} decoder.thresholdType
     */
    _initDecoderChecks(decoder) {
        if (typeof decoder !== 'object') {
            throw new TypeError('field `decoder` is required and must be an object');
        }

        if (decoder.calculationAlgo === 'sma') {
            if (!Number.isSafeInteger(decoder.periodPoints) || decoder.periodPoints < 1) {
                throw new TypeError(
                    '`decoder.periodPoints` field is required for SMA algorithm and must be more than 0'
                );
            }
            this._decoderUsageCalculator = new GpuUtilizationSma(decoder.periodPoints);
        } else if (decoder.calculationAlgo === 'last_value') {
            this._decoderUsageCalculator = new GpuUtilization();
        } else {
            throw new TypeError('`decoder.calculationAlgo` is not set or has invalid type');
        }

        if (decoder.thresholdType === 'rate') {
            if (!Number.isFinite(decoder.highWatermark) || decoder.highWatermark <= 0 || decoder.highWatermark >= 1) {
                throw new TypeError(
                    '`decoder.highWatermark` field is required for threshold = "rate" and must be in range (0,1)'
                );
            }

            this._isDecoderOverloaded = this._isGpuUsageOverloadByRateThreshold.bind(
                null,
                decoder.highWatermark,
                this._gpuDecodersUsage
            );
        } else if (decoder.thresholdType === 'none') {
            this._isDecoderOverloaded = () => false;
        } else {
            throw new TypeError('`decoder.thresholdType` is not set or has invalid type');
        }
    }
}

module.exports = NvidiaGpuMonitor;
