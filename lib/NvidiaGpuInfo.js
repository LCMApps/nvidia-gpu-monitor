'use strict';

const exec = require('child_process').exec;
const promisify = require('util').promisify;
const execAsync = promisify(exec);

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

        let coreId;
        for (const line of coresMetaData.split('\n')) {
            if (this._driverVersion === undefined && line.includes('Driver Version')) {
                this._driverVersion = getGpuDriverVersionFromRow(line);
                continue;
            }

            if (line.includes('GPU')) {
                coreId = getCoreIdFromRow(line);
                continue;
            }

            if (this._productName === undefined && coreId !== undefined && line.includes('Product Name')) {
                this._productName = getProductNameFromRow(line);
                continue;
            }

            if (coreId !== undefined && line.includes('Minor Number')) {
                this._coresId2NumberHash[coreId] = getCoreNumberFromRow(line);
            }
        }
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
