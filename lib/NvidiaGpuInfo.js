'use strict';

const exec = require('child_process').exec;
const promisify = require('util').promisify;
const execAsync = promisify(exec);

const CORE_NUMER_GRAB_PATTERN = new RegExp('GPU (\\d+:\\d+:\\d+.\\d+)[\\s\\S]*?Minor Number\\s+:\\s(\\d+)', 'g');
const DRIVER_VERSION_GRAB_PATTERN = new RegExp('Driver Version\\s*: (\\b.+\\b)', 'g');
const PRODUCT_NAME_GRAB_PATTERN = new RegExp('Product Name\\s*: (\\b.+\\b)', 'g');

class NvidiaGpuInfo {
    /**
     * @param {string} nvidiaSmiPath
     */
    constructor(nvidiaSmiPath) {
        this._nvidiaSmiPath = nvidiaSmiPath;
        this._driverVersion = '';
        this._productName = '';
        this._coresId2NumberHash = Object.create(null);
    }

    getDriverVersion() {
        return this._driverVersion;
    }

    getProductName() {
        return this._productName;
    }

    getCoreId2NumberHash() {
        return this._coresId2NumberHash;
    }

    /**
     * @param {string} coreId
     * @returns {string|undefined}
     */
    getCoreNumberById(coreId) {
        return this._coresId2NumberHash[coreId];
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
    async parseGpuMetaData() {
        const coresMetaData = await this._readCoresMetaData();

        let matchResult;
        while ((matchResult = CORE_NUMER_GRAB_PATTERN.exec(coresMetaData)) !== null) {
            this._coresId2NumberHash[matchResult[1]] = matchResult[2];
        }

        this._productName = PRODUCT_NAME_GRAB_PATTERN.exec(coresMetaData)[1];
        this._driverVersion = DRIVER_VERSION_GRAB_PATTERN.exec(coresMetaData)[1];
    }

    /**
     * @returns {string}
     */
    async _readCoresMetaData() {
        const {stdout} = await execAsync(
            `${this._nvidiaSmiPath} -q | egrep "GPU 0|Minor Number|Product Name|Driver Version"`
        );

        return stdout;
    }
}

module.exports = NvidiaGpuInfo;
