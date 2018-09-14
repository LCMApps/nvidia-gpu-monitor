'use strict';

const exec = require('child_process').exec;
const promisify = require('util').promisify;
const execAsync = promisify(exec);

const DATA_GRAB_PATTERN = new RegExp(
    'Product Name\\s*:\\s*(\\b.+\\b)[\\s\\S]+?' +
    'Minor Number\\s+:\\s*(\\d+)[\\s\\S]+?' +
    'FB Memory Usage\\s+Total\\s+:\\s*(\\d+) MiB',
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
        this._coreNumbers = new Set();
        this._productNames = {};
        this._totalMemory = {};
        this._commandRunned = false;
    }

    getDriverVersion() {
        return this._driverVersion;
    }

    getProductNames() {
        return this._productNames;
    }

    /**
     * @param {number} coreNumber
     * @returns {number}
     */
    getTotalMemory(coreNumber) {
        return this._totalMemory[coreNumber];
    }

    /**
     * @returns {Array}
     */
    getCoreNumbers() {
        return Array.from(this._coreNumbers.values());
    }

    /**
     * @throws {Error}
     */
    async parseGpuMetaData() {
        if (this._commandRunned) {
            return;
        }

        try {
            this._commandRunned = true;
            const coresMetaData = await this._readCoresMetaData();
            this._commandRunned = false;

            let matchResult;
            while ((matchResult = DATA_GRAB_PATTERN.exec(coresMetaData)) !== null) {
                const coreNumber = Number.parseInt(matchResult[2], 10);
                this._coreNumbers.add(coreNumber);
                this._productNames[coreNumber] = matchResult[1];
                this._totalMemory[coreNumber] = Number.parseInt(matchResult[3], 10);
            }

            const driverMatchResult = DRIVER_VERSION_GRAB_PATTERN.exec(coresMetaData);
            this._driverVersion = driverMatchResult === null ? undefined : driverMatchResult[1];
        } catch (err) {
            this._commandRunned = false;
            throw err;
        }
    }

    /**
     * @example
     * //returns
     *   Driver Version                      : 384.111
     *   GPU 00000000:06:00.0
     *        Product Name                    : Tesla M60
     *        Minor Number                    : 0
     *        FB Memory Usage
     *             Total                       : 8129 MiB
     *             Used                        : 0 MiB
     *             Free                        : 8129 MiB
     *   GPU 00000000:07:00.0
     *        Product Name                    : Tesla M60
     *        Minor Number                    : 1
     *        FB Memory Usage
     *             Total                       : 8129 MiB
     *             Used                        : 0 MiB
     *             Free                        : 8129 MiB
     *
     * this._readCoresMetaData()
     *
     * @returns {string}
     * @throws {Error}
     */
    async _readCoresMetaData() {
        const {stdout} = await execAsync(`${this._nvidiaSmiPath} -q`);

        return stdout;
    }
}

module.exports = NvidiaGpuInfo;
