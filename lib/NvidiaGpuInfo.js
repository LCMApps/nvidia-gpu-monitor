'use strict';

const exec = require('child_process').exec;
const promisify = require('util').promisify;
const execAsync = promisify(exec);

const DATA_GRAB_PATTERN = new RegExp(
    'GPU (\\d+:\\d+:\\d+.\\d+)[\\s\\S]+?' +
        'Product Name\\s*:\\s*(\\b.+\\b)[\\s\\S]+?' +
        'Minor Number\\s+:\\s*(\\d+)',
    'g'
);
const DRIVER_VERSION_GRAB_PATTERN = new RegExp('Driver Version\\s*:\\s*(\\b.+\\b)', 'g');

class NvidiaGpuInfo {
    /**
     * @param {string} nvidiaSmiPath
     */
    constructor(nvidiaSmiPath) {
        this._nvidiaSmiPath = nvidiaSmiPath;
        this._driverVersion = undefined;
        this._productNames = {};
        this._pciId2CoreNumber = {};
    }

    getDriverVersion() {
        return this._driverVersion;
    }

    getProductNames() {
        return this._productNames;
    }

    /**
     * @param {string} pciId
     * @returns {string|undefined}
     */
    getCoreNumber(pciId) {
        return this._pciId2CoreNumber[pciId];
    }

    /**
     * @throws {Error}
     */
    async parseGpuMetaData() {
        const coresMetaData = await this._readCoresMetaData();

        let matchResult;
        while ((matchResult = DATA_GRAB_PATTERN.exec(coresMetaData)) !== null) {
            this._productNames[matchResult[1]] = matchResult[2];
            this._pciId2CoreNumber[matchResult[1]] = matchResult[3];
        }

        const driverMatchResult = DRIVER_VERSION_GRAB_PATTERN.exec(coresMetaData);
        this._driverVersion = driverMatchResult === null ? undefined : driverMatchResult[1];
    }

    /**
     * @example
     * //returns
     *   Driver Version                      : 384.111
     *   GPU 00000000:06:00.0
     *        Product Name                    : Tesla M60
     *        Minor Number                    : 0
     *   GPU 00000000:07:00.0
     *        Product Name                    : Tesla M60
     *        Minor Number                    : 1
     *
     * this._readCoresMetaData()
     *
     * @returns {string}
     * @throws {Error}
     */
    async _readCoresMetaData() {
        const {stdout} = await execAsync(
            `${this._nvidiaSmiPath} -q | egrep "GPU 0|Minor Number|Product Name|Driver Version"`
        );

        return stdout;
    }
}

module.exports = NvidiaGpuInfo;
