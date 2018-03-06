'use strict';

class GpuUtilizationSma {
    constructor(periodPoints) {
        this._periodPoints = periodPoints;
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
            } else {
                this._utilizationCollection[coreId] = [gpuCoresUsage[coreId]];
            }

            if (this._utilizationCollection[coreId].length === this._periodPoints) {
                const utilizationSum = this._utilizationCollection[coreId].reduce((sum, load) => {
                    return sum + load;
                }, 0);


                utilizationSma[coreId] = +(utilizationSum / this._periodPoints).toFixed(2);

                this._utilizationCollection[coreId].shift();
            }
        }

        return utilizationSma;
    }
}

module.exports = GpuUtilizationSma;
