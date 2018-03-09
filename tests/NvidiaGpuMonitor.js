'use strict';

const fs = require('fs');
const sinon = require('sinon');
const assert = require('chai').assert;
const dataDriven = require('data-driven');
const deepFreeze = require('deep-freeze');

const NvidiaGpuMonitor = require('../index');

const coresStatOutput = fs.readFileSync('./tests/coresStat.txt', 'utf8');

/**
 * Returns object with passed to function variable itself and its type.
 *
 * As of 'null' has type of 'object' in ECMAScript, function returns 'null' for it.
 *
 * @example
 *   `{value: 123, type: 'number'}`
 *   '{value: Symbol(), type: 'symbol'}`
 *   `{value: null, type: 'null'}`
 *
 * @param {*} value - value of any type
 * @returns {{value: *, type: string}}
 */
function vt(value) {
    return {value, type: (value === null ? 'null' : typeof value)};
}

const testParams = {
    // all type except number
    notANumber: [
        vt('8080'), vt(true), vt(undefined), vt(Symbol()), vt({}), vt(setTimeout), vt(null)
    ],
    // all types except string
    notAString: [
        vt(true), vt(123), vt(undefined), vt(Symbol()), vt({}), vt(setTimeout), vt(null)
    ],
    // all types except string and null
    notAnEmptyStringAndNull: [
        vt(true), vt(123), vt(undefined), vt(Symbol()), vt({}), vt(setTimeout), vt('')
    ],
    // all types except array
    notAnArray: [
        vt('8080'), vt(123), vt(true), vt(undefined), vt(Symbol()), vt({}), vt(setTimeout), vt(null)
    ],
    // all types except an object
    notAnObject: [
        vt('8080'), vt(123), vt(true), vt(undefined), vt(Symbol()), vt(setTimeout), vt(null)
    ]
};

const coreId2NumberHash = deepFreeze({
    '00000000:06:00.0': '0',
    '00000000:07:00.0': '1'
});
const gpuCoresMem = deepFreeze({
    '00000000:06:00.0': {
        total: 10,
        free: 8
    },
    '00000000:07:00.0': {
        total: 10,
        free: 5
    }
});
const gpuEncodersUtilization = deepFreeze({
    '00000000:06:00.0': 1,
    '00000000:07:00.0': 6
});
const gpuDecodersUtilization = deepFreeze({
    '00000000:06:00.0': 2,
    '00000000:07:00.0': 6
});
const gpuProductName = 'Tesla M60';
const gpuDriverVersion = '384.111';

