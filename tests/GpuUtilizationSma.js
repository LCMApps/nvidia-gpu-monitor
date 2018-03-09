'use strict';

const assert = require('chai').assert;

const GpuUtilizationSma = require('../lib/GpuUtilizationSma');
const gpuUtilization = {
    '00000000:06:00.0': 10,
    '00000000:07:00.0': 25
};
const gpuUtilization2 = {
    '00000000:06:00.0': 70,
    '00000000:07:00.0': 16
};
const periodPoints = 3;

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
            '00000000:06:00.0': (10 + 10 + 70) / 3,
            '00000000:07:00.0': (25 + 25 + 16) / 3
        };
        const gpuUtilizationSma = new GpuUtilizationSma(periodPoints);

        gpuUtilizationSma.getUsage(gpuUtilization);
        gpuUtilizationSma.getUsage(gpuUtilization);
        gpuUtilizationSma.getUsage(gpuUtilization);
        const utilizationSma = gpuUtilizationSma.getUsage(gpuUtilization2);

        assert.hasAllKeys(utilizationSma, Object.keys(gpuUtilization));
        assert.deepEqual(utilizationSma, expectedGpuUsage);
    });
});
