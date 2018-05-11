'use strict';

class GpuUtilizationSma {
    constructor(periodPoints) {
        this._periodPoints = periodPoints;
        this._utilizationCollection = {};
        this._utilizationSumCollection = {};
    }

    /**
     * @param {Object} gpuCoresUsage
     * @returns {Object}
     */
    getUsage(gpuCoresUsage) {
        const utilizationSma = {};

        for (const coreNumber in gpuCoresUsage) {
            utilizationSma[coreNumber] = 100;

            if (this._utilizationCollection[coreNumber]) {
                this._utilizationCollection[coreNumber].push(gpuCoresUsage[coreNumber]);
                this._utilizationSumCollection[coreNumber] += gpuCoresUsage[coreNumber];
            } else {
                this._utilizationCollection[coreNumber] = [gpuCoresUsage[coreNumber]];
                this._utilizationSumCollection[coreNumber] = gpuCoresUsage[coreNumber];
            }

            if (this._utilizationCollection[coreNumber].length === this._periodPoints) {
                const averageUtilization = this._utilizationSumCollection[coreNumber] / this._periodPoints;
                utilizationSma[coreNumber] = Math.floor(averageUtilization);

                this._utilizationSumCollection[coreNumber] -= this._utilizationCollection[coreNumber].shift();
            }
        }

        return utilizationSma;
    }
}

module.exports = GpuUtilizationSma;
