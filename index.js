'use strict';

const fs = require('fs');
const exec = require('child_process').exec;
const promisify = require('util').promisify;

const GpuUtilization = require('./lib/GpuUtilization');
const GpuUtilizationSma = require('./lib/GpuUtilizationSma');

const readFileAsync = promisify(fs.readFile);
const fsAccessAsync = promisify(fs.access());
const execAsync = promisify(exec);

const CORE_ID_LINE_REGEXP = /GPU \d+:\d+:\d+.\d/;

/**
 * @param {string} gpuInfoPath
 * @returns {Promise.<void|Error>}
 * @private
 */
function assertReadFileAccess(gpuInfoPath) {
    return fsAccessAsync(gpuInfoPath, fs.constants.R_OK);
}

/**
 * Driver Version                      : 384.111
 * @param {string} row
 * @return {string}
 */
function getGpuDriverVersionFromRow(row) {
    return row.split(':')[1].trim();
}

/**
 * Row example: GPU 00000000:06:00.0
 * @param {string} row
 * @return {string}
 */
function getCoreIdFromRow(row) {
    return row.split('GPU ')[1].trim();
}

/**
 * Row example: Product Name                    : Tesla M60
 * @param {string} row
 * @return {string}
 */
function getProductNameFromRow(row) {
    return row.split(':')[1].trim();
}

/**
 * Row example: Minor Number                    : 0
 * @param {string} row
 * @return {string}
 */
function getCoreNumberFromRow(row) {
    return row.split(':')[1].trim();
}

/**
 * Row example: Total                       : 256 MiB
 * @param {string} row
 * @return {string}
 */
function getMemoryValueFromRow(row) {
    return row.split(':')[1].trim().slice(0, -4);
}

/**
 * Row example: Encoder                     : 42 %
 * @param {string} row
 * @return {string}
 */
function getUtilizationValueFromRow(row) {
    return row.split(':')[1].trim().slice(0, -2);
}

class NvidiaGpuMonitor {
    static get STATUS_STOPPED() {
        return 1;
    }

    static get STATUS_STARTED() {
        return 2;
    }