describe('NvidiaGpuMonitor::constructor', () => {
    dataDriven(testParams.notAString, function () {
        it('incorrect type of nvidiaSmiPath, type = {type}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: arg.value
                    });
                },
                TypeError,
                'field "nvidiaSmiPath" is required and must be a string');
        });
    });

    dataDriven(testParams.notANumber, function () {
        it('incorrect type of checkInterval, type = {type}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: '',
                        checkInterval: arg.value
                    });
                },
                TypeError,
                'field "checkInterval" is required and must be an integer and not less than 1');
        });
    });

    dataDriven(testParams.notAnObject, function () {
        it('incorrect type of mem, type = {type}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: '',
                        checkInterval: 1000,
                        mem: arg.value
                    });
                },
                TypeError,
                'field "mem" is required and must be an object');
        });
    });

    it('incorrect config value mem.thresholdType', () => {
        assert.throws(
            () => {
                new NvidiaGpuMonitor({
                    nvidiaSmiPath: '',
                    checkInterval: 1000,
                    mem: {
                        thresholdType: 'sma'
                    }
                });
            },
            TypeError,
            '"mem.thresholdType" is not set or has invalid type');
    });

    dataDriven([vt(-1), vt(0)], function () {
        it('incorrect config value "minFree" for mem.thresholdType === "fixed", value = {value}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: '',
                        checkInterval: 1000,
                        mem: {
                            thresholdType: 'fixed',
                            minFree: arg.value
                        }
                    });
                },
                TypeError,
                '"mem.minFree" field is required for threshold = fixed and must be more than 0');
        });
    });

    dataDriven([vt(undefined), vt(-1), vt(0), vt(1), vt(10)], function () {
        it('incorrect config value "highWatermark" for mem.thresholdType === "rate", value = {value}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: '',
                        checkInterval: 1000,
                        mem: {
                            thresholdType: 'rate',
                            highWatermark: arg.value
                        }
                    });
                },
                TypeError,
                '"mem.highWatermark" field is required for threshold = "rate" and must be in range (0;1)');
        });
    });

    dataDriven(testParams.notAnObject, function () {
        it('incorrect type of encoder, type = {type}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: '',
                        checkInterval: 1000,
                        mem: {
                            thresholdType: 'none'
                        },
                        encoder: arg.value
                    });
                },
                TypeError,
                'field "encoder" is required and must be an object');
        });
    });

    it('incorrect config value encoder.calculationAlgo', () => {
        assert.throws(
            () => {
                new NvidiaGpuMonitor({
                    nvidiaSmiPath: '',
                    checkInterval: 1000,
                    mem: {
                        thresholdType: 'none'
                    },
                    encoder: {
                        calculationAlgo: undefined
                    },
                });
            },
            TypeError,
            '"encoder.calculationAlgo" is not set or has invalid type');
    });

    dataDriven([vt(undefined), vt(-1), vt(0.2), vt(5.2)], function () {
        it('incorrect config value "periodPoints" for encoder.calculationAlgo === "sma", value = {value}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: '',
                        checkInterval: 1000,
                        mem: {
                            thresholdType: 'none'
                        },
                        encoder: {
                            calculationAlgo: 'sma',
                            periodPoints: arg.value
                        }
                    });
                },
                TypeError,
                '"encoder.periodPoints" field is required for SMA algorithm and must be not less than 0');
        });
    });

    it('incorrect config value encoder.thresholdType', () => {
        assert.throws(
            () => {
                new NvidiaGpuMonitor({
                    nvidiaSmiPath: '',
                    checkInterval: 1000,
                    mem: {
                        thresholdType: 'none'
                    },
                    encoder: {
                        calculationAlgo: 'sma',
                        periodPoints: 3
                    }
                });
            },
            TypeError,
            '"encoder.thresholdType" is not set or has invalid type');
    });

    dataDriven([vt(undefined), vt(-1), vt(0), vt(1), vt(10)], function () {
        it('incorrect config value "highWatermark" for encoder.thresholdType === "rate", value = {value}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: '',
                        checkInterval: 1000,
                        mem: {
                            thresholdType: 'none'
                        },
                        encoder: {
                            calculationAlgo: 'sma',
                            periodPoints: 3,
                            thresholdType: 'rate',
                            highWatermark: arg.value
                        }
                    });
                },
                TypeError,
                '"encoder.highWatermark" field is required for threshold = "rate" and must be in range (0,1)');
        });
    });

    dataDriven(testParams.notAnObject, function () {
        it('incorrect type of decoder, type = {type}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: '',
                        checkInterval: 1000,
                        mem: {
                            thresholdType: 'none'
                        },
                        encoder: {
                            calculationAlgo: 'last_value',
                            thresholdType: 'none',
                        },
                        decoder: arg.value
                    });
                },
                TypeError,
                'field "decoder" is required and must be an object');
        });
    });

    it('incorrect config value decoder.calculationAlgo', () => {
        assert.throws(
            () => {
                new NvidiaGpuMonitor({
                    nvidiaSmiPath: '',
                    checkInterval: 1000,
                    mem: {
                        thresholdType: 'none'
                    },
                    encoder: {
                        calculationAlgo: 'last_value',
                        thresholdType: 'none',
                    },
                    decoder: {
                        calculationAlgo: undefined
                    },
                });
            },
            TypeError,
            '"decoder.calculationAlgo" is not set or has invalid type');
    });

    dataDriven([vt(undefined), vt(-1), vt(0.2), vt(5.2)], function () {
        it('incorrect config value "periodPoints" for decoder.calculationAlgo === "sma", value = {value}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: '',
                        checkInterval: 1000,
                        mem: {
                            thresholdType: 'none'
                        },
                        encoder: {
                            calculationAlgo: 'last_value',
                            thresholdType: 'none',
                        },
                        decoder: {
                            calculationAlgo: 'sma',
                            periodPoints: arg.value
                        }
                    });
                },
                TypeError,
                '"decoder.periodPoints" field is required for SMA algorithm and must be not less than 0');
        });
    });

    it('incorrect config value decoder.thresholdType', () => {
        assert.throws(
            () => {
                new NvidiaGpuMonitor({
                    nvidiaSmiPath: '',
                    checkInterval: 1000,
                    mem: {
                        thresholdType: 'none'
                    },
                    encoder: {
                        calculationAlgo: 'last_value',
                        thresholdType: 'none',
                    },
                    decoder: {
                        calculationAlgo: 'sma',
                        periodPoints: 3
                    }
                });
            },
            TypeError,
            '"decoder.thresholdType" is not set or has invalid type');
    });

    dataDriven([vt(undefined), vt(-1), vt(0), vt(1), vt(10)], function () {
        it('incorrect config value "highWatermark" for decoder.thresholdType === "rate", value = {value}', (arg) => {
            assert.throws(
                () => {
                    new NvidiaGpuMonitor({
                        nvidiaSmiPath: '',
                        checkInterval: 1000,
                        mem: {
                            thresholdType: 'none'
                        },
                        encoder: {
                            calculationAlgo: 'last_value',
                            thresholdType: 'none',
                        },
                        decoder: {
                            calculationAlgo: 'sma',
                            periodPoints: 3,
                            thresholdType: 'rate',
                            highWatermark: arg.value
                        }
                    });
                },
                TypeError,
                '"decoder.highWatermark" field is required for threshold = "rate" and must be in range (0,1)');
        });
    });
});

