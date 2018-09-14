'use strict';

const assert = require('chai').assert;

const GpuUtilizationSma = require('../../src/GpuUtilizationSma');
const gpuUtilization = {
    '00000000:06:00.0': 10,
    '00000000:07:00.0': 25
};
const gpuUtilization2 = {
    '00000000:06:00.0': 50,
    '00000000:07:00.0': 33
};
const periodPoints = 3;

const NUMBER_PRECISION_DELTA = 0.0000001;

describe('GpuUtilizationSma methods tests', () => {
    it('getUsage() returns usage 100 if a points count for SMA lower than a periodPoints from the constructor', () => {
        const gpuUtilizationSma = new GpuUtilizationSma(periodPoints);

        const utilizationSma = gpuUtilizationSma.getUsage(gpuUtilization);
        assert.hasAllKeys(utilizationSma, Object.keys(gpuUtilization));
        for (const coreId in gpuUtilization) {
            assert.propertyVal(utilizationSma, coreId, 100);
        }
    });

    it('getUsage() returns correctly calculated usage', () => {
        const expectedGpuUsage = {
            '00000000:06:00.0': parseInt((10 + 10 + 50) / 3),
            '00000000:07:00.0': parseInt((25 + 25 + 33) / 3)
        };
        const gpuUtilizationSma = new GpuUtilizationSma(periodPoints);

        gpuUtilizationSma.getUsage(gpuUtilization);
        gpuUtilizationSma.getUsage(gpuUtilization);
        gpuUtilizationSma.getUsage(gpuUtilization);
        const utilizationSma = gpuUtilizationSma.getUsage(gpuUtilization2);

        assert.hasAllKeys(utilizationSma, Object.keys(gpuUtilization));
        for (const coreId in gpuUtilization) {
            assert.closeTo(utilizationSma[coreId], expectedGpuUsage[coreId], NUMBER_PRECISION_DELTA);
        }
    });

    it('getUsage() returns empty collection of utilization', () => {
        const expectedGpuUsage = {};
        const gpuUtilizationSma = new GpuUtilizationSma(periodPoints);

        gpuUtilizationSma.getUsage(gpuUtilization);
        gpuUtilizationSma.getUsage(gpuUtilization);
        gpuUtilizationSma.getUsage(gpuUtilization);
        const utilizationSma = gpuUtilizationSma.getUsage({});

        assert.deepEqual(utilizationSma, expectedGpuUsage);
    });
});
