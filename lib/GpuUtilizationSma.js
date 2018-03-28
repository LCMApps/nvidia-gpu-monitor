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

        for (const coreId in gpuCoresUsage) {
            utilizationSma[coreId] = 100;

            if (this._utilizationCollection[coreId]) {
                this._utilizationCollection[coreId].push(gpuCoresUsage[coreId]);
                this._utilizationSumCollection[coreId] += gpuCoresUsage[coreId];
            } else {
                this._utilizationCollection[coreId] = [gpuCoresUsage[coreId]];
                this._utilizationSumCollection[coreId] = gpuCoresUsage[coreId];
            }

            if (this._utilizationCollection[coreId].length === this._periodPoints) {
                utilizationSma[coreId] = Math.floor(this._utilizationSumCollection[coreId] / this._periodPoints);

                this._utilizationSumCollection[coreId] -= this._utilizationCollection[coreId].shift();
            }
        }

        return utilizationSma;
    }
}

module.exports = GpuUtilizationSma;