    /**
     * @param {string} nvidiaSmiPath
     * @param {string} gpuStatPath
     * @param {number} checkInterval
     * @param {Object} mem
     * @param {Object} decoder
     * @param {Object} encoder
     */
    constructor({nvidiaSmiPath, gpuStatPath, checkInterval, mem, decoder, encoder}) {
        if (typeof nvidiaSmiPath !== 'string') {
            throw new TypeError('field `nvidiaSmiPath` is required and must be a string');
        }

        if (typeof gpuStatPath !== 'string') {
            throw new TypeError('field `gpuStatPath` is required and must be a string');
        }

        if (!Number.isSafeInteger(checkInterval) || checkInterval < 1) {
            throw new TypeError('field `checkInterval` is required and must be an integer and more than 1');
        }

        this._nvidiaSmiPath = nvidiaSmiPath;
        this._gpuStatPath = gpuStatPath;
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

        this._gpuMetaInfo = {};
        this._coresId2NumberHash = {};
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

        await assertReadFileAccess(this._gpuStatPath);
        await this._parseGpuMetaData();
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

        for (const coreId in this._coresId2NumberHash) {
            gpuStat.push({
                core: this._coresId2NumberHash[coreId],
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

    /* istanbul ignore next */
    async _readCoresMetaData() {
        const {stdout} = await execAsync(
            `${this._nvidiaSmiPath} -q | egrep "GPU 0|Minor Number|Product Name|Driver Version"`
        );

        return stdout;
    }

    /* istanbul ignore next */
    _readGpuStatFile() {
        return readFileAsync(this._gpuStatPath, 'utf8');
    }

    /*
        STDOUT content example:
        Driver Version                      : 384.111
        GPU 00000000:06:00.0
            Product Name                    : Tesla M60
            Minor Number                    : 0
        GPU 00000000:07:00.0
            Product Name                    : Tesla M60
            Minor Number                    : 1
     */
    async _parseGpuMetaData() {
        const coresMetaData = await this._readCoresMetaData();

        let driverVersion;
        let coreId;
        for (const line of coresMetaData.split('\n')) {
            if (driverVersion === undefined && line.includes('Driver Version')) {
                driverVersion = getGpuDriverVersionFromRow(line);
                continue;
            }

            if (line.includes('GPU')) {
                coreId = getCoreIdFromRow(line);
                this._gpuMetaInfo[coreId] = {};
                continue;
            }

            if (coreId !== undefined && line.includes('Product Name')) {
                this._gpuMetaInfo[coreId]['productName'] = getProductNameFromRow(line);
                continue;
            }

            if (coreId !== undefined && line.includes('Minor Number')) {
                const coreNumber = Number.parseInt(getCoreNumberFromRow(line));
                this._gpuMetaInfo[coreId]['minorNumber'] = coreNumber;
                this._coresId2NumberHash[coreId] = coreNumber;
            }
        }

        this._gpuMetaInfo.driverVersion = driverVersion;
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
        try {
            gpuStat = await this._readGpuStatFile();
        } catch (err) {
            for (const coreId in this._coresId2NumberHash) {
                this._gpuCoresMem[coreId] = {
                    total: -1,
                    free: -1
                };
                this._gpuEncodersUtilization[coreId] = 100;
                this._gpuDecodersUtilization[coreId] = 100;
            }
            return;
        }

        let gpuCoresMem = {};
        let gpuEncodersUtilization = {};
        let gpuDecodersUtilization = {};
        let coreId;
        let fbMemBlock = false;
        for (const line of gpuStat.split('\n')) {
            if (CORE_ID_LINE_REGEXP.test(line)) {
                fbMemBlock = false;
                coreId = getCoreIdFromRow(line);
                const coreNumber = this._coresId2NumberHash[coreId];

                if (!Number.isInteger(coreNumber)) {
                    continue;
                }

                gpuCoresMem[coreId] = {
                    total: -1,
                    free: -1
                };

                gpuEncodersUtilization[coreId] = 100;
                gpuDecodersUtilization[coreId] = 100;

                continue;
            }

            if (line.includes('FB Memory Usage')) {
                fbMemBlock = true;
                continue;
            }

            if (fbMemBlock && line.includes('Total')) {
                const totalMem = Number.parseInt(getMemoryValueFromRow(line));

                if (Number.isInteger(totalMem)) {
                    gpuCoresMem[coreId].mem.total = totalMem;
                }

                continue;
            }

            if (fbMemBlock && line.includes('Free')) {
                const freeMem = Number.parseInt(getMemoryValueFromRow(line));

                if (Number.isInteger(freeMem)) {
                    gpuCoresMem[coreId].mem.free = freeMem;
                }

                continue;
            }

            if (line.includes('Encoder')) {
                const encoderUtilization = Number.parseInt(getUtilizationValueFromRow(line));

                if (Number.isInteger(encoderUtilization)) {
                    gpuEncodersUtilization[coreId] = encoderUtilization;
                }

                continue;
            }

            if (line.includes('Decoder')) {
                const decoderUtilization = Number.parseInt(getUtilizationValueFromRow(line));

                if (Number.isInteger(decoderUtilization)) {
                    gpuDecodersUtilization[coreId] = decoderUtilization;
                }
            }
        }

        this._gpuCoresMem = gpuCoresMem;
        this._gpuEncodersUtilization = gpuEncodersUtilization;
        this._gpuDecodersUtilization = gpuDecodersUtilization;
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
     * @param {number} free
     * @param {number} total
     * @returns {boolean}
     */
    _isMemOverloadedByFixedThreshold(minFree, free, total) {
        return this._isMemOverloadedByIncorrectData(free, total) || free < minFree;
    }

    /**
     * @param {number} highWatermark
     * @param {number} free
     * @param {number} total
     * @returns {boolean}
     */
    _isMemOverloadedByRateThreshold(highWatermark, free, total) {
        return this._isMemOverloadedByIncorrectData(free, total) || (total - free) / total > highWatermark;
    }

    /**
     * @param {number} highWatermark
     * @param {number} usage
     * @returns {boolean}
     * @private
     */
    _isGpuUsageOverloadByRateThreshold(highWatermark, usage) {
        return highWatermark * 100 < usage;
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
                throw new TypeError('`mem.minFree` field is required for threshold = fixed and must be more then 0');
            }

            this._isMemOverloaded = this._isMemOverloadedByFixedThreshold.bind(this, mem.minFree);
        } else if (mem.thresholdType === 'rate') {
            if (mem.highWatermark <= 0 || mem.highWatermark >= 1) {
                throw new TypeError(
                    '`mem.highWatermark` field is required for threshold = "rate" and must be in range (0;1)'
                );
            }

            this._isMemOverloaded = this._isMemOverloadedByRateThreshold.bind(this, mem.highWatermark);
        } else if (mem.thresholdType === 'none') {
            this._isMemOverloaded = this._isMemOverloadedByIncorrectData.bind(this);
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
                    '`encoder.periodPoints` field is required for SMA algorithm and must be more than 0'
                );
            }
            this._encoderUsageCalculator = new GpuUtilizationSma(encoder.periodPoints);
        } else if (encoder.calculationAlgo === 'last_value') {
            this._encoderUsageCalculator = new GpuUtilization();
        } else {
            throw new TypeError('`encoder.calculationAlgo` is not set or has invalid type');
        }

        if (encoder.thresholdType === 'rate') {
            if (!Number.isFinite(encoder.highWatermark) || encoder.highWatermark > 1) {
                throw new TypeError(
                    '`encoder.highWatermark` field is required for threshold = "rate" and must be in range (0,1]'
                );
            }

            this._isEncoderOverloaded = this._isGpuUsageOverloadByRateThreshold.bind(null, encoder.highWatermark);
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
            if (!Number.isFinite(decoder.highWatermark) || decoder.highWatermark > 1) {
                throw new TypeError(
                    '`decoder.highWatermark` field is required for threshold = "rate" and must be in range (0,1]'
                );
            }

            this._isDecoderOverloaded = this._isGpuUsageOverloadByRateThreshold.bind(null, decoder.highWatermark);
        } else if (decoder.thresholdType === 'none') {
            this._isDecoderOverloaded = () => false;
        } else {
            throw new TypeError('`decoder.thresholdType` is not set or has invalid type');
        }
    }
}

module.exports = NvidiaGpuMonitor;