describe('NvidiaGpuMonitor methods tests', () => {
    let monitorConf = {
        nvidiaSmiPath: '/usr/bin/nvidia-sma',
        gpuStatPath: './tests/coresStatOutput.txt',
        checkInterval: 15000,
        mem: {
            thresholdType: 'none',
            minFree: 1024,
            highWatermark: 0.75
        },
        encoder: {
            calculationAlgo: 'sma',
            thresholdType: 'none',
            periodPoints: 5,
            highWatermark: 0.75
        },
        decoder: {
            calculationAlgo: 'sma',
            thresholdType: 'none',
            periodPoints: 5,
            highWatermark: 0.75
        }
    };

    const expectedSchedulerClass = 'Timeout';

    let nvidiaGpuMonitor;

    beforeEach(() => {
        nvidiaGpuMonitor = new NvidiaGpuMonitor(monitorConf);
    });

    it('start successfully', async () => {
        const determineCoresStatisticStub = sinon.stub(nvidiaGpuMonitor, '_determineCoresStatistic');
        const parseGpuMetaDataStub = sinon.stub(nvidiaGpuMonitor._nvidiaGpuInfo, 'parseGpuMetaData');

        await nvidiaGpuMonitor.start();

        const actualSchedulerClass = nvidiaGpuMonitor._monitorScheduler.constructor.name;

        assert.equal(nvidiaGpuMonitor._status, NvidiaGpuMonitor.STATUS_STARTED);
        assert.isTrue(determineCoresStatisticStub.calledOnce);
        assert.isTrue(determineCoresStatisticStub.calledWithExactly());
        assert.isTrue(parseGpuMetaDataStub.calledOnce);
        assert.isTrue(parseGpuMetaDataStub.calledWithExactly());
        assert.equal(actualSchedulerClass, expectedSchedulerClass);
        assert.equal(nvidiaGpuMonitor._monitorScheduler._repeat, monitorConf.checkInterval);
    });

    it('second start call throws error', async () => {
        const determineCoresStatisticStub = sinon.stub(nvidiaGpuMonitor, '_determineCoresStatistic');
        const parseGpuMetaDataStub = sinon.stub(nvidiaGpuMonitor._nvidiaGpuInfo, 'parseGpuMetaData');

        await nvidiaGpuMonitor.start();

        try {
            await nvidiaGpuMonitor.start();
            assert.fail('service second start success', 'service second start throw error');
        } catch (err) {
            const actualSchedulerClass = nvidiaGpuMonitor._monitorScheduler.constructor.name;

            assert.instanceOf(err, Error);
            assert.equal(err.message, 'NvidiaGpuMonitor service is already started');
            assert.equal(nvidiaGpuMonitor._status, NvidiaGpuMonitor.STATUS_STARTED);
            assert.isTrue(determineCoresStatisticStub.calledOnce);
            assert.isTrue(determineCoresStatisticStub.calledWithExactly());
            assert.isTrue(parseGpuMetaDataStub.calledOnce);
            assert.isTrue(parseGpuMetaDataStub.calledWithExactly());
            assert.equal(actualSchedulerClass, expectedSchedulerClass);
        }
    });

    it('stop scheduler', async () => {
        const determineCoresStatisticStub = sinon.stub(nvidiaGpuMonitor, '_determineCoresStatistic');
        const parseGpuMetaDataStub = sinon.stub(nvidiaGpuMonitor._nvidiaGpuInfo, 'parseGpuMetaData');

        await nvidiaGpuMonitor.start();
        nvidiaGpuMonitor.stop();

        assert.isTrue(determineCoresStatisticStub.calledOnce);
        assert.isTrue(determineCoresStatisticStub.calledWithExactly());
        assert.isTrue(parseGpuMetaDataStub.calledOnce);
        assert.isTrue(parseGpuMetaDataStub.calledWithExactly());
        assert.equal(nvidiaGpuMonitor._status, NvidiaGpuMonitor.STATUS_STOPPED);
        assert.equal(nvidiaGpuMonitor._monitorScheduler._repeat, null);
    });

    it('second stop call throw error', async () => {
        const determineCoresStatisticStub = sinon.stub(nvidiaGpuMonitor, '_determineCoresStatistic');
        const parseGpuMetaDataStub = sinon.stub(nvidiaGpuMonitor._nvidiaGpuInfo, 'parseGpuMetaData');

        await nvidiaGpuMonitor.start();
        nvidiaGpuMonitor.stop();

        assert.throws(() => {
            nvidiaGpuMonitor.stop();
        }, 'NvidiaGpuMonitor service is not started');

        assert.isTrue(determineCoresStatisticStub.calledOnce);
        assert.isTrue(determineCoresStatisticStub.calledWithExactly());
        assert.isTrue(parseGpuMetaDataStub.calledOnce);
        assert.isTrue(parseGpuMetaDataStub.calledWithExactly());
        assert.equal(nvidiaGpuMonitor._status, NvidiaGpuMonitor.STATUS_STOPPED);
        assert.equal(nvidiaGpuMonitor._monitorScheduler._repeat, null);
    });

    it('getGpuStat() returns array with cores statistic', () => {
        const expectedCoreStat1 = {
            core: coreId2NumberHash['00000000:06:00.0'],
            mem: {
                free: gpuCoresMem['00000000:06:00.0'].free
            },
            usage: {
                enc: gpuEncodersUtilization['00000000:06:00.0'],
                dec: gpuDecodersUtilization['00000000:06:00.0'],
            }
        };

        const expectedCoreStat2 = {
            core: coreId2NumberHash['00000000:07:00.0'],
            mem: {
                free: gpuCoresMem['00000000:07:00.0'].free
            },
            usage: {
                enc: gpuEncodersUtilization['00000000:07:00.0'],
                dec: gpuDecodersUtilization['00000000:07:00.0'],
            }
        };

        nvidiaGpuMonitor._status = NvidiaGpuMonitor.STATUS_STARTED;
        nvidiaGpuMonitor._gpuCoresMem = gpuCoresMem;
        nvidiaGpuMonitor._gpuEncodersUsage = gpuEncodersUtilization;
        nvidiaGpuMonitor._gpuDecodersUsage = gpuDecodersUtilization;
        nvidiaGpuMonitor._nvidiaGpuInfo._coresId2NumberHash = coreId2NumberHash;

        const getCoreId2NumberHashSpy = sinon.spy(nvidiaGpuMonitor._nvidiaGpuInfo, 'getCoreId2NumberHash');

        const result = nvidiaGpuMonitor.getGpuStat();

        assert.isTrue(getCoreId2NumberHashSpy.calledOnce);
        assert.isTrue(getCoreId2NumberHashSpy.calledWithExactly());
        assert.isArray(result);
        assert.lengthOf(result, 2);
        assert.includeDeepMembers(result, [expectedCoreStat1, expectedCoreStat2]);
        for (let index = 0; index < Object.keys(coreId2NumberHash).length; index++) {
            assert.hasAllKeys(result[index], ['core', 'mem', 'usage']);
            assert.nestedProperty(result[index], 'mem.free');
            assert.nestedProperty(result[index], 'usage.enc');
            assert.nestedProperty(result[index], 'usage.dec');
            assert.isNumber(result[index].mem.free);
            assert.isNumber(result[index].usage.enc);
            assert.isNumber(result[index].usage.dec);
        }
    });

    it('getGpuDriverVersion() returns GPU driver version', () => {
        nvidiaGpuMonitor._status = NvidiaGpuMonitor.STATUS_STARTED;
        nvidiaGpuMonitor._nvidiaGpuInfo._driverVersion = gpuDriverVersion;
        const getDriverVersionSpy = sinon.spy(nvidiaGpuMonitor._nvidiaGpuInfo, 'getDriverVersion');

        const result = nvidiaGpuMonitor.getGpuDriverVersion();

        assert.isTrue(getDriverVersionSpy.calledOnce);
        assert.isTrue(getDriverVersionSpy.calledWithExactly());
        assert.strictEqual(result, gpuDriverVersion);
    });

    it('getGpuProductName() returns GPU driver version', () => {
        nvidiaGpuMonitor._status = NvidiaGpuMonitor.STATUS_STARTED;
        nvidiaGpuMonitor._nvidiaGpuInfo._productName = gpuProductName;
        const getProductNameSpy = sinon.spy(nvidiaGpuMonitor._nvidiaGpuInfo, 'getProductName');

        const result = nvidiaGpuMonitor.getGpuProductName();

        assert.isTrue(getProductNameSpy.calledOnce);
        assert.isTrue(getProductNameSpy.calledWithExactly());
        assert.strictEqual(result, gpuProductName);
    });

    it('_parseGpuStat() scrape data from nvidia-smi output', async () => {
        const readGpuStatDataStub = sinon.stub(nvidiaGpuMonitor, '_readGpuStatData');
        const getCoreId2NumberHashStub = sinon.stub(nvidiaGpuMonitor._nvidiaGpuInfo, 'getCoreId2NumberHash');
        readGpuStatDataStub.returns(Promise.resolve(coresStatOutput));
        getCoreId2NumberHashStub.returns(coreId2NumberHash);

        await nvidiaGpuMonitor._parseGpuStat();

        assert.isTrue(readGpuStatDataStub.calledOnce);
        assert.isTrue(readGpuStatDataStub.calledWithExactly());
        assert.isTrue(getCoreId2NumberHashStub.calledOnce);
        assert.isTrue(getCoreId2NumberHashStub.calledWithExactly());
        assert.deepEqual(nvidiaGpuMonitor._gpuCoresMem, gpuCoresMem);
        assert.deepEqual(nvidiaGpuMonitor._gpuEncodersUtilization, gpuEncodersUtilization);
        assert.deepEqual(nvidiaGpuMonitor._gpuDecodersUtilization, gpuDecodersUtilization);
    });

    it('on error in _parseGpuStat() receive default values for mem and utilization', async () => {
        const expectedGpuCoresMem = deepFreeze({
            '00000000:06:00.0': {
                total: -1,
                free: -1
            },
            '00000000:07:00.0': {
                total: -1,
                free: -1
            }
        });
        const expectedGpuEncodersUtilization = deepFreeze({
            '00000000:06:00.0': 100,
            '00000000:07:00.0': 100
        });
        const expectedGpuDecodersUtilization = deepFreeze({
            '00000000:06:00.0': 100,
            '00000000:07:00.0': 100
        });

        const readGpuStatDataStub = sinon.stub(nvidiaGpuMonitor, '_readGpuStatData');
        const getCoreId2NumberHashStub = sinon.stub(nvidiaGpuMonitor._nvidiaGpuInfo, 'getCoreId2NumberHash');
        readGpuStatDataStub.returns(Promise.reject(new Error('Some error')));
        getCoreId2NumberHashStub.returns(coreId2NumberHash);

        await nvidiaGpuMonitor._parseGpuStat();

        assert.isTrue(readGpuStatDataStub.calledOnce);
        assert.isTrue(readGpuStatDataStub.calledWithExactly());
        assert.isTrue(getCoreId2NumberHashStub.calledOnce);
        assert.isTrue(getCoreId2NumberHashStub.calledWithExactly());
        assert.deepEqual(nvidiaGpuMonitor._gpuCoresMem, expectedGpuCoresMem);
        assert.deepEqual(nvidiaGpuMonitor._gpuEncodersUtilization, expectedGpuEncodersUtilization);
        assert.deepEqual(nvidiaGpuMonitor._gpuDecodersUtilization, expectedGpuDecodersUtilization);
    });


});
